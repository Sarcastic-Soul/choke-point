// Fix plans and company-wide exposure. Read-only: nothing here writes to the graph.
// The counts are exact. They come from the same path match as queries.ts (live edges only,
// up to 10 hops), so a number here is what the other queries would report for the same graph.
// Path counts are cheap on the demo graph (a few ms for every user at once), so we enumerate
// and group in the database instead of estimating. No cap is applied anywhere.
import { getGraph } from "./client";
import { draftFix, type FixDraft } from "./fixes";
import { MAX_DEPTH } from "./queries";

export { planToMarkdown } from "./plan-markdown";

const RELS = "MEMBER_OF|ADMIN_ON|HAS_SESSION|CAN_READ";
const DEFAULT_STEPS = 3;
const MAX_STEPS = 5;

export interface ExposureEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  note: string;
  paths: number;
  /** Distinct users whose routes go through this link. */
  users: number;
  percent: number;
}

export interface CompanyExposure {
  /** Users with at least one live path to a crown jewel. */
  users: number;
  usersTotal: number;
  totalPaths: number;
  edges: ExposureEdge[];
}

export interface PlanStep {
  edgeId: string;
  type: string;
  from: string;
  to: string;
  note: string;
  /** Paths this step removes, given the steps before it. */
  killed: number;
  pathsAfter: number;
  usersAfter: number;
  ticket: FixDraft;
}

export interface FixPlan {
  scope: "identity" | "company";
  identity?: string;
  before: { paths: number; users: number };
  steps: PlanStep[];
  after: { paths: number; users: number };
}

type Row = Record<string, unknown>;

async function ro(tenant: string | undefined, cypher: string, params: Record<string, unknown> = {}) {
  const g = await getGraph(tenant);
  const res = await g.roQuery(cypher, { params: params as never, TIMEOUT: 5000 });
  return (res.data ?? []) as Row[];
}

/** True when FalkorDB gave up on a query because of the 5 s limit. */
export function isTimeout(err: unknown) {
  return /time.?d? ?out/i.test(err instanceof Error ? err.message : String(err));
}

// Where paths start. `$from = ''` is never used as a name: the company match takes every user.
function match(scope: "identity" | "company") {
  const start = scope === "identity" ? `(s:Entity {name: $from})` : `(s:User)`;
  return (
    `MATCH p=${start}-[:${RELS}*1..${MAX_DEPTH}]->(t:Entity {crown: true}) ` +
    `WHERE ALL(r IN relationships(p) WHERE r.removed = false AND NOT r.id IN $without)`
  );
}

async function totals(scope: "identity" | "company", from: string, without: string[], tenant?: string) {
  const rows = await ro(
    tenant,
    `${match(scope)} RETURN count(p) AS paths, count(DISTINCT s) AS users`,
    { from, without },
  );
  return { paths: Number(rows[0]?.paths ?? 0), users: Number(rows[0]?.users ?? 0) };
}

// The links on the most live paths. In identity scope, links leaving the identity itself are skipped
// (taking the victim out of their own group is not a lasting fix), the same rule as `chokePoints`.
async function ranked(scope: "identity" | "company", from: string, without: string[], top: number, tenant?: string) {
  const skip = scope === "identity" ? `WITH s, r WHERE startNode(r).name <> $from` : `WITH s, r`;
  const rows = await ro(
    tenant,
    `${match(scope)}
     WITH s, relationships(p) AS rs
     UNWIND rs AS r
     ${skip}
     WITH r.id AS id, count(*) AS paths, count(DISTINCT s) AS users
     ORDER BY paths DESC, id
     LIMIT ${top}
     MATCH (a)-[e {id: id}]->(b)
     RETURN id, type(e) AS type, a.name AS from, b.name AS to, e.note AS note, paths, users
     ORDER BY paths DESC, id`,
    { from, without },
  );
  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as string,
    from: r.from as string,
    to: r.to as string,
    note: (r.note as string) ?? "",
    paths: Number(r.paths),
    users: Number(r.users),
  }));
}

// 1. The links that sit on the most attack paths across the whole company.
export async function companyExposure(opts: { top?: number; tenant?: string } = {}): Promise<CompanyExposure> {
  const top = Math.min(Math.max(Math.trunc(opts.top ?? 5), 1), 10);
  const [t, usersTotal, edges] = await Promise.all([
    totals("company", "", [], opts.tenant),
    ro(opts.tenant, `MATCH (u:User) RETURN count(u) AS n`),
    ranked("company", "", [], top, opts.tenant),
  ]);
  return {
    users: t.users,
    usersTotal: Number(usersTotal[0]?.n ?? 0),
    totalPaths: t.paths,
    edges: edges.map((e) => ({ ...e, percent: t.paths ? Math.round((e.paths / t.paths) * 100) : 0 })),
  };
}

// 2. A greedy plan: each step cuts the link on the most paths that are still left.
// "Cut" is only a list of edge ids kept out of the match. The graph is never changed.
export async function fixPlan(opts: { identity?: string; steps?: number; tenant?: string } = {}): Promise<FixPlan> {
  const scope = opts.identity ? "identity" : "company";
  const from = opts.identity ?? "";
  const n = Math.min(Math.max(Math.trunc(opts.steps ?? DEFAULT_STEPS), 1), MAX_STEPS);
  const without: string[] = [];

  const first = await Promise.all([totals(scope, from, without, opts.tenant), ranked(scope, from, without, 1, opts.tenant)]);
  const before = first[0];
  let cur = first[0];
  let next = first[1][0];
  const steps: PlanStep[] = [];

  while (next && cur.paths > 0 && steps.length < n) {
    without.push(next.id);
    const more = steps.length + 1 < n;
    // The ranking for the next step is only needed if there is a next step.
    const [after, top] = await Promise.all([
      totals(scope, from, without, opts.tenant),
      more ? ranked(scope, from, without, 1, opts.tenant) : Promise.resolve([]),
    ]);
    steps.push({
      edgeId: next.id,
      type: next.type,
      from: next.from,
      to: next.to,
      note: next.note,
      killed: cur.paths - after.paths,
      pathsAfter: after.paths,
      usersAfter: after.users,
      ticket: draftFix({ id: next.id, type: next.type, from: next.from, to: next.to, note: next.note }),
    });
    cur = after;
    next = top[0];
  }

  return { scope, ...(scope === "identity" ? { identity: from } : {}), before, steps, after: cur };
}
