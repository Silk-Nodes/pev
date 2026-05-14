/**
 * POST /api/v1/feedback/:id/vote
 *
 * Toggle a vote on a feedback request. Idempotent in spirit: same
 * voter clicking twice ends up where they started.
 *
 * Returns 200 { voted: boolean, voteCount: number } on success,
 * 404 if the request id doesn't exist (or is declined).
 *
 * Voter identity is a cookie-based token (see lib/feedback/voter.ts).
 * The token is set lazily on the first vote attempt.
 */

import { NextResponse } from "next/server";
import { toggleVote } from "@/lib/feedback/store";
import { ensureVoterToken } from "@/lib/feedback/voter";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const { id: idParam } = await ctx.params;
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const token = await ensureVoterToken();
  const result = await toggleVote(id, token);
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
