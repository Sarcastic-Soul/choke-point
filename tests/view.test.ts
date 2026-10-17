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
