/**
 * voter.ts, the cookie that identifies an anonymous voter.
 *
 * No login, no auth: we just want stable "you upvoted this" state per
 * browser. A random opaque token is set as an HttpOnly cookie on the
 * first request to /feedback (or first vote attempt) and reused for
 * all future votes from that browser.
 *
 * Why HttpOnly: JS can't read it, so vote spoofing requires forging
 * the cookie at the network layer instead of via XSS. Casual abuse
 * (clear cookies, re-vote) is fine; we accept that for launch-stage
 * anonymous voting. Real authentication is the long-term answer.
 *
 * Lifetime: 1 year. Long enough that a return visitor's votes persist
 * across sessions but bounded so cleared cookies aren't permanent.
 *
 * Path: "/" so every page can read/set it via Next.js's cookies() API.
 */

import { cookies } from "next/headers";
import { randomUUID } from "crypto";

export const VOTER_COOKIE = "pev-voter";

/**
 * Read the existing voter token from the request's cookies, or return
 * null if none is set yet. Pure read; doesn't set cookies.
 */
export async function readVoterToken(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(VOTER_COOKIE);
  return v?.value ?? null;
}

/**
 * Ensure the visitor has a voter token. If one is already set, returns
 * it as-is. Otherwise generates a new UUID and writes it to the
 * response cookies. Call this from API routes before recording a vote
 * so the next request from this browser sees the same token.
 */
export async function ensureVoterToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(VOTER_COOKIE);
  if (existing?.value) return existing.value;
  const token = randomUUID();
  jar.set(VOTER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });
  return token;
}
