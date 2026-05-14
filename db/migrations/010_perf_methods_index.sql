-- 010_perf_methods_index.sql, composite covering index for the analytics
-- methods leaderboard query.
--
-- Symptom: the query
--   SELECT method_selector, count(*), sum(outbound_conflicts),
--          count(DISTINCT block_number)
--     FROM tx_executions
--    WHERE block_number > $1 AND method_selector IS NOT NULL
--    GROUP BY method_selector
--    ORDER BY sum(outbound_conflicts) DESC LIMIT 10
-- ran in 6 seconds over 24h (~2M rows) and 53 seconds over 7d (~12M rows)
-- because the existing single-column index `idx_tx_executions_block_number`
-- only accelerated the WHERE filter; every matching row was still
-- heap-fetched to read method_selector + outbound_conflicts.
--
-- This composite covers all the columns the query needs:
--   • block_number, leading column for the WHERE range scan
--   • method_selector, GROUP BY key
--   • outbound_conflicts, INCLUDE so the planner can compute SUM
--                          without heap fetches (index-only scan)
--
-- Built CONCURRENTLY so the indexer can keep writing during the build
-- (~5-10 min on 13M rows, no table lock).
--
-- Idempotent. With CONCURRENTLY + IF NOT EXISTS, re-running is a no-op.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_executions_methods_perf
  ON tx_executions (block_number, method_selector)
  INCLUDE (outbound_conflicts);
