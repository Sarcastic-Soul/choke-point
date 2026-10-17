// The logic behind POST /api/import, kept out of route.ts so tests can call it without the sandbox cookie.
import { z } from "zod";
import { allow } from "../guard";
import { getDataset } from "./dataset";
import { parseEdgeCsv, suggestStart } from "./import";
import { importGraph } from "./seed";
import { keepSandbox } from "../tenant";

const Body = z.object({
  csv: z.string(),
  crown: z.array(z.string().max(200)).max(200),
  name: z.string().trim().max(40).optional(),
});

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleImport(tenant: string, raw: unknown): Promise<HandlerResult> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { ok: false, error: "Send { csv, crown, name? }. The name can be up to 40 characters." } };
  const { csv, crown } = parsed.data;
  const name = parsed.data.name || "Your data";

  if (!(await allow("import:" + tenant, 5, 60_000))) {
    return { status: 429, body: { ok: false, error: "Too many imports. Try again in a minute." } };
  }
  const result = parseEdgeCsv(csv, crown);
  if (!result.ok) return { status: 422, body: { ok: false, errors: result.errors } };

  try {
    const picked = suggestStart(result.data);
    await importGraph(tenant, result.data, { name });
    // The import deletes and rewrites the graph, which drops its expiry. Without this the sandbox would never expire.
    await keepSandbox(tenant);
    return {
      status: 200,
      body: { ok: true, summary: result.summary, suggested: picked.suggested, noPaths: picked.noPaths, dataset: await getDataset(tenant) },
    };
  } catch (err) {
    console.error("import failed", err);
    return { status: 500, body: { ok: false, error: "The import failed. Try again." } };
  }
}
