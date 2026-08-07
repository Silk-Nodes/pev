/**
 * api/apikey.ts, API key checking for the public v1 API.
 *
 * Policy: the site's own pages call these endpoints from the browser, so
 * SAME-ORIGIN requests always pass. Only external/programmatic callers
 * need a key. That keeps the UI working with zero changes while gating
 * scripted access to the indexed data.
 *
 * Keys live in the PEV_API_KEYS env var, comma separated:
 *   PEV_API_KEYS=key_abc123,key_def456
 * If the var is unset or empty, key checking is DISABLED (every request
 * passes) so a misconfigured deploy fails open rather than taking the
 * API down. Set it to enable enforcement.
 *
 * Same-origin detection is deliberately header-based (Sec-Fetch-Site,
 * then Origin/Referer host). Headers can be forged, so this is a gate
 * against casual scraping and a way to know who is calling, not a
 * security boundary. Anything genuinely sensitive should not be on a
 * public read API in the first place.
 */

/** Keys from env, parsed once per process. */
function keys(): string[] {
  const raw = process.env.PEV_API_KEYS ?? "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** True when key checking is switched off (no keys configured). */
export function keyCheckDisabled(): boolean {
  return keys().length === 0;
}

/** Constant-time-ish compare so we don't leak length via early exit. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasValidApiKey(req: Request): boolean {
  if (keyCheckDisabled()) return true;
  const presented =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!presented) return false;
  return keys().some((k) => safeEqual(k, presented));
}

/**
 * Is this the site calling its own API? Browsers set Sec-Fetch-Site on
 * fetches; we fall back to comparing the Origin/Referer host with the
 * request host for clients that don't.
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
      // malformed header, ignore
    }
  }
  return false;
}
