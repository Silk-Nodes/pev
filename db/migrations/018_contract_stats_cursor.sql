-- pev · 018_contract_stats_cursor.sql
-- Cursor for the incremental per-contract daily rollup that fills
-- contract_stats_daily (declared way back in 001 but never populated, so
-- every trend query had to hit raw block_hot_slots, a multi-minute scan).
--
-- With this rollup maintained, week/month movers, per-contract history,
-- "most parallel-friendly" boards and anomaly checks become instant
-- single-table reads instead of heavy aggregations on the live DB.
--
-- Same shape as contract_pair_cursor: one row, advanced per committed
-- chunk so a killed run resumes where it stopped.

CREATE TABLE IF NOT EXISTS contract_stats_cursor (
  id          INT    PRIMARY KEY,
  last_block  BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT contract_stats_cursor_single CHECK (id = 1)
);

INSERT INTO contract_stats_cursor (id, last_block)
  VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;
