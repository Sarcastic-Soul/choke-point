import { z } from "zod";
import { runAgent, type AgentEvent } from "@/lib/agent/run";
import { allow, sameOrigin } from "@/lib/guard";
import { tenantFor } from "@/lib/tenant";

export const maxDuration = 60;

const Body = z.object({ message: z.string().min(1).max(500) });
const DAY = 24 * 60 * 60 * 1000;

// Streams newline-delimited JSON: one event per tool call and result, then the checked answer.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { message }" }, { status: 400 });

  // Past the daily model budget the agent keeps working in offline mode: same queries, answer built from the rows.
  const offlineOnly = !(await allow("agent", Number(process.env.AGENT_DAILY_LIMIT ?? 400), DAY));

  const tenant = await tenantFor();

  const enc = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent | { type: "error"; text: string }) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await runAgent(parsed.data.message, emit, tenant, { offlineOnly, signal: req.signal });
      } catch (err) {
        console.error("agent failed", err);
        emit({ type: "error", text: "The agent could not finish. Check that the database is reachable and try again." });
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // client already left
          }
        }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
