// Which graph a request works on. `undefined` means the shared default graph (`org:northwind`).
// A visitor who has the sandbox cookie (`cp_sid`, set by src/proxy.ts) gets a private copy of the demo graph instead.
// The copy is made from a pristine template graph (`org:template`) and expires when the visitor goes quiet.
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb, getGraph, graphName } from "./graph/client";
import { seedGraph } from "./graph/seed";
import { allow } from "./guard";

export const SANDBOX_COOKIE = "cp_sid";
const SID = /^[a-f0-9]{16,32}$/;
const TEMPLATE = "template";
const HOUR = 60 * 60 * 1000;
// A warm instance skips the database when it touched the same sandbox this recently.
const REFRESH_EVERY = 60_000;

export const sandboxTtl = () => {
  const n = Number(process.env.SANDBOX_TTL_SECONDS);
  return n > 0 ? Math.floor(n) : 10_800;
};
const hourlyLimit = () => {
  const n = Number(process.env.SANDBOX_HOURLY_LIMIT);
  return n > 0 ? n : 300;
};

export const isSid = (v: unknown): v is string => typeof v === "string" && SID.test(v);

async function raw(args: string[]) {
  const c = await (await getDb()).connection;
  return c.sendCommand(args);
}

// A graph is a Redis key, so EXPIRE sets its time to live. It answers 1 when the key exists and 0 when it does not.
async function expire(graph: string, seconds: number) {
  return Number(await raw(["EXPIRE", graph, String(seconds)])) === 1;
}

/** Puts the expiry back on a visitor's graph. Deleting and rewriting a graph (an import) drops the old expiry. */
export async function keepSandbox(tenant: string) {
  return expire(graphName(tenant), sandboxTtl());
}

async function exists(graph: string) {
  return Number(await raw(["EXISTS", graph])) === 1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Makes sure `org:template` exists. Many first visitors can arrive at once on different serverless instances,
// so one of them builds it and the rest wait for it.
// The build goes into a scratch graph first and is copied over in one step, so nobody can copy a half-built template.
export async function ensureTemplate(): Promise<boolean> {
  const key = graphName(TEMPLATE);
  if (await exists(key)) return true;

  // FalkorDB Cloud does not let our user run SET or EVAL, so the lock is a counter in the guard graph:
  // the first caller in each two-minute window gets to build, everyone else waits for the result.
  const got = await allow("template-build", 1, 120_000);
  if (got) {
    const scratch = `${TEMPLATE}-build-${randomBytes(8).toString("hex")}`;
    try {
      if (!(await exists(key))) {
        await seedGraph(scratch);
        await (await getGraph(scratch)).copy(key);
      }
    } finally {
      await (await getGraph(scratch)).delete().catch(() => undefined);
    }
    return exists(key);
  }

  for (let i = 0; i < 100; i++) {
    await sleep(400);
    if (await exists(key)) return true;
  }
  return false;
}

// Copies the template into a new graph. If another request made it first, that is fine too.
async function copyFromTemplate(name: string) {
  try {
    await (await getGraph(TEMPLATE)).copy(name);
  } catch (err) {
    if (!(await exists(name))) throw err;
  }
  await expire(name, sandboxTtl());
}

const fresh = new Map<string, number>();
const pending = new Map<string, Promise<string | undefined>>();

// Returns the tenant id `s-<sid>`, creating the graph if it is not there. `undefined` when the hourly cap is hit.
export function ensureSandbox(sid: string): Promise<string | undefined> {
  const inFlight = pending.get(sid);
  if (inFlight) return inFlight;
  const p = (async () => {
    const tenant = `s-${sid}`;
    const name = graphName(tenant);
    const seen = fresh.get(sid);
    if (seen && Date.now() - seen < REFRESH_EVERY) return tenant;
    // Every visit pushes the expiry forward. If the key is already gone, the visitor needs a new copy.
    if (await expire(name, sandboxTtl())) {
      fresh.set(sid, Date.now());
      return tenant;
    }
    if (!(await allow("sandbox", hourlyLimit(), HOUR))) return undefined;
    if (!(await ensureTemplate())) return undefined;
    await copyFromTemplate(name);
    fresh.set(sid, Date.now());
    return tenant;
  })().finally(() => pending.delete(sid));
  pending.set(sid, p);
  return p;
}

/** Throws away a visitor's changes: deletes their graph and copies the template again. */
export async function resetSandbox(tenant: string) {
  if (!(await ensureTemplate())) throw new Error("Template graph is not ready");
  const g = await getGraph(tenant);
  await g.delete().catch(() => undefined);
  await copyFromTemplate(graphName(tenant));
  fresh.set(tenant.replace(/^s-/, ""), Date.now());
  const h = await getGraph(tenant);
  const n = await h.roQuery(`MATCH (n:Entity) RETURN count(n) AS nodes`);
  const e = await h.roQuery(`MATCH ()-[e]->() RETURN count(e) AS edges`);
  return {
    graph: graphName(tenant),
    nodes: Number((n.data?.[0] as { nodes: number }).nodes),
    edges: Number((e.data?.[0] as { edges: number }).edges),
  };
}

// If the database was emptied (a Cloud restart, say), the shared default graph is gone too. Rebuild it once, so
// visitors without the cookie, such as scripts and link previews, do not get errors.
let defaultSeen = 0;
async function ensureDefault() {
  if (Date.now() - defaultSeen < REFRESH_EVERY) return;
  try {
    if (!(await exists(graphName()))) {
      if (!(await allow("default-build", 1, 120_000))) return;
      await seedGraph();
    }
    defaultSeen = Date.now();
  } catch (err) {
    console.error("default graph check failed", err);
  }
}

export async function tenantFor(): Promise<string | undefined> {
  const sid = (await cookies()).get(SANDBOX_COOKIE)?.value;
  if (isSid(sid)) {
    try {
      const tenant = await ensureSandbox(sid);
      if (tenant) return tenant;
    } catch (err) {
      // If the sandbox cannot be made, the visitor still gets the shared demo instead of an error page.
      console.error("sandbox failed", err);
    }
  }
  await ensureDefault();
  return undefined;
}

/** True when the request works on a private sandbox graph, not the shared default. */
export async function inSandbox(): Promise<boolean> {
  return (await tenantFor()) !== undefined;
}
