-- db-diagnose.sql, comprehensive read-only health snapshot of the pev
-- Postgres host. Built to find the ROOT CAUSE of the recurring "DB melts
-- under heavy work while indexing" problem, not just its symptoms.
--
-- Everything here reads catalog / statistics views (cheap, no scans of
-- the big tables), so it is safe to run even when the box is busy. No
-- writes, no DDL, no heavy aggregates.
--
-- RUN (on the VM, via the prod DATABASE_URL):
--   cd ~/pev
--   export DATABASE_URL=$(grep "^DATABASE_URL=" .env.production.local | cut -d= -f2-)
--   psql "$DATABASE_URL" -f scripts/db-diagnose.sql 2>&1 | tee /tmp/db-diagnose.txt
--
-- Paste /tmp/db-diagnose.txt back. Each section is labelled so we can
-- read it as a whole.

\pset pager off
\timing off
SET statement_timeout = '60s';

\echo '############################################################'
\echo '# 1. VERSION + UPTIME'
\echo '############################################################'
SELECT version();
SELECT
  pg_postmaster_start_time()                       AS started,
  now() - pg_postmaster_start_time()               AS uptime,
  current_setting('server_version')                AS pg_version;

\echo ''
\echo '############################################################'
\echo '# 2. KEY MEMORY / PARALLELISM / IO CONFIG'
\echo '# (the settings that decide whether heavy queries spill to'
\echo '#  disk, how aggressively Postgres reads, and concurrency)'
\echo '############################################################'
SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
  'max_connections','max_parallel_workers','max_parallel_workers_per_gather',
  'max_worker_processes','random_page_cost','seq_page_cost',
  'effective_io_concurrency','default_statistics_target','jit'
)
ORDER BY name;

\echo ''
\echo '############################################################'
\echo '# 3. WAL / CHECKPOINT CONFIG'
\echo '# (write-heavy indexer + checkpoint storms are a classic'
\echo '#  iowait source; small max_wal_size forces frequent flushes)'
\echo '############################################################'
SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'max_wal_size','min_wal_size','checkpoint_timeout',
  'checkpoint_completion_target','wal_buffers','wal_compression',
  'synchronous_commit','full_page_writes'
)
ORDER BY name;

\echo ''
\echo '############################################################'
\echo '# 4. AUTOVACUUM CONFIG'
\echo '# (if vacuum cannot keep up with the indexer write rate,'
\echo '#  tables bloat, scans read more pages, iowait rises)'
\echo '############################################################'
SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'autovacuum','autovacuum_max_workers','autovacuum_naptime',
  'autovacuum_vacuum_cost_limit','autovacuum_vacuum_cost_delay',
  'autovacuum_vacuum_scale_factor','autovacuum_analyze_scale_factor'
)
ORDER BY name;

\echo ''
\echo '############################################################'
\echo '# 5. DATABASE SIZE + TOP TABLES (table vs index bytes)'
\echo '############################################################'
SELECT pg_size_pretty(pg_database_size(current_database())) AS total_db_size;

SELECT
  relname AS table,
  pg_size_pretty(pg_total_relation_size(relid))                          AS total,
  pg_size_pretty(pg_relation_size(relid))                               AS heap,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexes_toast,
  to_char(n_live_tup, 'FM999,999,999')                                  AS live_rows,
  to_char(n_dead_tup, 'FM999,999,999')                                  AS dead_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

\echo ''
\echo '############################################################'
\echo '# 6. INDEX SIZE + USAGE'
\echo '# (unused indexes still cost write throughput on every'
\echo '#  INSERT; idx_scan=0 on a big index is dead weight)'
\echo '############################################################'
SELECT
  relname        AS table,
  indexrelname   AS index,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size,
  to_char(idx_scan, 'FM999,999,999')           AS scans
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

\echo ''
\echo '############################################################'
\echo '# 7. CACHE HIT RATIO'
\echo '# (if these are well below ~99%, the working set does not'
\echo '#  fit in shared_buffers / RAM and queries hit disk hard)'
\echo '############################################################'
SELECT 'table heap hit rate %' AS metric,
       round(sum(heap_blks_hit)*100.0/nullif(sum(heap_blks_hit+heap_blks_read),0),3) AS value
FROM pg_statio_user_tables
UNION ALL
SELECT 'index hit rate %',
       round(sum(idx_blks_hit)*100.0/nullif(sum(idx_blks_hit+idx_blks_read),0),3)
FROM pg_statio_user_indexes;

\echo ''
\echo '-- Per-table heap read vs hit (the tables actually causing disk reads):'
SELECT
  relname AS table,
  to_char(heap_blks_read, 'FM999,999,999,999') AS disk_reads,
  to_char(heap_blks_hit,  'FM999,999,999,999') AS cache_hits,
  round(heap_blks_hit*100.0/nullif(heap_blks_hit+heap_blks_read,0),2) AS hit_pct
FROM pg_statio_user_tables
ORDER BY heap_blks_read DESC
LIMIT 10;

\echo ''
\echo '############################################################'
\echo '# 8. CHECKPOINT / BACKGROUND WRITER STATS'
\echo '# (buffers_backend high vs buffers_checkpoint => backends'
\echo '#  forced to flush their own dirty pages = write stalls.'
\echo '#  checkpoints_req high vs _timed => max_wal_size too small)'
\echo '############################################################'
SELECT
  checkpoints_timed,
  checkpoints_req,
  buffers_checkpoint,
  buffers_clean,
  buffers_backend,
  maxwritten_clean,
  stats_reset
FROM pg_stat_bgwriter;

\echo ''
\echo '############################################################'
\echo '# 9. AUTOVACUUM HEALTH PER TABLE (dead tuples + last run)'
\echo '############################################################'
SELECT
  relname AS table,
  to_char(n_live_tup, 'FM999,999,999') AS live,
  to_char(n_dead_tup, 'FM999,999,999') AS dead,
  round(n_dead_tup*100.0/nullif(n_live_tup+n_dead_tup,0),1) AS dead_pct,
  last_autovacuum,
  last_autoanalyze,
  autovacuum_count,
  autoanalyze_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 12;

\echo ''
\echo '############################################################'
\echo '# 10. CURRENT CONNECTIONS BY STATE'
\echo '# (idle-in-transaction holding resources? too many backends?)'
\echo '############################################################'
SELECT
  usename,
  state,
  count(*),
  max(now() - state_change) AS oldest_in_state
FROM pg_stat_activity
GROUP BY usename, state
ORDER BY count(*) DESC;

\echo ''
\echo '############################################################'
\echo '# 11. TOP QUERIES BY TOTAL TIME (needs pg_stat_statements)'
\echo '# (this is the single most valuable section if available:'
\echo '#  it ranks what actually consumes the DB, cumulatively)'
\echo '############################################################'
SELECT EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
) AS pg_stat_statements_installed;

-- If the above is "t", this returns the heavy hitters; if "f", it errors
-- harmlessly (relation does not exist) and we know to enable it.
SELECT
  round(total_exec_time/1000.0)                                   AS total_sec,
  to_char(calls, 'FM999,999,999')                                 AS calls,
  round(mean_exec_time)                                           AS mean_ms,
  round(100.0*total_exec_time/sum(total_exec_time) over (), 1)    AS pct_of_total,
  left(regexp_replace(query, '\s+', ' ', 'g'), 90)               AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 15;

\echo ''
\echo '############################################################'
\echo '# DONE. Paste /tmp/db-diagnose.txt back.'
\echo '############################################################'
