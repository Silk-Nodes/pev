-- 009_conflicts_block_number_index.sql, btree on conflicts(block_number).
--
-- Symptom: the analytics page's "conflict kinds" breakdown query
--   SELECT kind, count(*) FROM conflicts WHERE block_number > $1 GROUP BY kind
-- did a Parallel Seq Scan over 1.9M rows, taking 7 seconds. There's no
-- existing index on conflicts.block_number, so the WHERE filter
-- couldn't be pushed into an index range scan.
--
-- This index brings the same query to <100ms and also helps any future
-- range-scan-by-block queries on the conflicts table (e.g. per-block
-- conflict detail).
--
-- Idempotent.

CREATE INDEX IF NOT EXISTS idx_conflicts_block_number
  ON conflicts (block_number);
