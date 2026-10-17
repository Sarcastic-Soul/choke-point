import { generate } from "../data/generate";
import { getGraph, graphName } from "./client";

// Builds the whole graph for one tenant from the generator. Deletes what was there, including memory.
export async function seedGraph(tenant?: string) {
  const data = generate();
  try {
    await (await getGraph(tenant)).delete();
  } catch {
    // graph did not exist yet
  }
  const g = await getGraph(tenant);

  for (const kind of ["User", "Group", "Host", "Secret", "Entity"]) {
    await g.query(`CREATE INDEX FOR (n:${kind}) ON (n.name)`).catch(() => undefined);
  }

  // Every node also gets the :Entity label so queries and algorithms can address all of them at once.
  const byKind = new Map<string, typeof data.nodes>();
  for (const n of data.nodes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);
  for (const [kind, rows] of byKind) {
    await g.query(
      `UNWIND $rows AS r CREATE (n:Entity:${kind} {name: r.name, kind: r.kind, crown: r.crown, dept: r.dept, note: r.note})`,
      {
        params: {
          rows: rows.map((r) => ({
            name: r.name,
            kind: r.kind,
            crown: r.crown ?? false,
            dept: r.dept ?? "",
            note: r.note ?? "",
          })),
        },
      },
    );
  }

  for (const type of ["MEMBER_OF", "ADMIN_ON", "HAS_SESSION", "CAN_READ"] as const) {
    const rows = data.edges
      .filter((e) => e.type === type)
      .map((e) => ({ id: e.id, from: e.from, to: e.to, note: e.note ?? "" }));
    await g.query(
      `UNWIND $rows AS r
       MATCH (a:Entity {name: r.from}), (b:Entity {name: r.to})
       CREATE (a)-[:${type} {id: r.id, weight: 1, removed: false, addedAt: 0, note: r.note}]->(b)`,
      { params: { rows } },
    );
  }

  const n = await g.roQuery(`MATCH (n:Entity) RETURN count(n) AS nodes`);
  const e = await g.roQuery(`MATCH ()-[e]->() RETURN count(e) AS edges`);
  return {
    graph: graphName(tenant),
    nodes: Number((n.data?.[0] as { nodes: number }).nodes),
    edges: Number((e.data?.[0] as { edges: number }).edges),
  };
}
