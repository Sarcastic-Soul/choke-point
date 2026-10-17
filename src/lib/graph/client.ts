import { FalkorDB } from "falkordb";

// One client per warm server instance. A new connection on every request is slow on Vercel.
const globalForDb = globalThis as unknown as { __falkor?: Promise<FalkorDB> };

export function getDb(): Promise<FalkorDB> {
  if (!globalForDb.__falkor) {
    const url = process.env.FALKORDB_URL ?? "falkor://localhost:6379";
    globalForDb.__falkor = FalkorDB.connect({
      url,
      username: process.env.FALKORDB_USERNAME || undefined,
      password: process.env.FALKORDB_PASSWORD || undefined,
      // Idle sockets to a remote host get dropped between serverless invocations.
      pingInterval: 30_000,
      socket: { keepAlive: 5000 },
    }).then((db) => {
      // Without a listener, a dropped socket is an uncaught exception. Forget the client so the next call reconnects.
      db.on("error", () => {
        globalForDb.__falkor = undefined;
      });
      return db;
    }).catch((err) => {
      globalForDb.__falkor = undefined;
      throw err;
    });
  }
  return globalForDb.__falkor;
}

// One graph per tenant: `org:northwind`. Memory (fixes the agent has seen) lives in the same graph.
export const DEFAULT_TENANT = "northwind";

export function graphName(tenant = DEFAULT_TENANT) {
  if (!/^[a-z0-9-]{1,40}$/.test(tenant)) throw new Error("Bad tenant id");
  return `org:${tenant}`;
}

export async function getGraph(tenant = DEFAULT_TENANT) {
  const db = await getDb();
  return db.selectGraph(graphName(tenant));
}
