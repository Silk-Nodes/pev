-- 015_contract_pair_daily.sql, per-day contract co-occurrence rollup.
--
-- Backs the planned "contract relationship graph" product: which
-- contracts appear together in the same transaction (composability),
-- and eventually how often they collide (contention overlay).
--
-- Why a daily rollup instead of querying tx_executions live:
--
-- The co-occurrence query unnests each tx's `contracts` array and
-- self-joins to generate every contract PAIR, then counts pairs across
-- all txs. A spike (scripts/spike-cooccurrence*.sql) measured this at
-- ~3.6s for a SINGLE HOUR of data with work_mem=256MB, and the pair
-- count scales linearly with transactions: a 7-day window would
-- generate ~245M intermediate pairs and never finish in one shot.
--
-- So we follow the contract_stats_daily / analytics_cache pattern:
-- a background job (scripts/refresh-cooccurrence.ts) processes only
-- NEW blocks since its cursor in small chunks, generating pairs for
-- just that batch and UPSERT-incrementing per-(pair, day) counts here.
-- Each batch stays in memory (no disk spill) and finishes in ~1s. The
-- graph then reads a rolling window as `SUM(cooccur_count) ... WHERE
-- day >= now() - 7 GROUP BY c1, c2` over this small pre-aggregated
-- table, milliseconds.
--
-- Pair canonicalization: each unordered pair is stored once with
-- c1 < c2 (byte order via LEAST/GREATEST in the refresh job), so the
-- UPSERT merges (A,B) and (B,A) into the same row.

BEGIN;

CREATE TABLE IF NOT EXISTS contract_pair_daily (
  c1             BYTEA  NOT NULL,
  c2             BYTEA  NOT NULL,
  day            DATE   NOT NULL,
  -- How many transactions touched BOTH c1 and c2 on this day.
  cooccur_count  BIGINT NOT NULL DEFAULT 0,
  -- Reserved for the contention overlay (phase 2): how often txs
  -- touching c1 and c2 actually collided on a storage slot. Populated
  -- 0 for now so phase 2 needs no schema change.
  conflict_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (c1, c2, day),
  -- Canonical ordering invariant: smaller address first, no self-pairs.
  CHECK (c1 < c2),
  CHECK (octet_length(c1) = 20 AND octet_length(c2) = 20)
);

-- Rolling-window reads filter by day, then group by pair. A btree on
-- day lets "last N days" prune to recent rows before the group/sum.
CREATE INDEX IF NOT EXISTS idx_contract_pair_daily_day
  ON contract_pair_daily (day);

-- Single-row cursor tracking how far the refresh job has processed.
-- Same single-row pattern as analytics_cache / site_stats.
CREATE TABLE IF NOT EXISTS contract_pair_cursor (
  id          SMALLINT    PRIMARY KEY DEFAULT 1,
  last_block  BIGINT      NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO contract_pair_cursor (id, last_block)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

COMMIT;
