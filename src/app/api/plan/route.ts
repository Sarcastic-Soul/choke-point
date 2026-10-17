import { NextRequest } from "next/server";
import { fixPlan, isTimeout } from "@/lib/graph/plan";
import { resolveEntity } from "@/lib/graph/queries";
import { tenantFor } from "@/lib/tenant";

// GET /api/plan?from=alice.moreno&steps=3 : a greedy fix plan. No `from` means the whole company.
// Advice only: nothing here writes to the graph.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const from = (q.get("from") ?? "").trim();
  const asked = Number(q.get("steps") ?? 3);
  const steps = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 5) : 3;
  try {
    const tenant = await tenantFor();
    let identity: string | undefined;
    if (from) {
      const r = await resolveEntity(from, tenant);
      if (!r.found) return Response.json({ status: "unknown_entity", name: from, suggestions: r.suggestions }, { status: 200 });
      identity = r.entity.name;
    }
    const plan = await fixPlan({ identity, steps, tenant });
    return Response.json({ status: "ok", ...plan });
  } catch (err) {
    // A clear message for the page, never a stack trace.
    if (isTimeout(err)) return Response.json({ status: "error", error: "The plan took too long to work out. Try again, or ask for fewer steps." }, { status: 504 });
    return Response.json({ status: "error", error: "Could not work out the plan. Check that the database is running." }, { status: 500 });
  }
}
