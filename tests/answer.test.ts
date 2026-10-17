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

const planEvidence = (before: number): Evidence => ({
  tool: "fix_plan",
  input: { identity: "alice.moreno", steps: 2 },
  output: {
    status: "ok",
    scope: "identity",
    identity: "alice.moreno",
    stepCount: before ? 2 : 0,
    before: { paths: before, users: before ? 1 : 0 },
    steps: before
      ? [
          { edgeId: edge.id, type: "MEMBER_OF", from: "Legacy-VPN-Users", to: "IT-Support", note: "", killed: 30, pathsAfter: 3, usersAfter: 1, ticket: { edgeId: edge.id, title: "Remove Legacy-VPN-Users from IT-Support", body: "b", command: "c" } },
          { edgeId: "x", type: "ADMIN_ON", from: "IT-Support", to: "Backup-Operators", note: "", killed: 3, pathsAfter: 0, usersAfter: 0, ticket: { edgeId: "x", title: "t", body: "b", command: "c" } },
        ]
      : [],
    after: { paths: 0, users: 0 },
  },
});
const exposure: Evidence = {
  tool: "company_exposure",
  input: { top: 5 },
  output: {
    status: "ok",
    users: 19,
    usersTotal: 313,
    totalPaths: 366,
    edges: [{ id: edge.id, type: "MEMBER_OF", from: "Legacy-VPN-Users", to: "IT-Support", note: "", paths: 180, users: 6, percent: 49 }],
  },
};

describe("plan and exposure answers", () => {
  test("accepts a truthful sentence about a plan", () => {
    const v = validateAnswer("`alice.moreno` goes from 33 paths to 3 after cutting `Legacy-VPN-Users` from `IT-Support`, which removes 30, and to 0 after the second fix.", [planEvidence(33)], names);
    expect(v.ok).toBe(true);
  });
  test("rejects an invented number or name about a plan", () => {
    expect(validateAnswer("`alice.moreno` goes from 33 paths to 7.", [planEvidence(33)], names).ok).toBe(false);
    expect(validateAnswer("Cut `Domain-Admins` first.", [planEvidence(33)], names).ok).toBe(false);
  });
  test("accepts company numbers and a percent from the rows", () => {
    expect(validateAnswer("19 of 313 users reach a crown jewel. `Legacy-VPN-Users` to `IT-Support` carries 180 of 366 paths (49%).", [exposure], names).ok).toBe(true);
    expect(validateAnswer("20 of 313 users reach a crown jewel.", [exposure], names).ok).toBe(false);
  });
  test("an empty plan is never called safe", () => {
    expect(validateAnswer("`alice.moreno` is safe, with 0 paths.", [planEvidence(0)], names).ok).toBe(false);
    expect(validateAnswer("No path is modeled for `alice.moreno`.", [planEvidence(0)], names).ok).toBe(true);
  });
  test("summarize writes the plan from the rows, without invented numbers", () => {
    const text = summarize([planEvidence(33)]);
    expect(text).toContain("33");
    expect(text).toContain("`Legacy-VPN-Users`");
    expect(text).toContain("First,");
    expect(text).toContain("a person approves");
    expect(validateAnswer(text, [planEvidence(33)], names).ok).toBe(true);
  });
  test("summarize writes the exposure from the rows", () => {
    const text = summarize([exposure]);
    expect(text).toContain("19 of 313 users");
    expect(text).toContain("49%");
    expect(validateAnswer(text, [exposure], names).ok).toBe(true);
  });
  test("summarize for an empty plan says none is modeled", () => {
    expect(summarize([planEvidence(0)])).toContain("not that none exists");
  });
  test("a company plan reports users", () => {
    const ev: Evidence = { tool: "fix_plan", input: {}, output: { status: "ok", scope: "company", before: { paths: 366, users: 19 }, after: { paths: 0, users: 0 }, steps: [{ type: "MEMBER_OF", from: "Legacy-VPN-Users", to: "IT-Support", killed: 366, pathsAfter: 0, usersAfter: 0 }] } };
    const text = summarize([ev]);
    expect(text).toContain("19 users can reach");
    expect(text).toContain("to 0 users");
  });
});
