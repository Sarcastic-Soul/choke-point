// The fixed tool catalogue. The model picks a tool and fills typed arguments.
// It never writes Cypher, and every tool re-checks names against the graph itself.
import { tool } from "ai";
import { z } from "zod";
import { draftFix, newPathsSince, recallFixes } from "../graph/fixes";
import {
  attackPaths,
  chokePoints,
  exposedSecrets,
  getEdge,
  loadBearing,
  resolveEntity,
  whatIfRemove,
} from "../graph/queries";

export interface Evidence {
  tool: string;
  input: unknown;
  output: unknown;
}

const identity = z.string().min(1).max(80).describe("Name of the compromised user, group or host, e.g. alice.moreno");

type Unknown = { status: "unknown_entity"; name: string; suggestions: string[] };

async function check(name: string, tenant?: string): Promise<{ ok: true; name: string } | { ok: false; out: Unknown }> {
  const r = await resolveEntity(name, tenant);
  if (r.found) return { ok: true, name: r.entity.name };
  return { ok: false, out: { status: "unknown_entity", name, suggestions: r.suggestions } };
}

export function buildTools(tenant: string | undefined, log: (e: Evidence) => void) {
  const wrap = <I, O>(name: string, fn: (input: I) => Promise<O>) =>
    async (input: I) => {
      const output = await fn(input);
      log({ tool: name, input, output });
      return output;
    };

  return {
    find_entity: tool({
      description: "Look up a name in the graph. Use it when the user's wording does not clearly match a name.",
      inputSchema: z.object({ name: z.string().min(1).max(80) }),
      execute: wrap("find_entity", async ({ name }) => {
        const r = await resolveEntity(name, tenant);
        return r.found ? { status: "found" as const, entity: r.entity } : { status: "unknown_entity" as const, name, suggestions: r.suggestions };
      }),
    }),

    investigate: tool({
      description:
        "Full first response for a compromised identity in one call: attack path count, the shortest routes, the best single fix, the effect of removing it, and a draft fix ticket. Use this first.",
      inputSchema: z.object({ identity }),
      execute: wrap("investigate", async ({ identity }) => {
        const c = await check(identity, tenant);
        if (!c.ok) return c.out;
        const [paths, choke] = await Promise.all([
          attackPaths(c.name, { tenant, limit: 3 }),
          chokePoints(c.name, { tenant, top: 3 }),
        ]);
        const top = choke.edges[0];
        if (!top) return { status: "ok" as const, identity: c.name, total: paths.total, paths: paths.paths, edges: [] };
        const [whatIf, edge] = await Promise.all([whatIfRemove(c.name, top.id, { tenant }), getEdge(top.id, tenant)]);
        return {
          status: "ok" as const,
          identity: c.name,
          total: paths.total,
          paths: paths.paths,
          edges: choke.edges,
          whatIf: { edgeId: top.id, ...whatIf },
          draft: edge ? draftFix(edge) : undefined,
        };
      }),
    }),

    attack_paths: tool({
      description:
        "List the routes an attacker can take from a compromised identity to the crown jewels (domain controller and key secrets). Returns the total number of paths and the shortest ones, hop by hop.",
      inputSchema: z.object({ identity }),
      execute: wrap("attack_paths", async ({ identity }) => {
        const c = await check(identity, tenant);
        if (!c.ok) return c.out;
        const r = await attackPaths(c.name, { tenant, limit: 8 });
        return { status: "ok" as const, identity: c.name, ...r };
      }),
    }),

    choke_points: tool({
      description:
        "Rank the single connections (edges) that sit on the most attack paths from this identity. The top one is the best fix to start with.",
      inputSchema: z.object({ identity }),
      execute: wrap("choke_points", async ({ identity }) => {
        const c = await check(identity, tenant);
        if (!c.ok) return c.out;
        const r = await chokePoints(c.name, { tenant, top: 5 });
        return { status: "ok" as const, identity: c.name, ...r };
      }),
    }),

    what_if_remove: tool({
      description: "Count attack paths again with one edge removed. Use an edge id from choke_points.",
      inputSchema: z.object({ identity, edgeId: z.string().min(1).max(200) }),
      execute: wrap("what_if_remove", async ({ identity, edgeId }) => {
        const c = await check(identity, tenant);
        if (!c.ok) return c.out;
        const edge = await getEdge(edgeId, tenant);
        if (!edge) return { status: "unknown_edge" as const, edgeId };
        const r = await whatIfRemove(c.name, edgeId, { tenant });
        return { status: "ok" as const, identity: c.name, edge, ...r };
      }),
    }),

    exposed_secrets: tool({
      description: "List the secrets this identity can reach, with the number of hops. Crown-jewel secrets come first.",
      inputSchema: z.object({ identity }),
      execute: wrap("exposed_secrets", async ({ identity }) => {
        const c = await check(identity, tenant);
        if (!c.ok) return c.out;
        return { status: "ok" as const, identity: c.name, secrets: await exposedSecrets(c.name, { tenant }) };
      }),
    }),

    load_bearing: tool({
      description: "Rank the most load-bearing nodes in the whole company by betweenness centrality.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
      execute: wrap("load_bearing", async ({ limit }) => ({
        status: "ok" as const,
        nodes: await loadBearing(limit, tenant),
      })),
    }),

    draft_fix: tool({
      description:
        "Write a fix ticket for one edge. It is only a draft: a person approves it in the interface. Nothing changes until then.",
      inputSchema: z.object({ edgeId: z.string().min(1).max(200) }),
      execute: wrap("draft_fix", async ({ edgeId }) => {
        const edge = await getEdge(edgeId, tenant);
        if (!edge) return { status: "unknown_edge" as const, edgeId };
        return { status: "ok" as const, draft: draftFix(edge) };
      }),
    }),

    recall_fixes: tool({
      description: "List fixes that were approved in earlier sessions, newest first.",
      inputSchema: z.object({ identity: identity.optional() }),
      execute: wrap("recall_fixes", async ({ identity }) => {
        if (identity) {
          const c = await check(identity, tenant);
          if (!c.ok) return c.out;
          return { status: "ok" as const, fixes: await recallFixes(c.name, tenant) };
        }
        return { status: "ok" as const, fixes: await recallFixes(undefined, tenant) };
      }),
    }),

    new_paths_since_last_fix: tool({
      description:
        "Find attack paths that use a connection added after the most recent approved fix. Use it when the user asks whether a fix still holds or what changed.",
      inputSchema: z.object({ identity }),
      execute: wrap("new_paths_since_last_fix", async ({ identity }) => {
        const c = await check(identity, tenant);
        if (!c.ok) return c.out;
        const fixes = await recallFixes(c.name, tenant);
        if (!fixes.length) return { status: "no_fix_on_record" as const, identity: c.name };
        const since = fixes[0].at;
        const paths = await newPathsSince(c.name, since, tenant);
        return { status: "ok" as const, identity: c.name, lastFix: fixes[0], newPaths: paths.length, paths: paths.slice(0, 5) };
      }),
    }),
  };
}
