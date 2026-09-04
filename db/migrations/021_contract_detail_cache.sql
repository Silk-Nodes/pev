-- pev · 021_contract_detail_cache.sql
--
-- Precomputed /contract payloads, one row per (contract, window).
--
-- Why: the page used to build its four aggregates on every request with
--   SELECT ... FROM tx_executions WHERE $1 = ANY(contracts) AND block_number >= $2
-- The block predicate narrows the range but the GIN bitmap on `contracts`
-- is built regardless, and for the contracts anyone actually looks up that
-- bitmap is enormous: 74.3M rows for Perpl, 18.0M for ShMonad, 4.8M for a
-- mid-sized contract. No per-statement budget the page can afford will
-- finish that, which is why /contract hung identically on ?window=1h and
-- ?window=all. It is not a tuning problem, the page cannot do this work
-- at request time on any hardware.
--
-- So the work moves to a timer, where it can have a long timeout and run
-- off-peak, and the page becomes a single primary-key read. Same shape as
-- cooccurrence_cache and growth_cache.
--
-- window_key is TEXT rather than an enum so adding a window later is a
-- code change, not a migration.
--
-- Targets come from block_hot_slots, not contract_stats_daily. The rollup
-- would be the natural source but it is empty, and filling it means first
-- grinding 426M tx_executions rows. block_hot_slots is written per block
-- by the live indexer, so it is current, and ranking by conflicts_caused
-- suits this page better anyway: /contract exists to explain contention.
CREATE TABLE IF NOT EXISTS contract_detail_cache (
  contract     BYTEA       NOT NULL,
  window_key   TEXT        NOT NULL,
  data         JSONB       NOT NULL,
  refresh_ms   INT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract, window_key)
);

-- The refresh job sweeps by staleness: oldest rows first, so a run that
-- runs out of budget still makes progress on whatever is most out of date.
CREATE INDEX IF NOT EXISTS idx_contract_detail_cache_refreshed
  ON contract_detail_cache (refreshed_at ASC);
