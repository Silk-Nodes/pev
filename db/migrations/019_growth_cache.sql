-- pev · 019_growth_cache.sql
-- Precomputed payload for /scale, the chain-growth page.
--
-- Built out-of-band by scripts/refresh-growth.ts (bounded, statement-
-- timeout guarded), read by the page as a single-row lookup. The page
-- NEVER aggregates live: a daily rollup over `blocks` across weeks is
-- exactly the class of query that starved the indexer on 2026-06-18.

CREATE TABLE IF NOT EXISTS growth_cache (
  id           INT         PRIMARY KEY,
  payload      JSONB       NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_ms   INT         NOT NULL DEFAULT 0,
  CONSTRAINT growth_cache_single CHECK (id = 1)
);
