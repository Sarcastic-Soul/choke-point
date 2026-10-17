import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { approveFix, draftFix, FixError, newPathsSince, recallFixes, simulateDrift } from "../src/lib/graph/fixes";
import { countPaths } from "../src/lib/graph/queries";
import { dropTiny, seedTiny } from "./helpers";

const T = "test-fixes";

beforeAll(() => seedTiny(T));
afterAll(async () => {
  await dropTiny(T);
});

describe("draftFix", () => {
  test("uses only names from the edge", () => {
    const d = draftFix({ id: "MEMBER_OF:x>y", type: "MEMBER_OF", from: "x", to: "y", note: "" });
    expect(d.title).toBe("Remove x from y");
    expect(d.command).toContain('"y"');
    expect(d.command).toContain('"x"');
  });
});

describe("memory", () => {
  test("approveFix removes the edge from later scans and remembers it", async () => {
    expect(await countPaths("a", { tenant: T })).toBe(2);
    const rec = await approveFix("a", "u2>g2", T);
    expect(rec.pathsBefore).toBe(2);
    expect(rec.pathsAfter).toBe(0);
    expect(await countPaths("a", { tenant: T })).toBe(0);
    const recalled = await recallFixes("a", T);
    expect(recalled).toHaveLength(1);
    expect(recalled[0].edgeId).toBe("u2>g2");
  });

  test("approving the same edge again is refused and stores nothing", async () => {
    await expect(approveFix("a", "u2>g2", T)).rejects.toBeInstanceOf(FixError);
    expect(await recallFixes("a", T)).toHaveLength(1);
  });

  test("an edge that is on no live path is not a fix", async () => {
    await expect(approveFix("a", "a>g1", T)).rejects.toBeInstanceOf(FixError);
  });

  test("simulateDrift says so when the demo groups are missing", async () => {
    await expect(simulateDrift(T)).rejects.toBeInstanceOf(FixError);
  });

  test("newPathsSince finds only paths through edges added after the fix", async () => {
    const since = Date.now();
    expect(await newPathsSince("a", since, T)).toHaveLength(0);
  });
});
