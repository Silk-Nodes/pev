/**
 * feedback/store.ts, DB layer for the /feedback feature-request portal.
 *
 * Reads and writes to two tables (see db/migrations/014_feedback.sql):
 *   • feedback_requests, the requests themselves
 *   • feedback_votes,    one row per (request, voter cookie)
 *
 * `vote_count` on feedback_requests is denormalized for sort speed.
 * Every vote/unvote runs inside a transaction that updates both tables
 * atomically so the count never drifts.
 *
 * No moderation UI: moderate via direct SQL until volume justifies
 * building one (e.g. UPDATE feedback_requests SET status='planned'
 * WHERE id=5).
 */

import { query, queryOne, queryRows, withTransaction } from "@/lib/db";

export type FeedbackStatus =
  | "open"
  | "planned"
  | "in_progress"
  | "shipped"
  | "declined";

export interface FeedbackRequest {
  id: number;
  title: string;
  description: string | null;
  status: FeedbackStatus;
  voteCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** Whether the current voter (by cookie) has already upvoted this. */
  hasVoted: boolean;
}

interface DbRow {
  id: string;
  title: string;
  description: string | null;
  status: FeedbackStatus;
  vote_count: number;
  created_at: Date;
  updated_at: Date;
  has_voted: boolean;
}

function rowToRequest(r: DbRow): FeedbackRequest {
  return {
    id: parseInt(r.id, 10),
    title: r.title,
    description: r.description,
    status: r.status,
    voteCount: r.vote_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasVoted: r.has_voted,
  };
}

/**
 * Public list of requests. Excludes `declined` (spam, off-topic). Sorts
 * within each status by votes DESC, then recency. `voterToken` flags
 * which rows the current visitor has already upvoted so the UI can
 * highlight them.
 */
export async function listFeedback(
  voterToken: string | null,
): Promise<FeedbackRequest[]> {
  // LEFT JOIN feedback_votes filtered by token gives us has_voted per row
  // in one query, rather than fetching the user's full vote list separately.
  const rows = await queryRows<DbRow>(
    `SELECT
       r.id::text,
       r.title,
       r.description,
       r.status,
       r.vote_count,
       r.created_at,
       r.updated_at,
       (v.voter_token IS NOT NULL) AS has_voted
     FROM feedback_requests r
     LEFT JOIN feedback_votes v
       ON v.request_id = r.id AND v.voter_token = $1
     WHERE r.status <> 'declined'
     ORDER BY
       /* Custom status ordering to drive section layout in the UI:
          working-on first, then open, then shipped. */
       CASE r.status
         WHEN 'in_progress' THEN 0
         WHEN 'planned'     THEN 1
         WHEN 'open'        THEN 2
         WHEN 'shipped'     THEN 3
         ELSE 4
       END,
       r.vote_count DESC,
       r.created_at DESC`,
    [voterToken ?? ""],
  );
  return rows.map(rowToRequest);
}

/**
 * Insert a new feature request. Returns the new row's id. Throws if
 * the title violates the length CHECK constraint; callers should
 * validate length first and surface friendly errors.
 *
 * submitterIp is stored for rate-limiting; never displayed.
 */
export async function createFeedback(input: {
  title: string;
  description: string | null;
  submitterIp: string | null;
}): Promise<number> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO feedback_requests (title, description, submitter_ip)
     VALUES ($1, $2, $3::inet)
     RETURNING id::text`,
    [input.title, input.description, input.submitterIp],
  );
  if (!row) throw new Error("feedback insert failed");
  return parseInt(row.id, 10);
}

/**
 * Per-IP rate limit check. Returns true if the IP has submitted more
 * than `max` requests in the last `windowMinutes` minutes. Cheap query
 * (index on (submitter_ip, created_at DESC)).
 */
export async function ipRateExceeded(
  ip: string,
  max: number,
  windowMinutes: number,
): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM feedback_requests
      WHERE submitter_ip = $1::inet
        AND created_at > NOW() - ($2 || ' minutes')::interval`,
    [ip, String(windowMinutes)],
  );
  return row ? parseInt(row.n, 10) >= max : false;
}

/**
 * Toggle a vote: if the voter has already upvoted this request, remove
 * the vote (and decrement count). Otherwise insert the vote (and
 * increment count). Atomic via a single transaction so the
 * denormalized count can't drift.
 *
 * Returns the new state: { voted, voteCount }.
 */
export async function toggleVote(
  requestId: number,
  voterToken: string,
): Promise<{ voted: boolean; voteCount: number } | null> {
  return withTransaction(async (client) => {
    // Lock the request row so concurrent toggles serialize cleanly.
    const exists = await client.query<{ id: string; vote_count: number }>(
      `SELECT id::text, vote_count
         FROM feedback_requests
        WHERE id = $1 AND status <> 'declined'
        FOR UPDATE`,
      [requestId],
    );
    if (exists.rows.length === 0) return null;
    let voteCount = exists.rows[0].vote_count;

    // Try to delete the existing vote first. If a row was deleted,
    // the user had voted before so we treat this as an unvote.
    const del = await client.query(
      `DELETE FROM feedback_votes
        WHERE request_id = $1 AND voter_token = $2`,
      [requestId, voterToken],
    );
    if (del.rowCount && del.rowCount > 0) {
      voteCount = voteCount - 1;
      await client.query(
        `UPDATE feedback_requests
            SET vote_count = $2, updated_at = NOW()
          WHERE id = $1`,
        [requestId, voteCount],
      );
      return { voted: false, voteCount };
    }

    // No prior vote, insert one and increment.
    await client.query(
      `INSERT INTO feedback_votes (request_id, voter_token)
       VALUES ($1, $2)`,
      [requestId, voterToken],
    );
    voteCount = voteCount + 1;
    await client.query(
      `UPDATE feedback_requests
          SET vote_count = $2, updated_at = NOW()
        WHERE id = $1`,
      [requestId, voteCount],
    );
    return { voted: true, voteCount };
  });
}

/**
 * Marker-only call used by the API layer to verify the request id
 * exists at all (so we can return 404 cleanly before doing any work).
 */
export async function feedbackExists(id: number): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM feedback_requests
        WHERE id = $1 AND status <> 'declined'
     ) AS exists`,
    [id],
  );
  return !!row?.exists;
}

// Re-export query for callers that need raw access (not currently used,
// but keeps the import surface stable if we add functions later).
export { query };
