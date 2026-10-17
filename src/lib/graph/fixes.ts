// Fix drafting and memory. Approved fixes are stored in the graph as :Fix nodes,
// so the next scan can compare itself against what was fixed before.
import { getGraph } from "./client";
import { countPaths, getEdge, type EdgeInfo } from "./queries";

const RELS = "MEMBER_OF|ADMIN_ON|HAS_SESSION|CAN_READ";

// Errors the interface may show as they are. Anything else is reported as a generic failure.
export class FixError extends Error {}

export interface FixDraft {
  edgeId: string;
  title: string;
  body: string;
  command: string;
}

// Fix text is written from templates, not by the model, so it cannot invent names or commands.
export function draftFix(edge: EdgeInfo): FixDraft {
  const { type, from, to, id } = edge;
  const why = edge.note ? `Why it exists: ${edge.note}.` : "";
  switch (type) {
    case "MEMBER_OF":
      return {
        edgeId: id,
        title: `Remove ${from} from ${to}`,
        body: `${from} inherits every right that ${to} has. ${why} Remove the membership and check nothing legitimate depends on it.`,
        command: `Remove-ADGroupMember -Identity "${to}" -Members "${from}" -Confirm:$false`,
      };
    case "ADMIN_ON":
      return {
        edgeId: id,
        title: `Take admin rights for ${from} off ${to}`,
        body: `${from} can run code as administrator on ${to}. ${why} Replace it with just-in-time access.`,
        command: `Remove-LocalGroupMember -Group "Administrators" -Member "${from}"   # run on ${to}`,
      };
    case "HAS_SESSION":
      return {
        edgeId: id,
        title: `Stop ${to} logging on to ${from}`,
        body: `${to}'s credentials are cached on ${from}, so anyone with admin there can steal them. ${why} Block interactive logon for ${to} on ${from} and reboot it to clear the cache.`,
        command: `# GPO: Deny log on locally / Deny log on through Remote Desktop Services for ${to} on ${from}`,
      };
    default:
      return {
        edgeId: id,
        title: `Revoke ${from}'s access to ${to}`,
        body: `${from} can read ${to}. ${why} Revoke the grant and rotate the secret.`,
        command: `# Revoke the read grant for ${from} on ${to}, then rotate ${to}`,
      };
  }
}

export interface FixRecord {
  id: string;
  edgeId: string;
  from: string;
  at: number;
  pathsBefore: number;
  pathsAfter: number;
  title: string;
}

// Approving a fix marks the edge removed, so every later query sees the safer graph.
export async function approveFix(from: string, edgeId: string, tenant?: string): Promise<FixRecord> {
  const edge = await getEdge(edgeId, tenant);
  if (!edge) throw new FixError("Unknown edge");
  const draft = draftFix(edge);
  const pathsBefore = await countPaths(from, { tenant });
  // A link that is already cut, or on no live path from this identity, is not a fix. This also stops a double click from storing two records.
  if ((await countPaths(from, { without: edgeId, tenant })) === pathsBefore) {
    throw new FixError("That link is not on any live attack path from this identity");
  }
  const at = Date.now();
  const g = await getGraph(tenant);
  await g.query(`MATCH ()-[e {id: $edgeId}]->() SET e.removed = true`, { params: { edgeId } });
  const pathsAfter = await countPaths(from, { tenant });
  const id = `fix:${at}`;
  await g.query(
    `MATCH (a:Entity {name: $a}), (b:Entity {name: $b}), (s:Entity {name: $from})
     CREATE (f:Fix {id: $id, edgeId: $edgeId, from: $from, at: $at, title: $title,
                    pathsBefore: $pathsBefore, pathsAfter: $pathsAfter, status: 'approved'})
     CREATE (f)-[:ABOUT]->(a), (f)-[:ABOUT]->(b), (f)-[:FOUND_FROM]->(s)`,
    { params: { a: edge.from, b: edge.to, from, id, edgeId, at, title: draft.title, pathsBefore, pathsAfter } },
  );
  return { id, edgeId, from, at, pathsBefore, pathsAfter, title: draft.title };
}

export async function recallFixes(from?: string, tenant?: string): Promise<FixRecord[]> {
  const g = await getGraph(tenant);
  const res = await g.roQuery(
    `MATCH (f:Fix) WHERE $from = '' OR f.from = $from
     RETURN f.id AS id, f.edgeId AS edgeId, f.from AS from, f.at AS at,
            f.pathsBefore AS pathsBefore, f.pathsAfter AS pathsAfter, f.title AS title
     ORDER BY f.at DESC`,
    { params: { from: from ?? "" } },
  );
  return (res.data ?? []) as unknown as FixRecord[];
}

// Simulates ordinary drift: someone grants contractors backup rights for a ticket.
export async function simulateDrift(tenant?: string) {
  const g = await getGraph(tenant);
  const at = Date.now();
  const id = "MEMBER_OF:Marketing-Contractors>Backup-Operators";
  const res = await g.query(
    `MATCH (a:Entity {name: 'Marketing-Contractors'}), (b:Entity {name: 'Backup-Operators'})
     MERGE (a)-[e:MEMBER_OF {id: $id}]->(b)
     SET e.weight = 1, e.removed = false, e.addedAt = $at,
         e.note = 'Added for ticket OPS-4471 so contractors can restore their own files'
     RETURN count(e) AS n`,
    { params: { id, at } },
  );
  if (!Number((res.data?.[0] as { n?: number } | undefined)?.n)) throw new FixError("The demo groups are not in this graph. Reset the demo first.");
  return { id, at };
}

// Paths that go through an edge added after a given time. This is what memory is for:
// "the last fix still holds, but something new opened up".
export async function newPathsSince(from: string, since: number, tenant?: string) {
  const g = await getGraph(tenant);
  const res = await g.roQuery(
    `MATCH p=(s:Entity {name: $from})-[:${RELS}*1..10]->(t:Entity {crown: true})
     WHERE ALL(r IN relationships(p) WHERE r.removed = false)
       AND ANY(r IN relationships(p) WHERE r.addedAt > $since)
     WITH p, length(p) AS len
     ORDER BY len
     RETURN [n IN nodes(p) | n.name] AS nodes, [r IN relationships(p) | r.id] AS edges, len AS length`,
    { params: { from, since } },
  );
  return (res.data ?? []) as unknown as Array<{ nodes: string[]; edges: string[]; length: number }>;
}
