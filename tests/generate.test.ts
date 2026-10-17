import { describe, expect, test } from "bun:test";
import { DEMO_VICTIM, generate } from "../src/lib/data/generate";

describe("generate()", () => {
  const data = generate();

  test("is deterministic", () => {
    expect(generate()).toEqual(data);
  });

  test("has unique node names and edge ids", () => {
    expect(new Set(data.nodes.map((n) => n.name)).size).toBe(data.nodes.length);
    expect(new Set(data.edges.map((e) => e.id)).size).toBe(data.edges.length);
  });

  test("every edge points at real nodes", () => {
    const names = new Set(data.nodes.map((n) => n.name));
    for (const e of data.edges) {
      expect(names.has(e.from)).toBe(true);
      expect(names.has(e.to)).toBe(true);
    }
  });

  test("has crown jewels and the demo victim", () => {
    expect(data.nodes.filter((n) => n.crown).length).toBeGreaterThanOrEqual(3);
    expect(data.nodes.some((n) => n.name === DEMO_VICTIM)).toBe(true);
  });

  test("has no cycles, so path counts stay exact", () => {
    const next = new Map<string, string[]>();
    for (const e of data.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = finished
    const visit = (n: string): boolean => {
      if (state.get(n) === 1) return true;
      if (state.get(n) === 2) return false;
      state.set(n, 1);
      for (const m of next.get(n) ?? []) if (visit(m)) return true;
      state.set(n, 2);
      return false;
    };
    for (const n of data.nodes) expect(visit(n.name)).toBe(false);
  });
});
