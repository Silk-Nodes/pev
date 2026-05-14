-- 007_nullable_probe_data.sql, allow probe_data to be NULL.
--
-- Background: probe_data was a JSONB blob duplicating data we already
-- store in normalized form across tx_executions, conflicts, and
-- block_hot_slots. At ~1.5M blocks the blob ballooned to 11GB, blowing
-- past the VM's RAM and forcing every page read to hit cold disk.
--
-- New strategy:
--   • For the most recent ~24h of blocks, keep probe_data populated
--     (fast path, one row read serves the block page).
--   • For older blocks, set probe_data = NULL and rely on the
--     reconstruction path in getBlockPEV (three indexed queries on
--     block_number, ~30-100ms total). No data loss, the normalized
--     tables already contain everything.
--
-- Long-term: indexer will stop writing probe_data entirely once we're
-- confident the reconstruction path is solid. For now we leave the
-- column writable so a manual re-trace can populate a specific block
-- if we ever need to debug a schema mismatch.

ALTER TABLE blocks
  ALTER COLUMN probe_data DROP NOT NULL;
