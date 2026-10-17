import { describe, expect, test } from "bun:test";
import { summarize, validateAnswer } from "../src/lib/agent/answer";
import type { Evidence } from "../src/lib/agent/tools";

const edge = { id: "MEMBER_OF:Legacy-VPN-Users>IT-Support", type: "MEMBER_OF", from: "Legacy-VPN-Users", to: "IT-Support", note: "", paths: 30, percent: 91 };
const investigate = (total: number): Evidence => ({
  tool: "investigate",
  input: { identity: "alice.moreno" },
  output: {
    status: "ok",
    identity: "alice.moreno",
    total,
    paths: [],
    edges: total ? [edge] : [],
    whatIf: total ? { edgeId: edge.id, before: 33, after: 3, killed: 30 } : undefined,
  },
});
const names = ["alice.moreno", "Legacy-VPN-Users", "IT-Support", "Backup-Operators"];

describe("validateAnswer", () => {
  test("accepts names and numbers that come from the rows", () => {
    const v = validateAnswer("`alice.moreno` has 33 paths. Cutting `Legacy-VPN-Users` from `IT-Support` leaves 3.", [investigate(33)], names);
    expect(v.ok).toBe(true);
  });
  test("rejects a number that is not in the rows", () => {
    const v = validateAnswer("`alice.moreno` has 34 paths.", [investigate(33)], names);
    expect(v.ok).toBe(false);
  });
  test("rejects a backticked name that is not in the rows", () => {
    const v = validateAnswer("Cut `Backup-Operators` first. `alice.moreno` has 33 paths.", [investigate(33)], names);
    expect(v.ok).toBe(false);
  });
  test("checks spelled-out numbers too", () => {
    expect(validateAnswer("`alice.moreno` has thirty of the thirty-three paths cut, leaving three.", [investigate(33)], names).ok).toBe(true);
    expect(validateAnswer("`alice.moreno` has thirty-four paths.", [investigate(33)], names).ok).toBe(false);
    expect(validateAnswer("There is one new link on `alice.moreno`.", [investigate(33)], names).ok).toBe(true);
  });
  test("never calls zero paths safe", () => {
    const v = validateAnswer("`alice.moreno` is safe, there are 0 paths.", [investigate(0)], names);
    expect(v.ok).toBe(false);
  });
});

describe("summarize", () => {
  test("is built from the rows", () => {
    const text = summarize([investigate(33)]);
    expect(text).toContain("33");
    expect(text).toContain("`Legacy-VPN-Users`");
    expect(text).toContain("91%");
  });
  test("an unknown name is the whole answer", () => {
    const text = summarize([{ tool: "investigate", input: {}, output: { status: "unknown_entity", name: "zed.nobody", suggestions: [] } }]);
    expect(text).toContain("zed.nobody");
    expect(text).toContain("not in the graph");
  });
});
