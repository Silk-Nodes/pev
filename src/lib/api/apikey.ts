/**
 * api/apikey.ts, API key enforcement for the public v1 API.
 *
 * TWO TIERS, because they have genuinely different threat models:
 *
 *   STRICT (stats, leaderboard, block, tx, enrich)
 *     A valid x-api-key is required. No same-origin bypass, no exceptions.
 *     This is a real boundary: nothing in the browser calls these routes
 *     (pages read the database directly in server components), so there is
 *     no legitimate keyless caller to accommodate.
 *
 *   SPEED BUMP (chain-head, live, graph-live)
 *     Browser-facing SSE streams. These are opened by public client-side
 *     JS, so ANY credential we put in the page is public by construction
 *     and cannot be a boundary. Same-origin callers pass; everyone else
 *     needs a key. Treat this as friction against casual scraping, not as
 *     protection.
 *
 * FAIL CLOSED. In production, if PEV_API_KEYS is unset, strict routes DENY
 * rather than allow. A missing config must never silently disable the gate.
 * Outside production an unset var leaves the API open so local dev and CI
 * work without ceremony.
 *
 * Keys are compared in constant time. Only a short prefix is ever logged,
 * never the key itself.
 */

import { timingSafeEqual } from "node:crypto";

export type KeyOutcome =
  | { ok: true; keyId: string | null }
  | { ok: false; reason: "missing" | "invalid" | "unconfigured" };

function configuredKeys(): string[] {
  return (process.env.PEV_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

const isProd = () => process.env.NODE_ENV === "production";

/** Constant-time compare that does not leak length through early return. */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, so hash-pad to a fixed
  // width: compare equal-length buffers and fold the length check in.
  const len = Math.max(ab.length, bb.length, 32);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

/** Non-secret identifier for logs: first 8 chars, never the whole key. */
export function keyLabel(key: string): string {
  return key.length <= 8 ? "short-key" : `${key.slice(0, 8)}…`;
}

function presentedKey(req: Request): string {
  return (
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  ).trim();
}

/**
 * Strict check: a valid key or nothing. Used by the data endpoints, which
 * have no browser callers, so there is no bypass to justify.
 */
export function checkStrictKey(req: Request): KeyOutcome {
  const keys = configuredKeys();
  if (keys.length === 0) {
    // Fail CLOSED in production: an unset variable is a misconfiguration,
    // not permission. Outside production, stay open for dev/CI.
    if (isProd()) {
      console.error(
        "[apikey] PEV_API_KEYS is not set in production, denying access to strict routes",
      );
      return { ok: false, reason: "unconfigured" };
    }
    return { ok: true, keyId: null };
  }
  const presented = presentedKey(req);
  if (!presented) return { ok: false, reason: "missing" };
  const match = keys.find((k) => constantTimeEqual(k, presented));
  return match ? { ok: true, keyId: keyLabel(match) } : { ok: false, reason: "invalid" };
}

/**
 * Speed-bump check: same-origin callers pass, everyone else needs a key.
 * Only for routes the browser genuinely must reach. Not a boundary.
 */
export function checkBumpKey(req: Request): KeyOutcome {
  if (isSameOrigin(req)) return { ok: true, keyId: null };
  const keys = configuredKeys();
  // No keys configured: this tier stays open rather than breaking the UI
  // on a misconfigured deploy. It is not a boundary either way.
  if (keys.length === 0) return { ok: true, keyId: null };
  const presented = presentedKey(req);
  if (!presented) return { ok: false, reason: "missing" };
  const match = keys.find((k) => constantTimeEqual(k, presented));
  return match ? { ok: true, keyId: keyLabel(match) } : { ok: false, reason: "invalid" };
}

/**
 * Header-based same-origin detection. Forgeable by design, which is why it
 * only ever gates the speed-bump tier and never the strict one.
 */
export function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") return true;

  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0].trim() ??
    req.headers.get("host") ??
    "";
  if (!host) return false;

  for (const header of ["origin", "referer"]) {
    const value = req.headers.get(header);
    if (!value) continue;
    try {
      if (new URL(value).host === host) return true;
    } catch {
      /* malformed header */
    }
  }
  return false;
}
