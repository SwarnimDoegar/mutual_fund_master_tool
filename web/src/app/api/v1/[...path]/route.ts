// Same-origin pass-through to mf-api for client components (search-as-you-type, calculators,
// chart period switches). The browser never needs to know where the API lives, and mf-api's
// caching headers (ETag, Cache-Control, Vary) and problem+json errors pass through unchanged.
import type { NextRequest } from "next/server";

const BASE = (process.env.MF_API_URL ?? "http://localhost:18080").replace(/\/+$/, "");
const FORWARD_RESPONSE = ["content-type", "cache-control", "etag", "vary", "retry-after", "x-cache"];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/[...path]">) {
  const { path } = await ctx.params;
  const url = `${BASE}/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers({ accept: "application/json" });
  const inm = req.headers.get("if-none-match");
  if (inm) headers.set("if-none-match", inm);

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
  } catch {
    return Response.json(
      { type: "about:blank", title: "Bad Gateway", status: 502, detail: "the data service is unreachable" },
      { status: 502, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } },
    );
  }
  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}
