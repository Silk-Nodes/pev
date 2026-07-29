-- pev · 020_block_gas.sql
-- Block-level gas, so we can express contention as WASTED CAPACITY rather
-- than only as a conflict count.
--
-- Why block-level and not per-tx: gasUsed/gasLimit already ride along in
-- the eth_getBlockByNumber response the indexer fetches, so capturing
-- them costs no extra RPC round-trip. Per-tx gas would need a second
-- tracer pass or eth_getBlockReceipts, an extra call per block, and the
-- RPC has hit "queue size exceeded" before.
--
-- NOT BACKFILLABLE: existing rows keep 0. Re-tracing ~20M historical
-- blocks is impractical, so gas metrics accrue from deployment forward.
-- That is the argument for adding the column early rather than when it is
-- first needed.

ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS gas_used  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gas_limit BIGINT NOT NULL DEFAULT 0;
