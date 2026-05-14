-- 014_feedback.sql
--
-- Lightweight feature-request system for the /feedback page.
--
-- Design constraints:
--   • Anonymous voting: no auth, voters identified by a cookie-set
--     opaque token. Casual abuse (clearing cookies to vote again) is
--     possible but acceptable for launch-stage traffic.
--   • Moderation by direct SQL for now (no admin UI). The five status
--     values mirror what most public roadmap tools use, plus 'declined'
--     for spam / off-topic submissions (hidden from the public list).
--   • Counts: vote_count is denormalized for sort speed; refreshed
--     transactionally on every insert/delete in feedback_votes.
--
-- Schema fields:
--
--   feedback_requests
--     id            PK (BIGSERIAL because we want incrementing IDs in
--                   URLs, not UUIDs)
--     title         5..120 chars; visible verbatim on the page
--     description   optional, ≤2000 chars; markdown not parsed yet
--     status        open / planned / in_progress / shipped / declined
--     vote_count    denormalized; updated by votes triggers
--     submitter_ip  stored for rate-limiting only, never displayed
--     created_at    insert time
--     updated_at    moderation/status change time
--
--   feedback_votes
--     (request_id, voter_token) is the PK so a (token, request) pair
--     is unique by construction. Voting twice is a no-op insert.
--
-- Anti-spam:
--   • CHECK constraints on length keep the data clean at the boundary.
--   • Per-IP rate limit lives in the API layer (3 submissions/hour),
--     not the DB. Easier to relax/tighten without a migration.
--   • Manual review via `UPDATE feedback_requests SET status='declined'
--     WHERE id=…` until volume justifies a real admin UI.

BEGIN;

CREATE TABLE IF NOT EXISTS feedback_requests (
  id            BIGSERIAL    PRIMARY KEY,
  title         TEXT         NOT NULL
                             CHECK (char_length(title) BETWEEN 5 AND 120),
  description   TEXT
                             CHECK (description IS NULL
                                    OR char_length(description) <= 2000),
  status        TEXT         NOT NULL DEFAULT 'open'
                             CHECK (status IN (
                               'open',
                               'planned',
                               'in_progress',
                               'shipped',
                               'declined'
                             )),
  vote_count    INTEGER      NOT NULL DEFAULT 0,
  submitter_ip  INET,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_votes (
  request_id    BIGINT       NOT NULL
                             REFERENCES feedback_requests(id) ON DELETE CASCADE,
  voter_token   TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, voter_token)
);

-- Sort speed on the page: WHERE status = ? ORDER BY vote_count DESC.
CREATE INDEX IF NOT EXISTS idx_feedback_requests_status_votes
  ON feedback_requests (status, vote_count DESC, created_at DESC);

-- Per-IP submission rate limit needs a scan over recent submissions
-- by IP. Small index, helps the rate-limit check stay sub-millisecond.
CREATE INDEX IF NOT EXISTS idx_feedback_requests_ip_recent
  ON feedback_requests (submitter_ip, created_at DESC)
  WHERE submitter_ip IS NOT NULL;

COMMIT;
