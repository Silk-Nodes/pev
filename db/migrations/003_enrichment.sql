-- ─────────────────────────────────────────────────────────────────
-- pev · 003_enrichment.sql
-- Cache tables for human-readable labels.
--
-- Two lookup caches, both effectively immutable per (chain, key):
--   • method_signatures — 4-byte EVM function selector → human signature
--                         (e.g. 0xa9059cbb → "transfer(address,uint256)")
--                         Source: 4byte directory (4byte.directory) +
--                         optional manual overrides.
--   • contract_labels   — 20-byte contract address → display name + source
--                         (e.g. 0x754704… → "wmonUSDC Pool" via Sourcify)
--                         Sources: sourcify (verified contracts), manual
--                         overrides, possibly future indexers.
--
-- These tables live separately from tx_executions so:
--   • The cache survives indexer rewrites / engine version bumps
--   • Enrichment can run as a separate background job without contending
--     with the trace pipeline
--   • The same selector/address resolves identically across every block
--
-- All entries are insert-on-resolve. We never overwrite a successful
-- lookup with a failure (so we don't lose data when 4byte.directory is
-- briefly down). negative_until is set when a lookup fails — we re-try
-- after that timestamp instead of hitting the API on every page load.
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- ─── method_signatures ──────────────────────────────────────────
-- Selector is the first 4 bytes of tx input data.
-- Stored as a 4-byte BYTEA. Same selector might map to multiple
-- signatures historically — we store the most-canonical one (the
-- one with the most upvotes on 4byte, or our manual override).
CREATE TABLE IF NOT EXISTS method_signatures (
  selector       BYTEA NOT NULL,
  signature      TEXT,
  -- "4byte" | "manual" | NULL when negative-cached
  source         TEXT,
  -- When non-null, treat as "look up failed; try again after this time"
  negative_until TIMESTAMPTZ,
  retrieved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (selector),
  CHECK (octet_length(selector) = 4)
);

-- ─── contract_labels ────────────────────────────────────────────
-- Contract addresses are 20 bytes. Same caching pattern as above.
-- We also stash the verification source so the UI can show a small
-- badge (e.g. "verified by Sourcify").
CREATE TABLE IF NOT EXISTS contract_labels (
  address        BYTEA NOT NULL,
  name           TEXT,
  -- "sourcify" | "manual" | "4byte-extension" | NULL
  source         TEXT,
  -- Optional: the verified contract's metadata.json ipfs hash, when
  -- known. Not used in v1 UI but useful for debugging / future ABI work.
  metadata_uri   TEXT,
  negative_until TIMESTAMPTZ,
  retrieved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (address),
  CHECK (octet_length(address) = 20)
);

-- For "show me all known labels for these N addresses" — used by the
-- block page to bulk-fetch labels for every contract in its tx set.
CREATE INDEX IF NOT EXISTS idx_contract_labels_name_present
  ON contract_labels (address)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_method_signatures_sig_present
  ON method_signatures (selector)
  WHERE signature IS NOT NULL;

COMMIT;
