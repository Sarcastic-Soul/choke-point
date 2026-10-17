// Pure helpers for the graph view. No browser code, so they are tested with `bun test`.
export interface ViewNode {
  id: string;
  kind: string;
  crown: boolean;
}
export interface ViewEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  note: string;
  paths: number;
  addedAt: number;
}
export interface PathGraph {
  from: string;
  total: number;
  nodes: ViewNode[];
  edges: ViewEdge[];
}

function topoOrder(g: PathGraph, edges: ViewEdge[]) {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  const out = new Map<string, ViewEdge[]>();
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
  }
  const queue = g.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const e of out.get(n) ?? []) {
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (!indeg.get(e.target)) queue.push(e.target);
    }
  }
  return { order, out };
}

// Counts paths from the compromised identity to any crown jewel, and how many paths use each edge.
// Works on the attack-path subgraph, which is acyclic. Pass `without` to leave one edge out.
export function analyze(g: PathGraph, without?: string) {
  const edges = g.edges.filter((e) => e.id !== without);
  const { order, out } = topoOrder(g, edges);
  const crown = new Map(g.nodes.map((n) => [n.id, n.crown]));

  const fwd = new Map<string, number>([[g.from, 1]]);
  for (const n of order) {
    for (const e of out.get(n) ?? []) fwd.set(e.target, (fwd.get(e.target) ?? 0) + (fwd.get(n) ?? 0));
  }
  const bwd = new Map<string, number>();
  for (const n of [...order].reverse()) {
    let sum = crown.get(n) ? 1 : 0;
    for (const e of out.get(n) ?? []) sum += bwd.get(e.target) ?? 0;
    bwd.set(n, sum);
  }
  const edgeUse = new Map<string, number>();
  for (const e of edges) edgeUse.set(e.id, (fwd.get(e.source) ?? 0) * (bwd.get(e.target) ?? 0));
  const total = (bwd.get(g.from) ?? 0) - (crown.get(g.from) ? 1 : 0);
  return { total, edgeUse };
}

// Left-to-right layers: column = longest distance from the identity, crown jewels in the last column.
export function layout(g: PathGraph, colW = 210, rowH = 64) {
  const { order, out } = topoOrder(g, g.edges);
  const depth = new Map<string, number>([[g.from, 0]]);
  for (const n of order) {
    for (const e of out.get(n) ?? []) depth.set(e.target, Math.max(depth.get(e.target) ?? 0, (depth.get(n) ?? 0) + 1));
  }
  const max = Math.max(...depth.values(), 0);
  for (const n of g.nodes) if (n.crown) depth.set(n.id, max);

  const cols: string[][] = Array.from({ length: max + 1 }, () => []);
  for (const n of [...g.nodes].sort((a, b) => a.id.localeCompare(b.id))) cols[depth.get(n.id) ?? 0].push(n.id);

  const parents = new Map<string, string[]>();
  for (const e of g.edges) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
  const y = new Map<string, number>();
  cols.forEach((col, ci) => {
    if (ci > 0) {
      const key = (id: string) => {
        const ps = (parents.get(id) ?? []).map((p) => y.get(p) ?? 0);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
      };
      col.sort((a, b) => key(a) - key(b));
    }
    col.forEach((id, i) => y.set(id, (i - (col.length - 1) / 2) * rowH));
  });

  const pos = new Map<string, { x: number; y: number }>();
  for (const n of g.nodes) pos.set(n.id, { x: (depth.get(n.id) ?? 0) * colW, y: y.get(n.id) ?? 0 });
  return pos;
}
