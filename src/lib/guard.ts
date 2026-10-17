// Small protections for a public deployment. State lives in FalkorDB (graph "guard"), so every serverless instance shares it.
import { getDb } from "./graph/client";

// Browsers send Sec-Fetch-Site and Origin on POST. Reject calls that come from another site.
export function sameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    } catch {
      return false;
    }
  }
  return true;
}

async function bump(key: string): Promise<number> {
  const g = (await getDb()).selectGraph("guard");
  const res = await g.query(`MERGE (m:Meta {k: $k}) SET m.n = coalesce(m.n, 0) + 1 RETURN m.n AS n`, { params: { k: key } });
  return Number((res.data?.[0] as { n?: number } | undefined)?.n ?? 1);
}

// True while the number of calls in the current window is within the limit. If the guard itself fails, allow the call.
export async function allow(name: string, limit: number, windowMs: number) {
  try {
    return (await bump(`${name}:${Math.floor(Date.now() / windowMs)}`)) <= limit;
  } catch {
    return true;
  }
}
