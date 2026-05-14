-- 012_analytics_cache.sql, single-row JSONB cache for the /analytics page.
--
-- The page's underlying queries aggregate over millions of rows
-- (methods over ~12M tx_executions, hot slots over 30M block_hot_slots
-- entries with high-cardinality grouping). Even with covering indexes
-- the in-memory aggregation alone takes 5-10s, which is unacceptable
-- as a per-request cost.
--
-- This table holds the precomputed AnalyticsData payload as a JSONB
-- blob. A background job (scripts/refresh-analytics.ts, run every 5
-- minutes by a systemd timer) overwrites the row with fresh aggregates
-- run over the full 7-day window. The page then does a single PK
-- lookup to render, ~5ms.
--
-- Single-row pattern (id = 1, CHECK enforces it) — same as site_stats.
-- We don't need history; only the latest snapshot matters.
--
-- Also: drop the two covering indexes added today that the planner
-- refused to use. They cost 3.6 GB of disk and contributed nothing.
-- The methods composite on tx_executions stays (it WAS used, just
-- not enough to fix the underlying aggregation cost — pre-aggregation
-- is the real fix).

CREATE TABLE IF NOT EXISTS analytics_cache (
  id            SMALLINT PRIMARY KEY DEFAULT 1,
  payload       JSONB NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /* For ops debugging: how long the refresh script's queries took. */
  refresh_ms    INTEGER,
  CHECK (id = 1)
);

-- Drop the index that didn't help in practice (planner ignored it).
-- 3 GB of disk back. The PK on (block_number, contract, slot) is fine
-- for the queries that actually filter by block range.
DROP INDEX IF EXISTS idx_block_hot_slots_perf;
