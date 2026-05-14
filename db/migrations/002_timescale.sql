-- ─────────────────────────────────────────────────────────────────
-- pev · 002_timescale.sql
-- OPTIONAL: convert large tables to TimescaleDB hypertables for
-- automatic compression + chunked retention.
--
-- Skipped automatically by scripts/migrate.ts if the timescaledb
-- extension is not available on this Postgres instance.
--
-- Hypertable rationale (per-table):
--   • tx_executions    — biggest table; 1 row per (block, tx). Compress
--                        chunks older than 7 days, drop chunks older
--                        than 90 days (we keep contract_stats_daily
--                        for older history).
--   • conflicts        — second biggest. Same retention.
--   • block_hot_slots  — moderate. Compress after 7d, no auto-drop
--                        (needed for slot history queries forever).
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- The migration runner only invokes this file when timescaledb is
-- installed. We still create the extension here defensively so the
-- file is also runnable manually.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert tx_executions to a hypertable, ~1M blocks per chunk
-- (≈ 1 day of mainnet at saturated TPS, ~3 months of testnet today).
SELECT create_hypertable(
  'tx_executions',
  'block_number',
  chunk_time_interval => 1000000,
  if_not_exists => TRUE,
  migrate_data => TRUE
);

SELECT create_hypertable(
  'conflicts',
  'block_number',
  chunk_time_interval => 1000000,
  if_not_exists => TRUE,
  migrate_data => TRUE
);

SELECT create_hypertable(
  'block_hot_slots',
  'block_number',
  chunk_time_interval => 1000000,
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Compression policies: compress chunks older than 7 days. Saves ~10×
-- on storage with no query downside.
ALTER TABLE tx_executions   SET (timescaledb.compress, timescaledb.compress_segmentby = 'tx_hash');
ALTER TABLE conflicts       SET (timescaledb.compress, timescaledb.compress_segmentby = 'from_tx_hash');
ALTER TABLE block_hot_slots SET (timescaledb.compress, timescaledb.compress_segmentby = 'contract');

SELECT add_compression_policy('tx_executions',   INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('conflicts',       INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('block_hot_slots', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention: drop tx_executions and conflicts older than 90 days.
-- Block summaries (in `blocks`) and contract aggregates (in
-- `contract_stats_daily`) are kept forever — they're small.
SELECT add_retention_policy('tx_executions', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('conflicts',     INTERVAL '90 days', if_not_exists => TRUE);

COMMIT;
