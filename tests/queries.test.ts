// Runs against a local FalkorDB (docker compose up -d). Uses its own tiny graph, tenant "test".
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dropTiny, seedTiny } from "./helpers";
import { attackPaths, chokePoints, countPaths, resolveEntity, whatIfRemove } from "../src/lib/graph/queries";

const T = "test";

beforeAll(() => seedTiny(T));

afterAll(async () => {
  await dropTiny(T);
});

describe("tools", () => {
  test("resolveEntity finds exact names ignoring case", async () => {
    const r = await resolveEntity("U2", T);
    expect(r.found).toBe(true);
  });

  test("resolveEntity reports unknown names with suggestions, and runs no other query", async () => {
    const r = await resolveEntity("g", T);
    expect(r.found).toBe(false);
    if (!r.found) expect(r.suggestions).toContain("g1");
  });

  test("resolveEntity treats model output as data, not Cypher", async () => {
    const r = await resolveEntity("a' }) DETACH DELETE n //", T);
    expect(r.found).toBe(false);
    expect((await resolveEntity("a", T)).found).toBe(true);
  });

  test("attackPaths counts both routes and returns the hops", async () => {
    const res = await attackPaths("a", { tenant: T });
    expect(res.total).toBe(2);
    expect(res.paths[0].nodes[0]).toBe("a");
    expect(res.paths[0].nodes.at(-1)).toBe("DC");
    expect(res.paths[0].edges.length).toBe(res.paths[0].length);
  });

  test("chokePoints puts shared edges first", async () => {
    const res = await chokePoints("a", { tenant: T, top: 2 });
    expect(res.edges[0].paths).toBe(2);
    expect(res.edges[0].percent).toBe(100);
    expect(["g2>DC", "u2>g2"]).toContain(res.edges[0].id.replace(/^[A-Z_]+:/, ""));
  });

  test("whatIfRemove drops every path when the shared edge goes", async () => {
    const res = await whatIfRemove("a", "u2>g2", { tenant: T });
    expect(res).toEqual({ before: 2, after: 0, killed: 2 });
  });

  test("whatIfRemove on a single-route edge leaves the other route", async () => {
    expect(await countPaths("a", { tenant: T, without: "g1>h1" })).toBe(1);
  });

  test("rejects depth outside 1..10", async () => {
    await expect(attackPaths("a", { tenant: T, maxDepth: 99 })).rejects.toThrow();
  });
});
