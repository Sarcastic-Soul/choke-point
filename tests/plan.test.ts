// Runs against a local FalkorDB. Each file uses its own tenants and deletes them at the end.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getGraph } from "../src/lib/graph/client";
import { companyExposure, fixPlan, planToMarkdown, type FixPlan } from "../src/lib/graph/plan";
import { countPaths } from "../src/lib/graph/queries";
import { seedGraph } from "../src/lib/graph/seed";

const rand = Math.random().toString(36).slice(2, 8);
const SMALL = `test-plan-s-${rand}`;
const FULL = `test-plan-f-${rand}`;

// Two users, one crown secret, five routes of different weight.
async function seedSmall(tenant: string) {
  const g = await getGraph(tenant);
  await g.query(`
    CREATE (a:Entity:User {name:'a', kind:'User', crown:false, dept:'', note:''}),
           (b:Entity:User {name:'b', kind:'User', crown:false, dept:'', note:''}),
           (c:Entity:User {name:'c', kind:'User', crown:false, dept:'', note:''}),
           (g1:Entity:Group {name:'g1', kind:'Group', crown:false, dept:'', note:''}),
           (g2:Entity:Group {name:'g2', kind:'Group', crown:false, dept:'', note:''}),
           (hA:Entity:Host {name:'hA', kind:'Host', crown:false, dept:'', note:''}),
           (hB:Entity:Host {name:'hB', kind:'Host', crown:false, dept:'', note:''}),
           (s:Entity:Secret {name:'S', kind:'Secret', crown:true, dept:'', note:''}),
           (a)-[:MEMBER_OF {id:'a>g1', removed:false, note:''}]->(g1),
           (a)-[:MEMBER_OF {id:'a>g2', removed:false, note:''}]->(g2),
           (b)-[:MEMBER_OF {id:'b>g1', removed:false, note:''}]->(g1),
           (g1)-[:ADMIN_ON {id:'g1>hA', removed:false, note:''}]->(hA),
           (g1)-[:ADMIN_ON {id:'g1>hB', removed:false, note:''}]->(hB),
           (g2)-[:ADMIN_ON {id:'g2>hB', removed:false, note:'because'}]->(hB),
           (hA)-[:CAN_READ {id:'hA>S', removed:false, note:''}]->(s),
           (hB)-[:CAN_READ {id:'hB>S', removed:false, note:''}]->(s)`);
}

// Real recount: really mark the chosen edges removed, then count with the existing helper.
async function recount(tenant: string, ids: string[], identity?: string) {
  const g = await getGraph(tenant);
  await g.query(`MATCH ()-[e]->() SET e.removed = false`);
  for (const id of ids) await g.query(`MATCH ()-[e {id: $id}]->() SET e.removed = true`, { params: { id } });
  if (identity) {
    const paths = await countPaths(identity, { tenant });
    return { paths, users: paths > 0 ? 1 : 0 };
  }
  const rows = (await g.roQuery(
    `MATCH p=(s:User)-[:MEMBER_OF|ADMIN_ON|HAS_SESSION|CAN_READ*1..10]->(t:Entity {crown: true})
     WHERE ALL(r IN relationships(p) WHERE r.removed = false)
     RETURN count(p) AS paths, count(DISTINCT s) AS users`,
  )).data as Array<{ paths: number; users: number }>;
  return { paths: Number(rows[0].paths), users: Number(rows[0].users) };
}

beforeAll(async () => {
  await seedSmall(SMALL);
  await seedGraph(FULL);
}, 60_000);

// Recounts mark edges removed on purpose, so every test starts from a clean graph.
beforeEach(async () => {
  for (const t of [SMALL, FULL]) await (await getGraph(t)).query(`MATCH ()-[e]->() SET e.removed = false`);
});

afterAll(async () => {
  for (const t of [SMALL, FULL]) await (await getGraph(t)).delete().catch(() => undefined);
});

describe("companyExposure", () => {
  test("counts users, paths and the busiest links on the small graph", async () => {
    const r = await companyExposure({ tenant: SMALL, top: 3 });
    expect(r.usersTotal).toBe(3);
    expect(r.users).toBe(2); // c has no route
    expect(r.totalPaths).toBe(5);
    expect(r.edges[0]).toMatchObject({ id: "hB>S", paths: 3, users: 2, percent: 60, type: "CAN_READ", from: "hB", to: "S" });
    expect(r.edges.length).toBe(3);
    for (let i = 1; i < r.edges.length; i++) expect(r.edges[i - 1].paths).toBeGreaterThanOrEqual(r.edges[i].paths);
  });

  test("on the demo graph it is exact, fast and clamps top", async () => {
    const t0 = performance.now();
    const r = await companyExposure({ tenant: FULL, top: 50 });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.edges.length).toBe(10);
    expect(r.users).toBeGreaterThan(0);
    expect(r.users).toBeLessThanOrEqual(r.usersTotal);
    const real = await recount(FULL, []);
    expect(r.totalPaths).toBe(real.paths);
    expect(r.users).toBe(real.users);
  });
});

describe("fixPlan", () => {
  test("company plan: every step matches a real recount after the edges are really removed", async () => {
    const plan = await fixPlan({ steps: 5, tenant: SMALL });
    expect(plan.scope).toBe("company");
    expect(plan.before).toEqual({ paths: 5, users: 2 });
    expect(plan.steps[0].edgeId).toBe("hB>S");
    expect(plan.steps[0].killed).toBe(3);
    const chosen: string[] = [];
    for (const s of plan.steps) {
      chosen.push(s.edgeId);
      const real = await recount(SMALL, chosen);
      expect({ paths: s.pathsAfter, users: s.usersAfter }).toEqual(real);
    }
    expect(plan.after).toEqual({ paths: plan.steps.at(-1)!.pathsAfter, users: plan.steps.at(-1)!.usersAfter });
    expect(plan.after.paths).toBe(0); // stops once nothing is left
    expect(plan.steps.length).toBeLessThan(5);
    // killed always adds up
    expect(plan.steps.reduce((n, s) => n + s.killed, 0)).toBe(plan.before.paths - plan.after.paths);
  });

  test("identity plan skips links that leave the identity and matches a real recount", async () => {
    const plan = await fixPlan({ identity: "a", steps: 5, tenant: SMALL });
    expect(plan.scope).toBe("identity");
    expect(plan.identity).toBe("a");
    expect(plan.before).toEqual({ paths: 3, users: 1 });
    expect(plan.steps.every((s) => s.from !== "a")).toBe(true);
    const chosen: string[] = [];
    for (const s of plan.steps) {
      chosen.push(s.edgeId);
      expect({ paths: s.pathsAfter, users: s.usersAfter }).toEqual(await recount(SMALL, chosen, "a"));
    }
    // "a" reaches S three ways and edges out of "a" are skipped, so the plan needs more than one step
    expect(plan.steps.length).toBeGreaterThan(1);
  });

  test("steps are clamped and a step carries its draft ticket", async () => {
    const one = await fixPlan({ identity: "a", steps: 0, tenant: SMALL });
    expect(one.steps.length).toBe(1);
    const many = await fixPlan({ steps: 99, tenant: SMALL });
    expect(many.steps.length).toBeLessThanOrEqual(5);
    expect(one.steps[0].ticket.title.length).toBeGreaterThan(0);
    expect(one.steps[0].ticket.edgeId).toBe(one.steps[0].edgeId);
  });

  test("an identity with no path gets an empty plan", async () => {
    const plan = await fixPlan({ identity: "c", tenant: SMALL });
    expect(plan.steps).toEqual([]);
    expect(plan.before).toEqual({ paths: 0, users: 0 });
    expect(plan.after).toEqual({ paths: 0, users: 0 });
  });

  test("a plan changes nothing in the graph", async () => {
    const g = await getGraph(SMALL);
    const count = async () =>
      Number(((await g.roQuery(`MATCH ()-[e]->() WHERE e.removed = true RETURN count(e) AS n`)).data![0] as { n: number }).n);
    await recount(SMALL, []);
    const before = await count();
    await fixPlan({ steps: 5, tenant: SMALL });
    await fixPlan({ identity: "a", steps: 5, tenant: SMALL });
    expect(await count()).toBe(before);
  });

  test("demo graph: alice.moreno goes 33 -> 3 -> ... and every step is exact", async () => {
    const t0 = performance.now();
    const plan = await fixPlan({ identity: "alice.moreno", steps: 3, tenant: FULL });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(plan.before.paths).toBe(33);
    expect(plan.steps[0].edgeId).toBe("MEMBER_OF:Legacy-VPN-Users>IT-Support");
    expect(plan.steps[0].killed).toBe(30);
    expect(plan.steps[0].pathsAfter).toBe(3);
    const chosen: string[] = [];
    for (const s of plan.steps) {
      chosen.push(s.edgeId);
      expect({ paths: s.pathsAfter, users: s.usersAfter }).toEqual(await recount(FULL, chosen, "alice.moreno"));
    }
    await recount(FULL, []);
  });

  test("demo graph: company plan is exact too", async () => {
    const t0 = performance.now();
    const plan = await fixPlan({ steps: 3, tenant: FULL });
    expect(performance.now() - t0).toBeLessThan(2000);
    const chosen: string[] = [];
    for (const s of plan.steps) {
      chosen.push(s.edgeId);
      expect({ paths: s.pathsAfter, users: s.usersAfter }).toEqual(await recount(FULL, chosen));
    }
    await recount(FULL, []);
  });
});

describe("planToMarkdown", () => {
  const plan: FixPlan = {
    scope: "identity",
    identity: "alice.moreno",
    before: { paths: 33, users: 1 },
    after: { paths: 0, users: 0 },
    steps: [
      {
        edgeId: "MEMBER_OF:x>y", type: "MEMBER_OF", from: "x", to: "y", note: "", killed: 33, pathsAfter: 0, usersAfter: 0,
        ticket: { edgeId: "MEMBER_OF:x>y", title: "Remove x from y", body: "x inherits y.", command: "Remove-ADGroupMember ```evil``` -Identity y" },
      },
    ],
  };
  test("writes the summary, each step, and the honesty line", () => {
    const md = planToMarkdown(plan);
    expect(md).toContain("# Fix plan for `alice.moreno`");
    expect(md).toContain("**33** now, **0** after");
    expect(md).toContain("## 1. Remove x from y");
    expect(md).toContain("Cuts 33 paths, leaving 0");
    expect(md).toContain("changes nothing until a person approves");
  });
  test("a command with backticks cannot close its own code fence", () => {
    const md = planToMarkdown(plan);
    expect(md).toContain("````\nRemove-ADGroupMember ```evil```");
  });
  test("names are escaped so they cannot turn into links, HTML or broken code spans", () => {
    const evil = { ...plan, identity: "`u`", steps: [{ ...plan.steps[0], from: "[link](http://x)#1", to: "<svg onload=alert(2)", ticket: { ...plan.steps[0].ticket, title: "Remove [link](http://x)#1 from <svg onload=alert(2)", body: "[link](http://x)#1 inherits <b>y</b>." } }] };
    const md = planToMarkdown(evil);
    expect(md).toContain("# Fix plan for `` `u` ``");
    expect(md).toContain("## 1. Remove \\[link\\](http://x)\\#1 from \\<svg onload=alert(2)");
    expect(md).toContain("`[link](http://x)#1` to `<svg onload=alert(2)`");
    expect(md).toContain("\\[link\\](http://x)\\#1 inherits \\<b\\>y\\</b\\>.");
    expect(md).not.toContain("  "); // no stray double spaces
  });
  test("company scope talks about users and an empty plan says so", () => {
    const md = planToMarkdown({ ...plan, scope: "company", identity: undefined, before: { paths: 9, users: 4 } });
    expect(md).toContain("Users who can reach the crown jewels: **4** now");
    expect(planToMarkdown({ ...plan, steps: [] })).toContain("nothing to fix");
  });
});
