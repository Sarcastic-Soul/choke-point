import { z } from "zod";
import { approveFix, FixError } from "@/lib/graph/fixes";
import { resolveEntity } from "@/lib/graph/queries";
import { sameOrigin } from "@/lib/guard";

const Body = z.object({ from: z.string().min(1).max(80), edgeId: z.string().min(1).max(200) });

// The only route that changes the graph on the agent's behalf. It is called by a person clicking "Approve".
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { from, edgeId }" }, { status: 400 });
  try {
    const r = await resolveEntity(parsed.data.from);
    if (!r.found) return Response.json({ error: "Unknown identity" }, { status: 404 });
    return Response.json(await approveFix(r.entity.name, parsed.data.edgeId));
  } catch (err) {
    if (err instanceof FixError) return Response.json({ error: err.message }, { status: 409 });
    console.error("approve failed", err);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
