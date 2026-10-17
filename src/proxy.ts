// Gives each visitor a sandbox id on their first page load. The id is only a name: the private graph is made later, on the first API call.
// API calls without the cookie (curl, tests) keep using the shared default graph.
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "cp_sid";
const VALID = /^[a-f0-9]{16,32}$/;

export function proxy(req: NextRequest) {
  const current = req.cookies.get(COOKIE)?.value;
  const sid = current && VALID.test(current) ? current : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

  const res = NextResponse.next();

  const ttl = Number(process.env.SANDBOX_TTL_SECONDS);
  const secure = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  // Set again on every page load, so the cookie lasts as long as the sandbox does.
  res.cookies.set(COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: ttl > 0 ? Math.floor(ttl) : 10_800,
  });
  return res;
}

// Page loads only. API routes are left alone.
export const config = { matcher: "/" };
