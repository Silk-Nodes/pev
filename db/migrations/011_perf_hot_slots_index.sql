-- 011_perf_hot_slots_index.sql, covering index for the analytics
-- hot-slots leaderboard query.
--
-- Symptom: the query
--   SELECT contract, slot, sum(conflicts_caused), sum(touches),
--          count(DISTINCT block_number)
--     FROM block_hot_slots
--    WHERE block_number > $1 AND conflicts_caused > 0
--    GROUP BY contract, slot
--    ORDER BY sum(conflicts_caused) DESC LIMIT 10
-- ran in 3.4 seconds over 24h (Parallel Seq Scan on the 7GB table) and
-- 11 seconds over 7d. The existing PK is (block_number, contract, slot)
-- but the planner refused the index range scan, falling back to a
-- parallel seq scan because reading 1M rows from heap was estimated
-- worse than the index range itself.
--
-- This covering index includes the aggregate columns directly, enabling
-- an index-only scan where the planner reads everything from the index
-- without heap fetches:
--   • block_number, leading column (WHERE filter + count distinct)
--   • contract, slot, GROUP BY composite key
--   • conflicts_caused, touches, INCLUDE for SUM aggregates
--
-- Built CONCURRENTLY so the indexer can keep writing during the build
-- (~10-15 min on 30M rows). The resulting index is large (~1-2 GB) but
-- the perf payoff is enormous: this query becomes part of every
-- /analytics page load.
--
-- Idempotent.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_block_hot_slots_perf
  ON block_hot_slots (block_number, contract, slot)
  INCLUDE (conflicts_caused, touches);
