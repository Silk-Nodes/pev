-- 008_drop_old_probe_data.sql, NULL the historical probe_data blobs.
--
-- Together with the indexer change in writeBlock (now writes NULL for
-- probe_data on every new block), this brings the blocks table back from
-- ~11GB to a few hundred MB. The block page reads still work via the
-- reconstruction path in getBlockPEV.
--
-- We do NOT VACUUM FULL inside the migration. VACUUM FULL takes an
-- ACCESS EXCLUSIVE lock on the table for the duration (~5-10 min on
-- 11GB), which blocks the live indexer. Run it as a separate manual
-- step during a maintenance window:
--
--    psql $DATABASE_URL -c 'VACUUM FULL blocks;'
--
-- Without VACUUM FULL the disk space stays allocated to the table (it
-- gets reused for new rows over time, just doesn't shrink). That's fine
-- for the perf goal: the page cache cares about logical row size, not
-- file size, and a regular VACUUM ANALYZE updates the planner stats.
--
-- Idempotent: re-running just sets already-NULL rows to NULL again.

UPDATE blocks SET probe_data = NULL WHERE probe_data IS NOT NULL;

-- ANALYZE so the planner's row-size stats reflect reality immediately.
ANALYZE blocks;
