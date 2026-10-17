// Share links carry only two things: who is being scanned and which link is focused.
export interface LinkState {
  from?: string;
  edge?: string;
}

const MAX_FROM = 80;
const MAX_EDGE = 200;

// Control characters and line breaks have no place in a name or id, so they are dropped.
function clean(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/[\p{Cc}\u2028\u2029]/gu, "").trim();
  // Cut by code point so an emoji is never split in half.
  const out = Array.from(text).slice(0, max).join("").trim();
  return out || undefined;
}

export function readLink(search: string): LinkState {
  const params = new URLSearchParams(search);
  const out: LinkState = {};
  const from = clean(params.get("from"), MAX_FROM);
  const edge = clean(params.get("edge"), MAX_EDGE);
  if (from) out.from = from;
  if (edge) out.edge = edge;
  return out;
}

// Throws a TypeError if origin is not a valid URL.
export function buildLink(origin: string, { from, edge }: LinkState): string {
  const url = new URL(origin);
  const f = clean(from, MAX_FROM);
  const e = clean(edge, MAX_EDGE);
  url.search = "";
  url.hash = "";
  if (f) url.searchParams.set("from", f);
  if (e) url.searchParams.set("edge", e);
  return url.toString();
}
