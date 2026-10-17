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

// Same limits as the server: at most this many edges per walk, and a cap on work for tangled graphs.
const MAX_WALK = 10;
const STEP_CAP = 200_000;

// Walks from the identity to a crown node, each edge used at most once per walk and at most MAX_WALK edges.
// This is what Cypher `*1..10` counts, so it also holds when group nesting loops back on itself.
export function countWalks(g: PathGraph, edges: ViewEdge[], stepCap = STEP_CAP) {
  const crown = new Map(g.nodes.map((n) => [n.id, n.crown]));
  const out = new Map<string, ViewEdge[]>();
  const into = new Map<string, string[]>();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e);
    if (!into.has(e.target)) into.set(e.target, []);
    into.get(e.target)!.push(e.source);
  }
  // Only walk toward nodes that can still reach a crown node.
  const useful = new Set<string>();
  const queue = g.nodes.filter((n) => n.crown).map((n) => n.id);
  for (const id of queue) useful.add(id);
  while (queue.length) {
    for (const p of into.get(queue.shift()!) ?? []) {
      if (useful.has(p)) continue;
      useful.add(p);
      queue.push(p);
    }
  }

  const edgeUse = new Map<string, number>(edges.map((e) => [e.id, 0]));
  const used = new Set<string>();
  const stack: ViewEdge[] = [];
  let total = 0;
  let steps = 0;
  let capped = false;
  const walk = (at: string) => {
    if (stack.length >= MAX_WALK) return;
    for (const e of out.get(at) ?? []) {
      if (capped) return;
      if (used.has(e.id) || !useful.has(e.target)) continue;
      if (++steps > stepCap) {
        capped = true;
        return;
      }
      used.add(e.id);
      stack.push(e);
      if (crown.get(e.target)) {
        total += 1;
        for (const s of stack) edgeUse.set(s.id, (edgeUse.get(s.id) ?? 0) + 1);
      }
      walk(e.target);
      stack.pop();
      used.delete(e.id);
    }
  };
  walk(g.from);
  return capped ? { total, edgeUse, capped: true as const } : { total, edgeUse };
}

// Counts paths from the compromised identity to any crown jewel, and how many paths use each edge.
// An acyclic graph is counted with fast dynamic programming. A graph with a loop is counted by walking
// it edge by edge, like the server does, and `capped` is set if that gave up early. Pass `without` to leave one edge out.
export function analyze(g: PathGraph, without?: string): { total: number; edgeUse: Map<string, number>; capped?: boolean } {
  const edges = g.edges.filter((e) => e.id !== without);
  const { order, out } = topoOrder(g, edges);
  if (order.length < g.nodes.length) return countWalks(g, edges);

  // A chain longer than the server's limit would be counted here but not there.
  const hops = new Map<string, number>([[g.from, 0]]);
  for (const n of order) {
    if (!hops.has(n)) continue;
    for (const e of out.get(n) ?? []) hops.set(e.target, Math.max(hops.get(e.target) ?? 0, hops.get(n)! + 1));
  }
  if (Math.max(...hops.values()) > MAX_WALK) return countWalks(g, edges);

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
// When the graph has a loop there is no longest distance, so columns are the shortest distance instead.
export function layout(g: PathGraph, colW = 210, rowH = 64) {
  const { order, out } = topoOrder(g, g.edges);
  const depth = new Map<string, number>([[g.from, 0]]);
  if (order.length < g.nodes.length) {
    const queue = [g.from];
    while (queue.length) {
      const n = queue.shift()!;
      for (const e of out.get(n) ?? []) {
        if (!depth.has(e.target)) {
          depth.set(e.target, depth.get(n)! + 1);
          queue.push(e.target);
        }
      }
    }
  } else {
    for (const n of order) {
      for (const e of out.get(n) ?? []) depth.set(e.target, Math.max(depth.get(e.target) ?? 0, (depth.get(n) ?? 0) + 1));
    }
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
