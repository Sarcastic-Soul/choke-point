import { getGraph } from "../src/lib/graph/client";

// Tiny graph with two routes from "a" to the crown host DC. Both go through u2>g2>DC.
export async function seedTiny(tenant: string) {
  const g = await getGraph(tenant);
  try {
    await g.delete();
  } catch {}
  const h = await getGraph(tenant);
  await h.query(`
    CREATE (a:Entity:User {name:'a', kind:'User', crown:false, dept:'', note:''}),
           (g1:Entity:Group {name:'g1', kind:'Group', crown:false, dept:'', note:''}),
           (g3:Entity:Group {name:'g3', kind:'Group', crown:false, dept:'', note:''}),
           (h1:Entity:Host {name:'h1', kind:'Host', crown:false, dept:'', note:''}),
           (h2:Entity:Host {name:'h2', kind:'Host', crown:false, dept:'', note:''}),
           (u2:Entity:User {name:'u2', kind:'User', crown:false, dept:'', note:''}),
           (g2:Entity:Group {name:'g2', kind:'Group', crown:false, dept:'', note:''}),
           (dc:Entity:Host {name:'DC', kind:'Host', crown:true, dept:'', note:''}),
           (a)-[:MEMBER_OF {id:'a>g1', removed:false, note:''}]->(g1),
           (a)-[:MEMBER_OF {id:'a>g3', removed:false, note:''}]->(g3),
           (g1)-[:ADMIN_ON {id:'g1>h1', removed:false, note:''}]->(h1),
           (g3)-[:ADMIN_ON {id:'g3>h2', removed:false, note:''}]->(h2),
           (h1)-[:HAS_SESSION {id:'h1>u2', removed:false, note:''}]->(u2),
           (h2)-[:HAS_SESSION {id:'h2>u2', removed:false, note:''}]->(u2),
           (u2)-[:MEMBER_OF {id:'u2>g2', removed:false, note:''}]->(g2),
           (g2)-[:ADMIN_ON {id:'g2>DC', removed:false, note:''}]->(dc)`);
}

export async function dropTiny(tenant: string) {
  await (await getGraph(tenant)).delete();
}
