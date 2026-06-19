-- pev · 017_contract_audit_cache.sql
-- Precomputed per-contract contention audit payloads. Built out-of-band
-- by scripts/contract-audit.ts (gentle, statement-timeout-bounded), read
-- by /audit/[address] as a single PK lookup. The page NEVER aggregates
-- live, per the 2026-06-18 contention incident: no heavy query on a
-- page request. One row per audited contract.

CREATE TABLE IF NOT EXISTS contract_audit_cache (
  contract     BYTEA       PRIMARY KEY,
  window_days  INT         NOT NULL,
  data         JSONB       NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
