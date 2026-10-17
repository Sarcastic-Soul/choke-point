import { FixError, simulateDrift } from "@/lib/graph/fixes";
import { sameOrigin } from "@/lib/guard";
import { tenantFor } from "@/lib/tenant";

// Demo helper: adds a new permission, like a real change ticket would.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  try {
    return Response.json(await simulateDrift(await tenantFor()));
  } catch (err) {
    if (err instanceof FixError) return Response.json({ error: err.message }, { status: 409 });
    console.error("drift failed", err);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
