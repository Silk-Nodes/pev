-- db-tune-tier1.sql, Tier 1 Postgres tuning for the pev DB host.
--
-- Fixes the root cause found by db-diagnose.sql: the instance runs on
-- stock defaults (shared_buffers=128MB, work_mem=4MB) while hosting
-- 128GB of data, so cache hit rate sits at ~56% and reads + writes both
-- thrash the disk. These settings give Postgres room to cache and to
-- sort in memory.
--
-- MUST be run as the postgres SUPERUSER on the DB host (10.42.44.182),
-- ALTER SYSTEM is superuser-only:
--   sudo -u postgres psql -d pev -f db-tune-tier1.sql
--   (or: sudo -u postgres psql -f db-tune-tier1.sql  — ALTER SYSTEM is
--    cluster-wide, the target db does not matter)
--
-- Most settings apply on `SELECT pg_reload_conf()` at the end (NO
-- downtime). ONLY shared_buffers needs a restart, done manually after.
--
-- ─────────────────────────────────────────────────────────────────
-- FIRST: confirm RAM with `free -h` on the host and pick the column.
-- Values below are the 8GB column. If RAM differs, edit the 5 starred
-- lines before running.
--
--   RAM   shared_buffers  effective_cache_size  maint_work_mem  work_mem
--   8 GB      2GB              6GB                  512MB          16MB
--   16 GB     4GB              12GB                 1GB            24MB
--   32 GB     8GB              24GB                 2GB            32MB
--
-- Rule of thumb: shared_buffers = 25% RAM, effective_cache_size = 75%.
-- Only safe at 25% if this box is DEDICATED to Postgres. If it shares
-- the host with other services, use less (e.g. 15%) and check `free -h`.
-- ─────────────────────────────────────────────────────────────────

\echo '=== BEFORE: current values ==='
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('shared_buffers','effective_cache_size','work_mem',
               'maintenance_work_mem','max_wal_size','wal_compression',
               'effective_io_concurrency','random_page_cost')
ORDER BY name;

-- ── Memory: the core fix ────────────────────────────────────────
ALTER SYSTEM SET shared_buffers       = '2GB';     -- * 25% of RAM (needs restart)
ALTER SYSTEM SET effective_cache_size = '6GB';     -- * 75% of RAM (planner hint, no restart)
ALTER SYSTEM SET maintenance_work_mem = '512MB';   -- * faster vacuum / index builds
-- work_mem is PER sort/hash node PER connection. Keep modest so 100
-- connections can't OOM the box; heavy batch jobs raise it locally with
-- SET LOCAL work_mem (the refresh jobs already do this).
ALTER SYSTEM SET work_mem             = '16MB';    -- * up from 4MB

-- ── WAL / checkpoints: ease write-flush pressure ────────────────
ALTER SYSTEM SET max_wal_size         = '4GB';     -- fewer forced checkpoints under indexer load
ALTER SYSTEM SET min_wal_size         = '1GB';
ALTER SYSTEM SET wal_compression      = 'on';      -- less WAL write IO, ~small CPU cost; a win on an IO-bound box

-- ── IO / planner: SSD-oriented ─────────────────────────────────
-- These two assume the data disk is SSD/NVMe (confirm with db-host-info.sh:
-- lsblk ROTA=0). If it is a SPINNING disk (ROTA=1), set
-- effective_io_concurrency = 2 and random_page_cost = 4 instead.
ALTER SYSTEM SET effective_io_concurrency = 200;   -- enable read prefetch (SSD)
ALTER SYSTEM SET random_page_cost         = 1.1;   -- random reads are cheap on SSD; unlocks better index plans

\echo ''
\echo '=== Reloading config (applies everything EXCEPT shared_buffers) ==='
SELECT pg_reload_conf();

\echo ''
\echo '=== AFTER: staged values (shared_buffers shows pending_restart=t) ==='
SELECT name, setting, unit, pending_restart FROM pg_settings
WHERE name IN ('shared_buffers','effective_cache_size','work_mem',
               'maintenance_work_mem','max_wal_size','wal_compression',
               'effective_io_concurrency','random_page_cost')
ORDER BY name;

\echo ''
\echo '############################################################'
\echo '# Reloadable settings are LIVE now.'
\echo '# shared_buffers shows pending_restart = t — it only takes'
\echo '# effect after ONE restart. When ready for the brief blip:'
\echo '#'
\echo '#   sudo systemctl restart postgresql'
\echo '#'
\echo '# pev-web reconnects automatically (pool re-dials). Then'
\echo '# re-run db-diagnose.sql section 7 and watch the cache hit'
\echo '# rate climb from ~56% toward 95%+ over the next hour as the'
\echo '# new 2GB buffer pool warms.'
\echo '############################################################'
