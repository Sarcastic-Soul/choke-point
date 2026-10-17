import { NextRequest } from "next/server";
import { getEdge, resolveEntity, whatIfRemove } from "@/lib/graph/queries";
import { draftFix } from "@/lib/graph/fixes";

// GET /api/whatif?from=alice.moreno&edge=<id> : paths before and after one edge is left out, plus the draft fix.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const edgeId = req.nextUrl.searchParams.get("edge") ?? "";
  const r = await resolveEntity(from);
  if (!r.found) return Response.json({ error: "Unknown identity" }, { status: 404 });
  const edge = await getEdge(edgeId);
  if (!edge) return Response.json({ error: "Unknown edge" }, { status: 404 });
  const res = await whatIfRemove(r.entity.name, edgeId);
  return Response.json({ ...res, edge, draft: draftFix(edge) });
}
