-- ─────────────────────────────────────────────────────────────────
-- pev · 004_method_selector.sql
-- Adds the 4-byte function selector to each tx_executions row.
--
-- Why a separate column (not derived):
--   • Lets the indexer extract once at trace time and persist it
--   • Lets the block + tx pages read selectors in one SELECT (no extra
--     RPC roundtrip per tx)
--   • Lets future analyses GROUP BY selector ("most-called methods this
--     hour") without joining to anywhere else
--
-- Why nullable:
--   • Plain ETH transfers have empty input (no selector) — store NULL
--   • Old rows indexed before this migration are NULL until re-indexed
--   • Indexer can recover gracefully if the RPC briefly returns truncated
--     tx data
-- ─────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE tx_executions
  ADD COLUMN IF NOT EXISTS method_selector BYTEA;

-- Defensive: enforce 4-byte length when present (so we can never end up
-- with malformed selectors from a buggy probe).
ALTER TABLE tx_executions
  DROP CONSTRAINT IF EXISTS tx_executions_method_selector_len_chk;
ALTER TABLE tx_executions
  ADD CONSTRAINT tx_executions_method_selector_len_chk
  CHECK (method_selector IS NULL OR octet_length(method_selector) = 4);

-- Useful for "most-called methods this hour" leaderboards (Phase 6).
CREATE INDEX IF NOT EXISTS idx_tx_executions_method_selector
  ON tx_executions (method_selector)
  WHERE method_selector IS NOT NULL;

COMMIT;
