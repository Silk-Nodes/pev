-- db-tune-tier2-drop-indexes.sql, reclaim disk + cut indexer write load.
--
-- db-diagnose.sql found ~14GB of indexes that are barely or never used.
-- Every one of them is updated on EVERY indexer INSERT, so they are pure
-- write-amplification on the hot path (the GIN especially — GIN updates
-- are far more expensive than btree). Dropping the dead ones speeds up
-- indexing AND frees disk.
--
-- MUST run as the postgres SUPERUSER (or table owner) on .182:
--   sudo -u postgres psql -d pev -f db-tune-tier2-drop-indexes.sql
--
-- Uses DROP INDEX CONCURRENTLY: no exclusive lock, does not block live
-- reads/writes. CONCURRENTLY cannot run inside a transaction block, so
-- this file has NO BEGIN/COMMIT — run it as-is via psql (autocommit).
--
-- Evidence at diagnosis time (idx_scan = lifetime use count):
--   idx_tx_executions_contracts_gin    1.5 GB    0 scans   <- orphaned
--   idx_conflicts_to_hash              1.5 GB    1 scan
--   idx_conflicts_from_hash            1.4 GB    1 scan
--   idx_tx_executions_method_selector  1.0 GB    1 scan    (redundant)
--   idx_tx_executions_hash             9.0 GB   12 scans   <- SEE NOTE

\pset pager off
\timing on

\echo '=== RE-VERIFY usage before dropping (stats may have moved) ==='
-- Read these numbers first. If any "drop" candidate now shows a
-- meaningfully higher idx_scan, something started using it — reconsider.
SELECT
  indexrelname AS index,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size,
  idx_scan AS scans
FROM pg_stat_user_indexes
WHERE indexrelname IN (
  'idx_tx_executions_contracts_gin',
  'idx_conflicts_to_hash',
  'idx_conflicts_from_hash',
  'idx_tx_executions_method_selector',
  'idx_tx_executions_hash'
)
ORDER BY pg_relation_size(indexrelid) DESC;

\echo ''
\echo '=== SAFE DROPS (~5.4 GB) ==='

-- 1. The GIN on contracts. 0 scans. Migration 013 (contract_index) was
--    built specifically BECAUSE this GIN path was too slow, so the
--    contract page no longer uses it. Co-occurrence uses a block_number
--    range scan, not the GIN. Genuinely orphaned, and the single biggest
--    per-INSERT write win to remove.
\echo '-- dropping idx_tx_executions_contracts_gin (1.5GB, 0 scans) ...'
DROP INDEX CONCURRENTLY IF EXISTS idx_tx_executions_contracts_gin;

-- 2 & 3. conflicts from/to hash indexes. 1 scan each. The main conflict
--    queries use conflicts_pkey and idx_conflicts_block_number (14M+
--    scans). These two are ~3GB of dead weight.
\echo '-- dropping idx_conflicts_to_hash (1.5GB, 1 scan) ...'
DROP INDEX CONCURRENTLY IF EXISTS idx_conflicts_to_hash;
\echo '-- dropping idx_conflicts_from_hash (1.4GB, 1 scan) ...'
DROP INDEX CONCURRENTLY IF EXISTS idx_conflicts_from_hash;

-- 4. Standalone method_selector index. 1 scan. Redundant with
--    idx_tx_executions_methods_perf (block_number, method_selector),
--    which has 15M+ scans and serves the method queries.
\echo '-- dropping idx_tx_executions_method_selector (1.0GB, 1 scan) ...'
DROP INDEX CONCURRENTLY IF EXISTS idx_tx_executions_method_selector;

\echo ''
\echo '=== DECISION REQUIRED: idx_tx_executions_hash (9 GB, 12 scans) ==='
\echo '-- NOT dropped automatically. This btree on tx_hash backs the'
\echo '-- /tx/<hash> transaction-detail page (lookup by hash alone; the'
\echo '-- PK is (block_number, tx_hash) so it cannot serve hash-only).'
\echo '-- 12 scans = that page is rarely visited, but dropping this makes'
\echo '-- it a 122M-row seq scan = effectively broken.'
\echo '--'
\echo '-- Drop ONLY if you are fine with the /tx/<hash> page being slow or'
\echo '-- disabled (9GB + the largest single per-INSERT write saving). To'
\echo '-- drop it, run manually:'
\echo '--   DROP INDEX CONCURRENTLY IF EXISTS idx_tx_executions_hash;'

\echo ''
\echo '=== AFTER: confirm drops + remaining index footprint ==='
SELECT
  relname AS table,
  indexrelname AS index,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size,
  idx_scan AS scans
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 15;

\echo ''
\echo '############################################################'
\echo '# Done. ~5.4GB reclaimed and per-INSERT write load cut.'
\echo '# If any DROP CONCURRENTLY was interrupted and left an'
\echo '# INVALID index, drop it normally:'
\echo '#   DROP INDEX IF EXISTS <name>;'
\echo '# Check with: \\di+   (look for INVALID)'
\echo '############################################################'
