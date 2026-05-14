/**
 * api/middleware.ts, composable request wrappers for v1 routes.
 *
 * `withApi(handler, opts)` applies, in order:
 *   1. Per-IP rate limit (returns 429 with Retry-After if exceeded)
 *   2. Standard headers (X-RateLimit-*, optional Cache-Control)
 *   3. Calls handler
 *   4. Catches uncaught errors → 500 with safe message
 *
 * Designed for Next.js App Router route handlers that look like:
 *
 *   export const GET = withApi(async (req) => {
 *     return NextResponse.json({ ... });
 *   }, { cacheHeaders: CACHE_HEADERS_AGGREGATE });
 */

import { NextResponse } from "next/server";
import { checkRate, ipFromRequest } from "./ratelimit";

interface ApiOptions {
  /** Headers to merge into every successful response (e.g. Cache-Control) */
  cacheHeaders?: Record<string, string>;
  /** Override default 60 req/min */
  rateLimit?: number;
  /** Override default 60_000 ms window */
  rateLimitWindowMs?: number;
  /** Skip rate limit (used for /api/v1/live where the connection IS the rate) */
  skipRateLimit?: boolean;
}

// Next.js's route-handler validator requires the second arg to have
// `params: Promise<any>` exactly (not optional). For static routes the
// promise just resolves to an empty object, same shape, no fuss.
type RouteCtx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: RouteCtx) => Promise<Response> | Response;

export function withApi(handler: Handler, opts: ApiOptions = {}): Handler {
  return async (req, ctx) => {
    // ─── 1. Rate limit ────────────────────────────────────────
    if (!opts.skipRateLimit) {
      const ip = ipFromRequest(req);
      const result = checkRate(
        ip,
        opts.rateLimit ?? 60,
        opts.rateLimitWindowMs ?? 60_000,
      );
      if (!result.allowed) {
        return new NextResponse(
          JSON.stringify({
            error: "rate limit exceeded",
            retryAfterMs: result.resetMs,
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(Math.ceil(result.resetMs / 1000)),
              "x-ratelimit-limit": String(opts.rateLimit ?? 60),
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + Math.ceil(result.resetMs / 1000)),
            },
          },
        );
      }
    }

    // ─── 2. Call handler with error guard ────────────────────
    let response: Response;
    try {
      response = await handler(req, ctx);
    } catch (err) {
      // Don't leak stack traces. Log full detail server-side, return generic JSON.
      console.error("[api]", req.method, new URL(req.url).pathname, err);
      return NextResponse.json(
        { error: "internal error" },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }

    // ─── 3. Apply standard headers ───────────────────────────
    if (opts.cacheHeaders) {
      for (const [k, v] of Object.entries(opts.cacheHeaders)) {
        if (!response.headers.has(k)) response.headers.set(k, v);
      }
    }
    // CORS, public read API
    response.headers.set("access-control-allow-origin", "*");
    response.headers.set("access-control-allow-methods", "GET");
    response.headers.set("x-pev-version", "v1");

    return response;
  };
}
