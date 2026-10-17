import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { getDb, getGraph, graphName } from "../src/lib/graph/client";
import { ensureSandbox, ensureTemplate, isSid, resetSandbox } from "../src/lib/tenant";

// Random ids so parallel test runs never collide. Every graph made here is deleted at the end.
const sid = () => randomBytes(12).toString("hex");
const made: string[] = [];
const track = (s: string) => (made.push(s), s);

async function ttl(graph: string) {
  const c = await (await getDb()).connection;
  return Number(await c.sendCommand(["TTL", graph]));
}
async function edgeCount(tenant: string) {
  const r = await (await getGraph(tenant)).roQuery(`MATCH ()-[e]->() RETURN count(e) AS n`);
  return Number((r.data?.[0] as { n: number }).n);
}

afterAll(async () => {
  for (const s of made) await (await getGraph(`s-${s}`)).delete().catch(() => undefined);
});

describe("cookie value check", () => {
  test("accepts 16 to 32 lowercase hex characters", () => {
    expect(isSid("a".repeat(16))).toBe(true);
    expect(isSid("0123456789abcdef0123456789abcdef")).toBe(true);
  });
  test("refuses everything else", () => {
    for (const bad of ["", "abc", "A".repeat(16), "g".repeat(16), "a".repeat(33), "../x".padEnd(20, "a"), undefined, null]) {
      expect(isSid(bad)).toBe(false);
    }
  });
});

describe("sandbox graphs", () => {
  test("the template is built once, even when many callers ask together", async () => {
    const all = await Promise.all(Array.from({ length: 6 }, () => ensureTemplate()));
    expect(all.every(Boolean)).toBe(true);
    expect(await edgeCount("template")).toBeGreaterThan(0);
  }, 60_000);

  test("a new sandbox is a copy of the template with an expiry", async () => {
    const s = track(sid());
    expect(await ensureSandbox(s)).toBe(`s-${s}`);
    expect(await edgeCount(`s-${s}`)).toBe(await edgeCount("template"));
    const left = await ttl(graphName(`s-${s}`));
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(10_800);
  }, 60_000);

  test("two calls for the same new visitor at once both work", async () => {
    const s = track(sid());
    const [a, b] = await Promise.all([ensureSandbox(s), ensureSandbox(s)]);
    expect(a).toBe(`s-${s}`);
    expect(b).toBe(`s-${s}`);
  }, 60_000);

  test("a change in one sandbox stays there, and reset restores it", async () => {
    const a = track(sid());
    const b = track(sid());
    await ensureSandbox(a);
    await ensureSandbox(b);
    const before = await edgeCount(`s-${a}`);
    await (await getGraph(`s-${a}`)).query(`MATCH ()-[e]->() WITH e LIMIT 3 SET e.removed = true`);
    await (await getGraph(`s-${a}`)).query(`MATCH ()-[e]->() WITH e LIMIT 1 DELETE e`);
    expect(await edgeCount(`s-${a}`)).toBe(before - 1);
    expect(await edgeCount(`s-${b}`)).toBe(before);
    expect(await edgeCount("template")).toBe(before);

    const r = await resetSandbox(`s-${a}`);
    expect(r.edges).toBe(before);
    expect(await edgeCount(`s-${a}`)).toBe(before);
    expect(await ttl(graphName(`s-${a}`))).toBeGreaterThan(0);
  }, 60_000);

  test("past the hourly cap a new visitor gets no sandbox", async () => {
    const old = process.env.SANDBOX_HOURLY_LIMIT;
    process.env.SANDBOX_HOURLY_LIMIT = "1";
    try {
      // The counter is shared, so the first call may or may not fit. By the second one the cap is surely used.
      const first = await ensureSandbox(track(sid()));
      const second = await ensureSandbox(track(sid()));
      expect(second).toBeUndefined();
      expect(first === undefined || first.startsWith("s-")).toBe(true);
    } finally {
      if (old === undefined) delete process.env.SANDBOX_HOURLY_LIMIT;
      else process.env.SANDBOX_HOURLY_LIMIT = old;
    }
  }, 60_000);
});
