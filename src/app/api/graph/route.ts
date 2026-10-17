import { NextRequest } from "next/server";
import { recallFixes } from "@/lib/graph/fixes";
import { chokePoints, pathGraph, resolveEntity } from "@/lib/graph/queries";


// GET /api/graph?from=alice.moreno : the attack-path subgraph, the ranked choke points and past fixes.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const r = await resolveEntity(from);
  if (!r.found) return Response.json({ status: "unknown_entity", name: from, suggestions: r.suggestions }, { status: 404 });
  const [graph, choke, fixes] = await Promise.all([
    pathGraph(r.entity.name),
    chokePoints(r.entity.name, { top: 5 }),
    recallFixes(r.entity.name),
  ]);
  return Response.json({ status: "ok", entity: r.entity, ...graph, choke: choke.edges, fixes });
}
