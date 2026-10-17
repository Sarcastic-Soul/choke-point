import { allow, sameOrigin } from "@/lib/guard";
import { seedGraph } from "@/lib/graph/seed";
import { resetSandbox, tenantFor } from "@/lib/tenant";

// Demo helper: forgets every approved fix. A visitor with a sandbox gets a fresh copy of the template (one reset per 5 seconds).
// Without a sandbox it rebuilds the shared graph, one reset per 20 seconds, because everyone sees that one.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const tenant = await tenantFor();
  if (tenant) {
    if (!(await allow(`reset:${tenant}`, 1, 5_000))) return Response.json({ error: "Easy there. Try again in a few seconds." }, { status: 429 });
  } else if (!(await allow("reset", 1, 20_000))) {
    return Response.json({ error: "Someone just reset the demo. Try again in a few seconds." }, { status: 429 });
  }
  try {
    return Response.json(tenant ? await resetSandbox(tenant) : await seedGraph());
  } catch (err) {
    console.error("reset failed", err);
    return Response.json({ error: "Reset failed" }, { status: 500 });
  }
}
