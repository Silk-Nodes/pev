-- 022_daily_summary.sql
--
-- pev keeps only a rolling window of full block data (7 days by default,
-- see src/lib/indexer/retention.ts). This table is the one thing that
-- outlives the window: one row per UTC day with chain-wide totals, so
-- long-run trends still have a source after the detail rows are gone.
--
-- A day's row is rewritten while the day is still inside the window and
-- frozen once its blocks are pruned. Size: ~100 bytes per day.

BEGIN;

CREATE TABLE IF NOT EXISTS daily_summary (
  day                    DATE         PRIMARY KEY,
  blocks                 INT          NOT NULL,
  first_block            BIGINT       NOT NULL,
  last_block             BIGINT       NOT NULL,
  txs                    BIGINT       NOT NULL,
  stateful_txs           BIGINT       NOT NULL,
  conflicts              BIGINT       NOT NULL,
  hot_slots              BIGINT       NOT NULL,
  avg_parallelism_score  REAL         NOT NULL,
  avg_blocked_pct        REAL         NOT NULL,
  avg_execution_depth    REAL         NOT NULL,
  gas_used               NUMERIC,
  gas_limit              NUMERIC,
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMIT;
