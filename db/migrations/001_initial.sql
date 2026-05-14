-- ─────────────────────────────────────────────────────────────────
-- pev · 001_initial.sql
-- Core schema for indexed Monad block analysis.
-- Designed to work with or without TimescaleDB. If TimescaleDB is
-- available, run 002_timescale.sql afterwards to convert tx_executions,
-- conflicts, and block_hot_slots into hypertables for compression +
-- automated retention.
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- ─── blocks ──────────────────────────────────────────────────────
-- 1 row per block. Summary columns for fast filtering / sorting
-- (leaderboards), plus a `probe_data` JSONB blob containing the full
-- BlockProbe result for instant page reads (no joins needed).
CREATE TABLE IF NOT EXISTS blocks (
  number                BIGINT       PRIMARY KEY,
  hash                  BYTEA        NOT NULL,
  timestamp             TIMESTAMPTZ  NOT NULL,
  tx_count              INT          NOT NULL,
  stateful_count        INT          NOT NULL,
  parallelism_factor    REAL         NOT NULL,
  parallelism_score     INT          NOT NULL,    -- 0..100, derived
  execution_depth       INT          NOT NULL,    -- = wave count
  conflict_count        INT          NOT NULL,
  blocked_pct           INT          NOT NULL,    -- % stateful txs in wave > 0
  avg_conflicts_per_tx  REAL         NOT NULL,
  hot_slot_count        INT          NOT NULL,
  -- Full computed PEVData for fast page reads (1 SELECT, no joins)
  probe_data            JSONB        NOT NULL,
  -- Versioning: when we change the engine, bump this and re-derive
  engine_version        INT          NOT NULL DEFAULT 1,
  indexed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Trace timing (for ops/observability)
  trace_ms              INT
);

-- Recent-blocks query: SELECT ... FROM blocks ORDER BY timestamp DESC LIMIT 100
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks (timestamp DESC);
-- Leaderboards: most parallel, most blocked, etc.
CREATE INDEX IF NOT EXISTS idx_blocks_parallelism_score ON blocks (parallelism_score DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_pct       ON blocks (blocked_pct DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_conflict_count    ON blocks (conflict_count DESC);

-- ─── tx_executions ───────────────────────────────────────────────
-- One row per tx per block. Lets us answer:
--   • "show me this tx" (search by hash)
--   • "show me all txs in this block in wave order"
--   • "which contracts did this tx touch"
-- Composite PK (block_number, tx_hash) is the right key for both
-- range partitioning and the common access pattern.
CREATE TABLE IF NOT EXISTS tx_executions (
  block_number          BIGINT       NOT NULL,
  tx_hash               BYTEA        NOT NULL,
  position              INT          NOT NULL,
  wave                  INT          NOT NULL,
  status                TEXT         NOT NULL,    -- 'clean'|'delayed'|'source'
  read_count            INT          NOT NULL,
  write_count           INT          NOT NULL,
  inbound_conflicts     INT          NOT NULL,
  outbound_conflicts    INT          NOT NULL,
  -- Array of contract addresses this tx touched. Searchable by GIN.
  contracts             BYTEA[]      NOT NULL,
  PRIMARY KEY (block_number, tx_hash)
);

-- Single-tx lookup by hash
CREATE INDEX IF NOT EXISTS idx_tx_executions_hash ON tx_executions (tx_hash);
-- Find all txs that touched a given contract (GIN on the BYTEA[] column)
CREATE INDEX IF NOT EXISTS idx_tx_executions_contracts_gin ON tx_executions USING GIN (contracts);

-- ─── conflicts ───────────────────────────────────────────────────
-- One row per directed conflict edge (earlier tx → later tx). Lets us
-- show "who blocked who" detail on the tx-detail page without re-tracing.
CREATE TABLE IF NOT EXISTS conflicts (
  block_number   BIGINT  NOT NULL,
  from_position  INT     NOT NULL,
  to_position    INT     NOT NULL,
  from_tx_hash   BYTEA   NOT NULL,
  to_tx_hash     BYTEA   NOT NULL,
  kind           TEXT    NOT NULL,   -- 'write-write'|'read-write'|'mixed'
  -- Array of "{contract_hex}:{slot_hex}" strings that caused the conflict
  shared_slots   JSONB   NOT NULL,
  PRIMARY KEY (block_number, from_position, to_position)
);

CREATE INDEX IF NOT EXISTS idx_conflicts_from_hash ON conflicts (from_tx_hash);
CREATE INDEX IF NOT EXISTS idx_conflicts_to_hash   ON conflicts (to_tx_hash);

-- ─── block_hot_slots ─────────────────────────────────────────────
-- One row per (block, contract, slot) for slots touched ≥2 times.
-- Lets us answer "show all blocks where this contract's slot X was hot"
-- — feeds the contract-page hotspot history.
CREATE TABLE IF NOT EXISTS block_hot_slots (
  block_number      BIGINT  NOT NULL,
  contract          BYTEA   NOT NULL,
  slot              BYTEA   NOT NULL,
  touches           INT     NOT NULL,
  conflicts_caused  INT     NOT NULL,
  contention        REAL    NOT NULL,   -- 0..1, normalized within block
  PRIMARY KEY (block_number, contract, slot)
);

-- Per-contract slot history: SELECT ... WHERE contract = $1 ORDER BY block_number DESC
CREATE INDEX IF NOT EXISTS idx_block_hot_slots_contract ON block_hot_slots (contract, block_number DESC);

-- ─── contract_stats_daily ────────────────────────────────────────
-- Rolled-up daily aggregates per contract, populated by a nightly
-- job (Phase 4). Lets the contract page show parallelism trends over
-- weeks/months without scanning millions of tx_executions rows.
CREATE TABLE IF NOT EXISTS contract_stats_daily (
  contract                 BYTEA  NOT NULL,
  day                      DATE   NOT NULL,
  tx_count                 BIGINT NOT NULL,
  blocks_appeared          INT    NOT NULL,
  parallelism_score_avg    REAL   NOT NULL,
  conflicts_caused_sum     INT    NOT NULL,
  -- top-10 hot slots that day, JSON: [{slot, touches, conflicts_caused}]
  top_slots                JSONB  NOT NULL,
  PRIMARY KEY (contract, day)
);

CREATE INDEX IF NOT EXISTS idx_contract_stats_day ON contract_stats_daily (day DESC);

-- ─── indexer_cursor ──────────────────────────────────────────────
-- Single-row table tracking the indexer's progress. Lets the indexer
-- resume cleanly after a restart, and lets the health endpoint report
-- pipeline lag.
CREATE TABLE IF NOT EXISTS indexer_cursor (
  id                  INT          PRIMARY KEY DEFAULT 1,
  last_indexed_block  BIGINT       NOT NULL DEFAULT 0,
  last_indexed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO indexer_cursor (id, last_indexed_block) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- ─── schema_migrations ───────────────────────────────────────────
-- Tracks which migrations have been applied. Used by scripts/migrate.ts.
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename     TEXT         PRIMARY KEY,
  applied_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  checksum     TEXT
);

COMMIT;
