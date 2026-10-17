import { describe, expect, test } from "bun:test";
import { analyze, layout, type PathGraph } from "../src/lib/view";

const e = (id: string, source: string, target: string) => ({ id, type: "MEMBER_OF", source, target, note: "", paths: 0, addedAt: 0 });

// a -> g1 -> h1 -> u2 -> g2 -> DC, and a -> g3 -> h2 -> u2
const g: PathGraph = {
  from: "a",
  total: 2,
  nodes: ["a", "g1", "g3", "h1", "h2", "u2", "g2", "DC"].map((id) => ({ id, kind: "Group", crown: id === "DC" })),
  edges: [e("a>g1", "a", "g1"), e("a>g3", "a", "g3"), e("g1>h1", "g1", "h1"), e("g3>h2", "g3", "h2"), e("h1>u2", "h1", "u2"), e("h2>u2", "h2", "u2"), e("u2>g2", "u2", "g2"), e("g2>DC", "g2", "DC")],
};

describe("analyze", () => {
  test("counts both routes", () => {
    const r = analyze(g);
    expect(r.total).toBe(2);
    expect(r.edgeUse.get("u2>g2")).toBe(2);
    expect(r.edgeUse.get("g1>h1")).toBe(1);
  });
  test("leaving out a shared edge kills every path", () => {
    expect(analyze(g, "u2>g2").total).toBe(0);
  });
  test("leaving out a single-route edge leaves the other", () => {
    const r = analyze(g, "g1>h1");
    expect(r.total).toBe(1);
    expect(r.edgeUse.get("a>g1")).toBe(0);
  });
});

describe("layout", () => {
  test("puts the identity first and crown jewels last", () => {
    const pos = layout(g);
    expect(pos.get("a")!.x).toBe(0);
    const maxX = Math.max(...[...pos.values()].map((p) => p.x));
    expect(pos.get("DC")!.x).toBe(maxX);
  });
});

// ---- graphs with loops (group nesting that points back on itself) ----
import { afterAll } from "bun:test";
import { getGraph } from "../src/lib/graph/client";
import { importGraph } from "../src/lib/graph/seed";
import { parseEdgeCsv, SAMPLE_CROWN, sampleCsv } from "../src/lib/graph/import";
import { countPaths, pathGraph } from "../src/lib/graph/queries";
import { countWalks } from "../src/lib/view";

const made: string[] = [];
afterAll(async () => {
  for (const t of made) await (await getGraph(t)).delete().catch(() => undefined);
});
const fresh = (tag: string) => {
  const t = `test-import-${tag}-${Math.random().toString(36).slice(2, 8)}`;
  made.push(t);
  return t;
};

// u -> g1 <-> g2, and both groups administer DC
const loop: PathGraph = {
  from: "u",
  total: 0,
  nodes: ["u", "g1", "g2", "DC"].map((id) => ({ id, kind: "Group", crown: id === "DC" })),
  edges: [e("u>g1", "u", "g1"), e("g1>g2", "g1", "g2"), e("g2>g1", "g2", "g1"), e("g1>DC", "g1", "DC"), e("g2>DC", "g2", "DC")],
};

describe("analyze with a loop", () => {
  test("counts edge-unique walks like the server", () => {
    // u>g1>DC, u>g1>g2>DC, u>g1>g2>g1>DC
    const r = analyze(loop);
    expect(r.total).toBe(3);
    expect(r.capped).toBeUndefined();
    expect(r.edgeUse.get("u>g1")).toBe(3);
    expect(r.edgeUse.get("g1>DC")).toBe(2);
    expect(r.edgeUse.get("g2>g1")).toBe(1);
  });
  test("leaving out an edge that breaks the loop still counts right", () => {
    expect(analyze(loop, "g2>g1").total).toBe(2);
    expect(analyze(loop, "g1>DC").total).toBe(1);
  });
  test("layout gives every node a finite spot, columns by shortest distance", () => {
    const pos = layout(loop);
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(pos.get("u")!.x).toBe(0);
    expect(pos.get("g1")!.x).toBe(210);
    expect(pos.get("g2")!.x).toBe(420);
    expect(pos.get("DC")!.x).toBe(420);
  });
  test("a chain longer than ten edges has no paths, like the server", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `n${i}`);
    const chain: PathGraph = {
      from: "n0",
      total: 0,
      nodes: ids.map((id) => ({ id, kind: "Group", crown: id === "n12" })),
      edges: ids.slice(1).map((id, i) => e(`${ids[i]}>${id}`, ids[i], id)),
    };
    expect(analyze(chain).total).toBe(0);
    expect(analyze({ ...chain, nodes: chain.nodes.map((n) => ({ ...n, crown: n.id === "n10" })) }).total).toBe(1);
  });
  test("the DAG shortcut and the walk agree on a DAG", () => {
    expect(countWalks(g, g.edges).total).toBe(analyze(g).total);
    expect(countWalks(g, g.edges).edgeUse.get("u2>g2")).toBe(2);
  });
  test("gives up after the step cap and says so", () => {
    // 9 nodes that all point at each other, plus a crown node: the number of walks explodes
    const ids = Array.from({ length: 9 }, (_, i) => `k${i}`);
    const edges = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => e(`${a}>${b}`, a, b)));
    edges.push(e("k1>DC", "k1", "DC"));
    const r = analyze({
      from: "k0",
      total: 0,
      nodes: [...ids, "DC"].map((id) => ({ id, kind: "Group", crown: id === "DC" })),
      edges,
    });
    expect(r.capped).toBe(true);
    expect(r.total).toBeGreaterThan(0);
  });
});

describe("analyze matches the server on imported data with a loop", () => {
  test("hand-built loop", async () => {
    const t = fresh("loop");
    const csv = "type,from,to\nMEMBER_OF,u,g1\nMEMBER_OF,g1,g2\nMEMBER_OF,g2,g1\nADMIN_ON,g1,DC\nADMIN_ON,g2,DC\n";
    const parsed = parseEdgeCsv(csv, ["DC"]);
    if (!parsed.ok) throw new Error(parsed.errors.join());
    await importGraph(t, parsed.data, { name: "loop" });
    const server = await countPaths("u", { tenant: t });
    expect(server).toBe(3);
    const pg = await pathGraph("u", { tenant: t });
    expect(analyze(pg).total).toBe(server);
  });

  test("the Contoso sample: every user, and with each edge of the busiest path removed", async () => {
    const t = fresh("sample");
    const parsed = parseEdgeCsv(sampleCsv(), SAMPLE_CROWN);
    if (!parsed.ok) throw new Error(parsed.errors.join());
    await importGraph(t, parsed.data, { name: "Contoso Retail" });
    let withLoop = 0;
    for (const u of ["dan.ortiz", "eva.lund", "helen.park", "kofi.mensah", "ravi.menon", "priya.nair", "adm-carol", "svc-pos", "zoe.fisher"]) {
      const server = await countPaths(u, { tenant: t });
      const pg = await pathGraph(u, { tenant: t });
      const a = analyze(pg);
      expect(a.capped).toBeUndefined();
      expect(a.total).toBe(server);
      expect(pg.total).toBe(server);
      if (u === "helen.park") {
        // per-edge use matches what the server reports for each edge
        for (const edge of pg.edges) expect(a.edgeUse.get(edge.id)).toBe(edge.paths);
        // removing any edge matches the server's count without it
        for (const edge of pg.edges.slice(0, 12)) {
          expect(analyze(pg, edge.id).total).toBe(await countPaths(u, { tenant: t, without: edge.id }));
        }
        // layout is finite for the cyclic sample
        const pos = layout(pg);
        expect(pos.size).toBe(pg.nodes.length);
        for (const p of pos.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        // sanity: a cycle really is present
        withLoop = pg.edges.filter((x) => x.id.includes("IT-Ops>Platform-Eng") || x.id.includes("Platform-Eng>IT-Ops")).length;
      }
    }
    expect(withLoop).toBe(2);
  });
});
