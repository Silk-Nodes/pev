-- 013_contract_index.sql
--
-- Contract-level index for fast "is this contract in pev?" lookups.
--
-- Why this table exists:
--
-- The contract page and the diagnostic endpoint need to answer two
-- simple questions for any address: "have we ever seen it?" and
-- "when was it last active?". Without this table the only ways to
-- answer those are:
--
--   • SELECT max(block_number) FROM block_hot_slots WHERE contract = ?
--     Fast (perfect compound index), but only contains contracts that
--     have caused at least one hot slot. Token contracts, routers, and
--     any contract whose txs don't share storage slots with each other
--     never appear here even when they have millions of txs.
--
--   • SELECT max(block_number) FROM tx_executions WHERE ? = ANY(contracts)
--     Catches every contract, but the planner has to choose between a
--     GIN-bitmap-then-sort over millions of rows or a btree-backward-
--     walk that filters by GIN per row. Both are multi-second on
--     popular contracts (tx_executions at 23M rows now). Even with
--     fresh ANALYZE stats, planner picks badly often enough that the
--     contract page was timing out.
--
-- contract_index sidesteps both: one row per contract, PK-indexed by
-- bytea, populated from tx_executions periodically. Lookups become a
-- single-page btree probe. Refresh runs out-of-band (systemd timer,
-- mirroring analytics_cache).
--
-- Refresh strategy:
--   • One row per (contract, first_block, last_block, tx_count).
--   • Populated by a refresh script that does:
--       INSERT … SELECT unnest(contracts), …, max(block_number), count(*)
--       FROM tx_executions GROUP BY contract
--       ON CONFLICT (contract) DO UPDATE …
--   • Refreshed every 5-15 min by a systemd timer. Stale by at most
--     that interval, which is acceptable for "is this contract here?"
--     lookups (the user just wants to know it exists).
--   • Initial backfill is one full scan of tx_executions; ~1-3 min.
--
-- Schema fields:
--   • contract       bytea PRIMARY KEY  · 20-byte address
--   • first_block    bigint NOT NULL    · earliest block we've seen it in
--   • last_block     bigint NOT NULL    · latest block we've seen it in
--   • tx_count       bigint NOT NULL    · total tx_executions rows touching it
--   • refreshed_at   timestamptz        · when this row was last updated

BEGIN;

CREATE TABLE IF NOT EXISTS contract_index (
  contract     BYTEA       PRIMARY KEY,
  first_block  BIGINT      NOT NULL,
  last_block   BIGINT      NOT NULL,
  tx_count     BIGINT      NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Secondary index for "what was active recently?" queries. PK by
-- contract is enough for point lookups; this gives us range queries
-- by last_block (e.g. "every contract active in the last 24h").
CREATE INDEX IF NOT EXISTS idx_contract_index_last_block
  ON contract_index (last_block DESC);

COMMIT;
