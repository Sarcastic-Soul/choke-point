import { NextRequest } from "next/server";
import { recallFixes } from "@/lib/graph/fixes";
import { getDataset } from "@/lib/graph/dataset";
import { tenantFor } from "@/lib/tenant";
import { chokePoints, pathGraph, resolveEntity } from "@/lib/graph/queries";

// GET /api/graph?from=alice.moreno : the attack-path subgraph, the ranked choke points and past fixes.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const tenant = await tenantFor();
  const r = await resolveEntity(from, tenant);
  if (!r.found) return Response.json({ status: "unknown_entity", name: from, suggestions: r.suggestions }, { status: 200 });
  const [graph, choke, fixes, dataset] = await Promise.all([
    pathGraph(r.entity.name, { tenant }),
    chokePoints(r.entity.name, { top: 5, tenant }),
    recallFixes(r.entity.name, tenant),
    getDataset(tenant),
  ]);
  return Response.json({ status: "ok", entity: r.entity, ...graph, choke: choke.edges, fixes, sandbox: tenant !== undefined, dataset });
}
