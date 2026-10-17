import { handleImport } from "@/lib/graph/import-handler";
import { sameOrigin } from "@/lib/guard";
import { tenantFor } from "@/lib/tenant";

// A little over the 1 MB of CSV text, to leave room for the crown list and JSON escaping.
const MAX_BODY = 1_200_000;
const TOO_BIG = { ok: false, error: "That file is too big. The limit is 1 MB." };

// Reads the body but stops as soon as it passes the limit, so a huge upload is never held in memory.
async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Replaces the visitor's private sandbox graph with their own data. Never touches the shared demo graph.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "Not allowed" }, { status: 403 });
  const tenant = await tenantFor();
  if (!tenant) return Response.json({ ok: false, error: "Open the page first so you get your own sandbox" }, { status: 403 });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json(TOO_BIG, { status: 413 });
  const text = await readCapped(req).catch(() => "");
  if (text === null) return Response.json(TOO_BIG, { status: 413 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // the shape check in handleImport answers with a 400
  }
  const { status, body } = await handleImport(tenant, raw);
  return Response.json(body, { status });
}
