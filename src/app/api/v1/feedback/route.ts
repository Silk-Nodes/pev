/**
 * GET  /api/v1/feedback     , list current feature requests
 * POST /api/v1/feedback     , submit a new request
 *
 * Anonymous: a cookie-based voter token (set lazily by ensureVoterToken)
 * lets us mark `hasVoted` per row on the list response. No login.
 *
 * Anti-spam:
 *   • Length validation on title (5-120) and description (≤2000) at
 *     the DB layer (CHECK constraints) and here at the API layer for
 *     friendlier error messages.
 *   • Per-IP rate limit: max 3 submissions per hour. IPs come from
 *     X-Forwarded-For (we're behind Cloudflare, so the left-most
 *     entry is the real client). Stored as INET, never displayed.
 */

import { NextResponse } from "next/server";
import {
  listFeedback,
  createFeedback,
  ipRateExceeded,
} from "@/lib/feedback/store";
import { ensureVoterToken, readVoterToken } from "@/lib/feedback/voter";

export const dynamic = "force-dynamic";

// Conservative spam guard for launch. Bump up if real users get
// throttled; bump down if abuse starts.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MIN = 60;

export async function GET() {
  // Read existing cookie if present; do NOT set one. Setting a cookie
  // on a GET would bypass cache and is unnecessary for read-only flows.
  // The cookie gets set when the user clicks Vote (POST below).
  const token = await readVoterToken();
  const items = await listFeedback(token);
  return NextResponse.json(
    { items },
    { headers: { "cache-control": "no-store" } },
  );
}

interface SubmitBody {
  title?: unknown;
  description?: unknown;
}

export async function POST(req: Request) {
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description =
    typeof body.description === "string" && body.description.trim().length > 0
      ? body.description.trim()
      : null;

  if (title.length < 5 || title.length > 120) {
    return NextResponse.json(
      { error: "title must be 5 to 120 characters" },
      { status: 400 },
    );
  }
  if (description !== null && description.length > 2000) {
    return NextResponse.json(
      { error: "description must be 2000 characters or fewer" },
      { status: 400 },
    );
  }

  // Pull the real client IP. Cloudflare sets cf-connecting-ip; nginx-
  // style stacks set x-forwarded-for. Fall back to "host" header which
  // is not really right but never sets the wrong value either.
  const ip =
    req.headers.get("cf-connecting-ip") ??
    (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0] ??
    null;

  if (ip && (await ipRateExceeded(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MIN))) {
    return NextResponse.json(
      {
        error:
          "you've submitted a few already, give us a bit to read them. try again in an hour",
      },
      { status: 429 },
    );
  }

  // Make sure the voter has a cookie so they can immediately upvote
  // their own submission on the next page load. No-op if they already
  // had one.
  await ensureVoterToken();

  try {
    const id = await createFeedback({ title, description, submitterIp: ip });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    // DB CHECK constraint failures land here. The friendlier message
    // already went out above; this is a fallback for anything we missed.
    console.error("[feedback POST] insert error:", (err as Error).message);
    return NextResponse.json(
      { error: "couldn't save the request, try again" },
      { status: 500 },
    );
  }
}
