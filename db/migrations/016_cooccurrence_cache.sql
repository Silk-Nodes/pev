-- 016_cooccurrence_cache.sql, single-row JSONB cache for the contract
-- relationship graph (/graph page).
--
-- Same precompute → cache → serve pattern as analytics_cache. The graph
-- payload (top-N nodes + the edges among them, with labels baked in) is
-- built by a background job (scripts/refresh-cooccurrence-graph.ts) that
-- reads ONLY the pre-aggregated contract_pair_daily rollup, never the
-- raw tx_executions / block_hot_slots tables. So building the cache is
-- light, and the page render is a single ~5ms PK lookup.
--
-- This is the discipline learned the hard way: heavy aggregation never
-- runs on a page request, and the refresh reads the small rollup, not
-- the 100M+ row source tables.

BEGIN;

CREATE TABLE IF NOT EXISTS cooccurrence_cache (
  id            SMALLINT PRIMARY KEY DEFAULT 1,
  payload       JSONB NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /* ops debugging: how long the build took */
  refresh_ms    INTEGER,
  CHECK (id = 1)
);

COMMIT;
