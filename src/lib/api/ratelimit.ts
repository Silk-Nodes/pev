/**
 * api/ratelimit.ts, token-bucket per IP.
 *
 * In-process Map. Single Next.js instance assumption. When we go
 * multi-instance we'd need Redis or sticky sessions; for now this is
 * the right call.
 *
 * Default: 60 requests/minute per IP. Tokens refill linearly over the
 * window so a burst of 60 can happen instantly, then 1 req/sec
 * sustained after. Plenty for legit usage; trips obvious abuse.
 *
 * The /api/v1/live SSE endpoint is exempt, the hold-open connection
 * isn't a per-second request, it's one long subscription. We rate-limit
 * the *connect*, not the stream.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
let lastJanitor = Date.now();
const JANITOR_INTERVAL_MS = 5 * 60_000;

/** Sweep idle buckets every 5 min to keep memory bounded under abuse. */
function janitor(): void {
  const now = Date.now();
  if (now - lastJanitor < JANITOR_INTERVAL_MS) return;
  lastJanitor = now;
  const cutoff = now - 10 * 60_000; // anything not seen in 10 min is dropped
  for (const [ip, b] of buckets) {
    if (b.lastRefill < cutoff) buckets.delete(ip);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Attempt to consume one token. Returns whether the request is allowed
 * plus how many tokens remain and when the bucket fully refills.
 */
export function checkRate(
  ip: string,
  limit = 60,
  windowMs = 60_000,
): RateLimitResult {
  janitor();
  const now = Date.now();
  const existing = buckets.get(ip);
  const bucket: Bucket = existing ?? { tokens: limit, lastRefill: now };

  // Linear refill since last access
  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / windowMs) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    buckets.set(ip, bucket);
    const refillNeeded = 1 - bucket.tokens;
    const resetMs = Math.ceil((refillNeeded / limit) * windowMs);
    return { allowed: false, remaining: 0, resetMs };
  }

  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    resetMs: Math.ceil(((limit - bucket.tokens) / limit) * windowMs),
  };
}

/**
 * Extract the caller IP from a Request. Uses x-forwarded-for if present
 * (set by Next.js when behind a proxy / Vercel), falls back to a stable
 * placeholder. Trims to the first IP in the chain (the actual client).
 */
export function ipFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // Local dev / fallback, group all requests under one bucket
  return "anonymous";
}
