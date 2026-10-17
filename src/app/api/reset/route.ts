import { allow, sameOrigin } from "@/lib/guard";
import { seedGraph } from "@/lib/graph/seed";

// Demo helper: rebuilds the graph and forgets every approved fix. One reset per 20 seconds, because the graph is shared.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  if (!(await allow("reset", 1, 20_000))) return Response.json({ error: "Someone just reset the demo. Try again in a few seconds." }, { status: 429 });
  try {
    return Response.json(await seedGraph());
  } catch (err) {
    console.error("reset failed", err);
    return Response.json({ error: "Reset failed" }, { status: 500 });
  }
}
