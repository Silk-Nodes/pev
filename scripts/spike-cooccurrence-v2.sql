-- spike-cooccurrence-v2.sql
--
-- Follow-up after v1 showed a Seq Scan on tx_executions. Two hypotheses:
--   (a) the inline subquery bound `block_number > (SELECT max...)` defeats
--       the index (we hit this exact thing in weekly-improvers.ts), and/or
--   (b) there is no usable btree index on tx_executions.block_number.
--
-- This version uses psql \gset to resolve the head block ONCE, client-side,
-- so every query sees a real integer literal (planner can range-scan).
--
-- RUN (on the VM, off-peak):
--   cd ~/pev
--   export DATABASE_URL=$(grep "^DATABASE_URL=" .env.production.local | cut -d= -f2-)
--   psql "$DATABASE_URL" -f scripts/spike-cooccurrence-v2.sql 2>&1 | tee /tmp/spike2.txt
--
-- All SELECT / EXPLAIN only. 30s timeout guard on every statement.

\timing on
\pset pager off
SET statement_timeout = '30s';
SET idle_in_transaction_session_timeout = '10s';

\echo '=== A: what indexes exist on tx_executions? ==='
-- If there is no btree leading with block_number, that is the whole problem.
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'tx_executions'
ORDER BY indexname;

\echo ''
\echo '=== B: resolve head block ONCE into a client-side literal ==='
SELECT max(number) AS head FROM blocks \gset
\echo 'head block is:' :head

\echo ''
\echo '=== C: trivial count over 1 hour, LITERAL bound (tests index range scan) ==='
-- If this is instant, the index works and the v1 problem was the subquery.
-- If this is slow / times out, block_number has no usable index (bigger fix).
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*)
FROM tx_executions
WHERE block_number > :head - 9000;

\echo ''
\echo '=== D: contract-count distribution, 1 hour, LITERAL bound ==='
-- The v1 Stage 1 that timed out, now with a literal bound + tiny window.
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT array_length(contracts, 1) AS n_contracts, count(*) AS n_txs
FROM tx_executions
WHERE block_number > :head - 9000
  AND contracts IS NOT NULL
GROUP BY array_length(contracts, 1)
ORDER BY n_contracts;

\echo ''
\echo '=== E: co-occurrence query, 1 hour, LITERAL bound (the real test) ==='
EXPLAIN (ANALYZE, BUFFERS, TIMING)
WITH windowed AS (
  SELECT contracts
  FROM tx_executions
  WHERE block_number > :head - 9000
    AND contracts IS NOT NULL
    AND array_length(contracts, 1) BETWEEN 2 AND 20
),
pairs AS (
  SELECT p.c1, p.c2
  FROM windowed w
  CROSS JOIN LATERAL (
    SELECT x.a AS c1, y.b AS c2
    FROM unnest(w.contracts) WITH ORDINALITY AS x(a, ia)
    CROSS JOIN unnest(w.contracts) WITH ORDINALITY AS y(b, ib)
    WHERE x.ia < y.ib
  ) p
)
SELECT c1, c2, count(*) AS cooccur
FROM pairs
GROUP BY c1, c2
HAVING count(*) >= 5
ORDER BY count(*) DESC
LIMIT 500;

\echo ''
\echo '=== DONE (v2). Paste everything back. ==='
