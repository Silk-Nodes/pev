-- 005_site_stats.sql, single-row counter table for the public visitor count.
--
-- We use a one-row table (enforced by `CHECK (id = 1)`) instead of a
-- key/value JSONB column on an existing table because the increment math
-- is simpler (`UPDATE … SET total_visits = total_visits + 1`) and the
-- semantics are obvious to anyone reading the schema later.
--
-- Idempotent: re-running this migration after the row already exists is
-- a no-op (the INSERT has ON CONFLICT DO NOTHING).
--
-- Why a counter instead of pulling from Google Analytics:
--   • GA Reporting API requires a service-account credential pipeline
--     that's overkill for "show a number on a page"
--   • Our counter increments for every visitor regardless of consent,
--     so users who decline GA still get counted (the page-counter is
--     aggregate-only and doesn't require consent)
--   • Survives if we ever drop GA

CREATE TABLE IF NOT EXISTS site_stats (
  id            SMALLINT PRIMARY KEY DEFAULT 1,
  total_visits  BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO site_stats (id) VALUES (1) ON CONFLICT DO NOTHING;
