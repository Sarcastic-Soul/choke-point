// Every query the agent can run. The model never writes Cypher: it picks one of these
// and fills in typed arguments. Names are checked with `resolveEntity` first.
import { getGraph } from "./client";

export const MAX_DEPTH = 10;

const RELS = "MEMBER_OF|ADMIN_ON|HAS_SESSION|CAN_READ";

const LIVE = `ALL(r IN relationships(p) WHERE r.removed = false)`;

export interface Entity {
  name: string;
  kind: "User" | "Group" | "Host" | "Secret";
  crown: boolean;
  dept: string;
  note: string;
}

export type Resolution =
  | { found: true; entity: Entity }
  | { found: false; suggestions: string[] };

export interface AttackPath {
  nodes: string[];
  kinds: string[];
  edges: string[];
  length: number;
}

export interface EdgeInfo {
  id: string;
  type: string;
  from: string;
  to: string;
  note: string;
}

type Row = Record<string, unknown>;

function depth(d: number | undefined) {
  const n = Math.trunc(d ?? MAX_DEPTH);
  if (!Number.isFinite(n) || n < 1 || n > MAX_DEPTH) throw new Error(`depth must be 1..${MAX_DEPTH}`);
  return n;
}

async function ro(tenant: string | undefined, cypher: string, params: Record<string, unknown> = {}) {
  const g = await getGraph(tenant);
  const res = await g.roQuery(cypher, { params: params as never, TIMEOUT: 5000 });
  return (res.data ?? []) as Row[];
}

// 1. Name resolution. Runs before every other tool.
export async function resolveEntity(name: string, tenant?: string): Promise<Resolution> {
  const exact = await ro(
    tenant,
    `MATCH (n:Entity) WHERE toLower(n.name) = toLower($name)
     RETURN n.name AS name, n.kind AS kind, n.crown AS crown, n.dept AS dept, n.note AS note LIMIT 1`,
    { name: name.trim() },
  );
  if (exact[0]) return { found: true, entity: exact[0] as unknown as Entity };

  const near = await ro(
    tenant,
    `MATCH (n:Entity) WHERE toLower(n.name) CONTAINS toLower($name)
     RETURN n.name AS name ORDER BY n.name LIMIT 5`,
    { name: name.trim() },
  );
  return { found: false, suggestions: near.map((r) => r.name as string) };
}

// 2. Every route from a compromised identity to a crown jewel.
export async function attackPaths(from: string, opts: { limit?: number; maxDepth?: number; tenant?: string } = {}) {
  const d = depth(opts.maxDepth);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25), 1), 100);
  const total = await countPaths(from, { maxDepth: d, tenant: opts.tenant });
  const rows = await ro(
    opts.tenant,
    `MATCH p=(s:Entity {name: $from})-[:${RELS}*1..${d}]->(t:Entity {crown: true})
     WHERE ${LIVE}
     WITH p, length(p) AS len
     ORDER BY len
     LIMIT ${limit}
     RETURN [n IN nodes(p) | n.name] AS nodes,
            [n IN nodes(p) | n.kind] AS kinds,
            [r IN relationships(p) | r.id] AS edges,
            len AS length`,
    { from },
  );
  return { total, paths: rows as unknown as AttackPath[] };
}

export async function countPaths(
  from: string,
  opts: { maxDepth?: number; without?: string; tenant?: string } = {},
) {
  const d = depth(opts.maxDepth);
  const rows = await ro(
    opts.tenant,
    `MATCH p=(s:Entity {name: $from})-[:${RELS}*1..${d}]->(t:Entity {crown: true})
     WHERE ${LIVE} AND ($without = '' OR NONE(r IN relationships(p) WHERE r.id = $without))
     RETURN count(p) AS n`,
    { from, without: opts.without ?? "" },
  );
  return Number(rows[0]?.n ?? 0);
}

// 3. Which single edge sits on the most attack paths. Edges leaving the compromised identity are skipped:
// taking the victim out of their own group is not a lasting fix.
export async function chokePoints(from: string, opts: { top?: number; maxDepth?: number; tenant?: string } = {}) {
  const d = depth(opts.maxDepth);
  const top = Math.min(Math.max(Math.trunc(opts.top ?? 5), 1), 20);
  const total = await countPaths(from, { maxDepth: d, tenant: opts.tenant });
  const rows = await ro(
    opts.tenant,
    `MATCH p=(s:Entity {name: $from})-[:${RELS}*1..${d}]->(t:Entity {crown: true})
     WHERE ${LIVE}
     UNWIND relationships(p) AS r
     WITH r WHERE startNode(r).name <> $from
     WITH r.id AS id, count(*) AS paths
     ORDER BY paths DESC, id
     LIMIT ${top}
     MATCH (a)-[e {id: id}]->(b)
     RETURN id, type(e) AS type, a.name AS from, b.name AS to, e.note AS note, paths`,
    { from },
  );
  return {
    total,
    edges: rows.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      from: r.from as string,
      to: r.to as string,
      note: (r.note as string) ?? "",
      paths: Number(r.paths),
      percent: total ? Math.round((Number(r.paths) / total) * 100) : 0,
    })),
  };
}

// 4. What happens if one edge is removed. Counts again with that edge left out. No graph copy.
export async function whatIfRemove(from: string, edgeId: string, opts: { maxDepth?: number; tenant?: string } = {}) {
  const before = await countPaths(from, { maxDepth: opts.maxDepth, tenant: opts.tenant });
  const after = await countPaths(from, { maxDepth: opts.maxDepth, without: edgeId, tenant: opts.tenant });
  return { before, after, killed: before - after };
}

export async function getEdge(edgeId: string, tenant?: string): Promise<EdgeInfo | null> {
  const rows = await ro(
    tenant,
    `MATCH (a)-[e {id: $id}]->(b)
     RETURN e.id AS id, type(e) AS type, a.name AS from, b.name AS to, e.note AS note`,
    { id: edgeId },
  );
  const r = rows[0];
  return r ? ({ id: r.id, type: r.type, from: r.from, to: r.to, note: (r.note as string) ?? "" } as EdgeInfo) : null;
}

// 5. Secrets this identity can reach, crown or not.
export async function exposedSecrets(from: string, opts: { maxDepth?: number; tenant?: string } = {}) {
  const d = depth(opts.maxDepth);
  const rows = await ro(
    opts.tenant,
    `MATCH p=(s:Entity {name: $from})-[:${RELS}*1..${d}]->(t:Secret)
     WHERE ${LIVE}
     WITH t, min(length(p)) AS hops
     RETURN t.name AS name, t.crown AS crown, hops ORDER BY crown DESC, hops, name`,
    { from },
  );
  return rows.map((r) => ({ name: r.name as string, crown: Boolean(r.crown), hops: Number(r.hops) }));
}

// 6. The most load-bearing nodes in the whole company, by betweenness centrality.
export async function loadBearing(limit = 10, tenant?: string) {
  const n = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const rows = await ro(
    tenant,
    `CALL algo.betweenness({nodeLabels: ['Entity'], relationshipTypes: ['MEMBER_OF','ADMIN_ON','HAS_SESSION','CAN_READ']})
     YIELD node, score
     RETURN node.name AS name, node.kind AS kind, score ORDER BY score DESC LIMIT ${n}`,
  );
  return rows.map((r) => ({ name: r.name as string, kind: r.kind as string, score: Number(r.score) }));
}

// 7. Every edge on any attack path from this identity, with how many paths use it. Feeds the graph view.
export async function pathGraph(from: string, opts: { maxDepth?: number; tenant?: string } = {}) {
  const d = depth(opts.maxDepth);
  const total = await countPaths(from, { maxDepth: d, tenant: opts.tenant });
  const rows = await ro(
    opts.tenant,
    `MATCH p=(s:Entity {name: $from})-[:${RELS}*1..${d}]->(t:Entity {crown: true})
     WHERE ${LIVE}
     UNWIND relationships(p) AS r
     WITH r.id AS id, count(*) AS paths
     MATCH (a:Entity)-[e {id: id}]->(b:Entity)
     RETURN id, type(e) AS type, a.name AS source, a.kind AS sourceKind, a.crown AS sourceCrown,
            b.name AS target, b.kind AS targetKind, b.crown AS targetCrown, e.note AS note, e.addedAt AS addedAt, paths`,
    { from },
  );
  const nodes = new Map<string, { id: string; kind: string; crown: boolean }>();
  const edges = rows.map((r) => {
    nodes.set(r.source as string, { id: r.source as string, kind: r.sourceKind as string, crown: Boolean(r.sourceCrown) });
    nodes.set(r.target as string, { id: r.target as string, kind: r.targetKind as string, crown: Boolean(r.targetCrown) });
    return {
      id: r.id as string,
      type: r.type as string,
      source: r.source as string,
      target: r.target as string,
      note: (r.note as string) ?? "",
      addedAt: Number(r.addedAt ?? 0),
      paths: Number(r.paths),
    };
  });
  return { from, total, nodes: [...nodes.values()], edges };
}
