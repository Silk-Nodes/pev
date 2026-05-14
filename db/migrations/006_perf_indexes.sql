-- 006_perf_indexes.sql, indexes that landed after the contract page got slow.
--
-- Symptom: /contract/[address] for popular contracts took 4-5 seconds because
--   getContractDetail aggregates over the full lifetime of a contract's
--   tx_executions. For a contract with 481K tx executions (12% of all rows),
--   the planner refused the GIN index and did a Parallel Seq Scan over
--   1.3M rows, then a hash join over all 514K blocks.
--
-- Fix: window the contract queries to a recent block range (handled in
--   src/lib/indexer/store.ts), and add this btree index so the recent-block
--   filter is itself indexed. Without the index, "WHERE block_number >= X"
--   would still seq-scan tx_executions defeating the whole point.
--
-- This index is also generally useful for any future query that wants to
--   slice tx_executions by block range (e.g. per-window leaderboards).
--
-- Idempotent.

CREATE INDEX IF NOT EXISTS idx_tx_executions_block_number
  ON tx_executions (block_number);
