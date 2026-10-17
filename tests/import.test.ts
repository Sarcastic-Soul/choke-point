// Parser tests need no database. The last block runs against local FalkorDB with its own throwaway tenants.
import { afterAll, describe, expect, test } from "bun:test";
import { getGraph } from "../src/lib/graph/client";
import { getDataset } from "../src/lib/graph/dataset";
import { handleImport } from "../src/lib/graph/import-handler";
import { parseEdgeCsv, SAMPLE_CROWN, sampleCsv, suggestStart } from "../src/lib/graph/import";
import { attackPaths, chokePoints, countPaths } from "../src/lib/graph/queries";
import { importGraph, seedGraph } from "../src/lib/graph/seed";

const H = "type,from,to,note\n";
const ok = (csv: string, crown: string[]) => {
  const r = parseEdgeCsv(csv, crown);
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r;
};
const bad = (csv: string, crown: string[]) => {
  const r = parseEdgeCsv(csv, crown);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};
const tiny = `${H}MEMBER_OF,u1,g1,\nADMIN_ON,g1,H1,\n`;

describe("sample", () => {
  test("parses and has the promised shape", () => {
    const r = ok(sampleCsv(), SAMPLE_CROWN);
    expect(r.summary.edges).toBeGreaterThanOrEqual(60);
    expect(r.summary.edges).toBeLessThanOrEqual(120);
    expect(r.data.nodes.filter((n) => n.crown).map((n) => n.name).sort()).toEqual([...SAMPLE_CROWN].sort());
    expect(r.summary.nodes).toBe(r.summary.users + r.summary.groups + r.summary.hosts + r.summary.secrets);
    // the loop between two groups
    const ids = new Set(r.data.edges.map((e) => e.id));
    expect(ids.has("MEMBER_OF:IT-Ops>Platform-Eng") && ids.has("MEMBER_OF:Platform-Eng>IT-Ops")).toBe(true);
    expect(r.data.edges[0].id).toMatch(/^[A-Z_]+:.+>.+$/);
  });
  test("suggests a user with paths", () => {
    const s = suggestStart(ok(sampleCsv(), SAMPLE_CROWN).data);
    expect(s.noPaths).toBe(false);
    expect(s.paths).toBeGreaterThan(0);
  });
});

describe("kinds", () => {
  test("are inferred from how names are used", () => {
    const r = ok(`${H}MEMBER_OF,u1,g1\nMEMBER_OF,g1,g2\nADMIN_ON,g2,H1\nHAS_SESSION,H1,u2\nCAN_READ,u2,s1\n`, ["H1"]);
    const k = Object.fromEntries(r.data.nodes.map((n) => [n.name, n.kind]));
    expect(k).toEqual({ u1: "User", g1: "Group", g2: "Group", H1: "Host", u2: "User", s1: "Secret" });
  });
  test("a host may read a secret", () => {
    expect(ok(`${H}ADMIN_ON,g1,H1\nCAN_READ,H1,s1\n`, ["s1"]).data.nodes.find((n) => n.name === "H1")?.kind).toBe("Host");
  });
  test("a name that is two kinds is an error naming the row", () => {
    const e = bad(`${H}MEMBER_OF,u1,g1\nADMIN_ON,g1,H1\nHAS_SESSION,g1,u1\n`, ["H1"]);
    expect(e[0]).toContain("Row 4");
    expect(e[0]).toContain('"g1"');
  });
  test("a host cannot be the source of MEMBER_OF, a secret cannot be a source", () => {
    expect(bad(`${H}ADMIN_ON,g1,H1\nMEMBER_OF,H1,g2\n`, ["H1"])[0]).toContain("Row 3");
    expect(bad(`${H}CAN_READ,g1,s1\nMEMBER_OF,s1,g2\n`, ["s1"])[0]).toContain("Row 3");
  });
});

describe("csv reading", () => {
  test("handles quotes, commas, escaped quotes and a header in any case and order", () => {
    const r = ok(`NOTE,To,FROM,Type,extra\n"said ""hi"", twice",g1,"u,1",member_of,zzz\nADMIN_ON,H1,g1,admin_on\n`, ["H1"]);
    expect(r.data.nodes.some((n) => n.name === "u,1")).toBe(true);
    expect(r.data.edges.find((e) => e.type === "MEMBER_OF")?.note).toBe('said "hi", twice');
  });
  test("handles BOM, CRLF and blank lines, merges duplicates", () => {
    const r = ok(`﻿type,from,to,note\r\nMEMBER_OF,u1,g1,\r\n\r\nMEMBER_OF,u1,g1,first note\r\n   \r\nADMIN_ON,g1,H1,\r\n`, ["H1"]);
    expect(r.summary.edges).toBe(2);
    expect(r.data.edges[0].note).toBe("first note");
    expect(r.data.edges[0].id).toBe("MEMBER_OF:u1>g1");
  });
  test("a quoted note with a line break counts rows by line", () => {
    const e = bad(`${H}MEMBER_OF,u1,g1,"two\nlines"\nBOGUS,a,b\n`, ["g1"]);
    expect(e[0]).toContain("Row 4");
  });
  test("note column is optional", () => {
    expect(ok("type,from,to\nMEMBER_OF,u1,g1\n", ["g1"]).summary.edges).toBe(1);
  });
  test("unclosed quote", () => {
    expect(bad(`${H}MEMBER_OF,"u1,g1\n`, ["g1"])[0]).toContain("Row 2");
  });
});

describe("validation", () => {
  test("missing header columns, empty file", () => {
    expect(bad("a,b,c\n1,2,3\n", ["x"])[0]).toContain("missing type, from, to");
    expect(bad("", ["x"])[0]).toContain("empty");
    expect(bad(H, ["x"])[0]).toContain("no edges");
  });
  test("bad type, short row, empty name, self loop, long name, control char, long note", () => {
    const long = "x".repeat(81);
    const e = bad(`${H}LIKES,a,b\nMEMBER_OF,a\nMEMBER_OF,,g1\nMEMBER_OF,g1,g1\nMEMBER_OF,${long},g1\nMEMBER_OF,a\u0001b,g1\nMEMBER_OF,a,g1,${"n".repeat(201)}\nMEMBER_OF,a>b,g1\n`, ["g1"]);
    expect(e.length).toBe(9); // the ninth: the crown name no longer exists, because every row failed
    expect(e[0]).toContain("Row 2");
    expect(e[1]).toContain("Row 3");
    expect(e[2]).toContain("Row 4");
    expect(e[3]).toContain("Row 5");
    expect(e[4]).toContain("Row 6");
    expect(e[5]).toContain("Row 7");
    expect(e[6]).toContain("Row 8");
    expect(e[7]).toContain("Row 9");
  });
  test("errors stop at ten", () => {
    const rows = Array.from({ length: 30 }, () => "NOPE,a,b").join("\n");
    expect(bad(`${H}${rows}\n`, ["b"]).length).toBe(10);
  });
  test("names that differ only by case clash", () => {
    expect(bad(`${H}MEMBER_OF,u1,Group\nMEMBER_OF,u2,group\n`, ["Group"])[0]).toContain("letter case");
  });
  test("crown names are required, must exist, and hint at a case slip", () => {
    expect(bad(tiny, [])[0]).toContain("at least one crown");
    expect(bad(tiny, ["nope"])[0]).toContain('"nope" is not in the edge list');
    expect(bad(tiny, ["h1"])[0]).toContain('Did you mean "H1"');
    expect(ok(tiny, [" H1 ", "H1"]).data.nodes.filter((n) => n.crown).length).toBe(1);
  });
  test("limits: size, edges, nodes", () => {
    expect(bad("x".repeat(1_048_577), ["x"])[0]).toContain("over 1 MB");
    const pair = (i: number) => `MEMBER_OF,u${i % 50},g${Math.floor(i / 50)}`;
    const manyEdges = Array.from({ length: 5001 }, (_, i) => pair(i)).join("\n");
    expect(bad(`${H}${manyEdges}\n`, ["g1"])[0]).toContain("5000");
    const edgesOk = Array.from({ length: 5000 }, (_, i) => pair(i)).join("\n");
    expect(ok(`${H}${edgesOk}\n`, ["g1"]).summary.edges).toBe(5000);
    const manyNodes = Array.from({ length: 1001 }, (_, i) => `MEMBER_OF,u${i},g${i}`).join("\n");
    expect(bad(`${H}${manyNodes}\n`, ["g1"])[0]).toContain("2002");
  });
});

describe("cycles and suggestions", () => {
  test("a cycle imports fine", () => {
    const r = ok(`${H}MEMBER_OF,u1,g1\nMEMBER_OF,g1,g2\nMEMBER_OF,g2,g1\nADMIN_ON,g2,H1\n`, ["H1"]);
    expect(r.data.edges.length).toBe(4);
    expect(suggestStart(r.data)).toMatchObject({ suggested: "u1", noPaths: false });
  });
  test("no user with a path gives the first user and noPaths", () => {
    const r = ok(`${H}MEMBER_OF,u1,g1\nHAS_SESSION,H1,u9\n`, ["u9"]);
    expect(suggestStart(r.data)).toMatchObject({ suggested: "u1", noPaths: true });
  });
  test("picks the user with the most paths", () => {
    const r = ok(`${H}MEMBER_OF,a,g1\nMEMBER_OF,b,g1\nMEMBER_OF,b,g2\nADMIN_ON,g1,H1\nADMIN_ON,g2,H1\n`, ["H1"]);
    expect(suggestStart(r.data).suggested).toBe("b");
  });
});

// ---- against the real database ----
const made: string[] = [];
const tenantName = () => {
  const t = `test-import-${Math.random().toString(36).slice(2, 10)}`;
  made.push(t);
  return t;
};
afterAll(async () => {
  for (const t of made) await (await getGraph(t)).delete().catch(() => undefined);
});

describe("importGraph", () => {
  test("sample imports and the trace works, choke point on top", async () => {
    const t = tenantName();
    const r = ok(sampleCsv(), SAMPLE_CROWN);
    const started = performance.now();
    const written = await importGraph(t, r.data, { name: "Contoso Retail" });
    const ms = performance.now() - started;
    console.log(`import of ${written.nodes} nodes / ${written.edges} edges took ${Math.round(ms)} ms`);
    expect(written.nodes).toBe(r.summary.nodes);
    expect(written.edges).toBe(r.summary.edges);
    expect(await getDataset(t)).toEqual({ name: "Contoso Retail", custom: true });

    const s = suggestStart(r.data);
    const res = await attackPaths(s.suggested, { tenant: t });
    console.log(`suggested ${s.suggested}: ${res.total} live paths`);
    expect(res.total).toBeGreaterThan(0);
    expect(res.total).toBe(s.paths);
    const choke = await chokePoints(s.suggested, { tenant: t, top: 3 });
    expect(choke.edges.length).toBeGreaterThan(0);
    expect(choke.edges[0].paths).toBeGreaterThan(0);
    expect(await countPaths(s.suggested, { tenant: t, without: choke.edges[0].id })).toBeLessThan(res.total);
  });
  test("default dataset when there is no Meta node, and a re-import replaces the old data", async () => {
    const t = tenantName();
    await seedGraph(t);
    expect(await getDataset(t)).toEqual({ name: "Northwind Freight", custom: false });
    await importGraph(t, ok(tiny, ["H1"]).data, { name: "x" });
    expect(await getDataset(t)).toEqual({ name: "x", custom: true });
    expect((await attackPaths("u1", { tenant: t })).total).toBe(1);
  });
  test("the Meta node is invisible to Entity queries", async () => {
    const t = tenantName();
    await importGraph(t, ok(tiny, ["H1"]).data, { name: "x" });
    const g = await getGraph(t);
    const res = await g.roQuery(`MATCH (n:Entity) RETURN count(n) AS n`);
    expect(Number((res.data?.[0] as { n: number }).n)).toBe(3);
  });
});

describe("handleImport", () => {
  test("ok, 422, 400", async () => {
    const t = tenantName();
    const good = await handleImport(t, { csv: sampleCsv(), crown: SAMPLE_CROWN, name: "  Shop  " });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ ok: true, dataset: { name: "Shop", custom: true } });
    expect(typeof good.body.suggested).toBe("string");
    const noName = await handleImport(t, { csv: tiny, crown: ["H1"] });
    expect(noName.body.dataset).toEqual({ name: "Your data", custom: true });
    const invalid = await handleImport(t, { csv: tiny, crown: ["zzz"] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.ok).toBe(false);
    expect((invalid.body.errors as string[])[0]).toContain("zzz");
    expect((await handleImport(t, { csv: 5, crown: [] })).status).toBe(400);
    expect((await handleImport(t, { csv: tiny, crown: ["H1"], name: "n".repeat(41) })).status).toBe(400);
  });
  test("a failed import leaves the old graph alone", async () => {
    const t = tenantName();
    await handleImport(t, { csv: tiny, crown: ["H1"] });
    await handleImport(t, { csv: tiny, crown: ["nope"] });
    expect((await attackPaths("u1", { tenant: t })).total).toBe(1);
  });
  test("is rate limited per tenant", async () => {
    const t = tenantName();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await handleImport(t, { csv: tiny, crown: ["H1"] })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(2);
  });
});
