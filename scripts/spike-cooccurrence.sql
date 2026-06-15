-- spike-cooccurrence.sql
--
-- Read-only spike to de-risk the contract co-occurrence query before we
-- build the relationship-graph product around it. This is the query that
-- could re-melt Postgres if it's not bounded, so we test it in stages,
-- smallest window first, with a hard statement_timeout on every stage so
-- nothing can run away.
--
-- HOW TO RUN (on the VM, off-peak, where it's a local LAN call):
--   cd ~/pev
--   export DATABASE_URL=$(grep "^DATABASE_URL=" .env.production.local | cut -d= -f2-)
--   psql "$DATABASE_URL" -f scripts/spike-cooccurrence.sql
--
-- Run the WHOLE file; it stops itself if any stage is too slow (timeout
-- cancels the statement, the \echo markers tell you how far it got).
-- Paste the full output back.
--
-- Everything here is SELECT / EXPLAIN only. No writes, no DDL.

\timing on
\pset pager off

-- Hard safety rail: any single statement that runs longer than 30s is
-- cancelled by the server. Protects the box from a runaway plan.
SET statement_timeout = '30s';
-- Don't let this session hold things up if it sits idle.
SET idle_in_transaction_session_timeout = '10s';

\echo '=== STAGE 0: block range + window sizing (cheap) ==='
-- Figure out the block numbers for recent time windows so later stages
-- filter by block_number (indexed) instead of timestamp.
SELECT
  max(number)                                   AS head_block,
  max(number) - 9000                            AS one_hour_ago_approx,   -- ~9k blocks/hr
  max(number) - 215000                          AS one_day_ago_approx,    -- ~215k blocks/day
  max(number) - 1505000                         AS one_week_ago_approx
FROM blocks;

\echo ''
\echo '=== STAGE 1: contract-count distribution in a 1-day window ==='
-- This tells us how bad the pair explosion can get. If most txs touch
-- 1-5 contracts we are fine; if many touch 50+ we need a tighter cap.
SELECT
  array_length(contracts, 1) AS n_contracts,
  count(*)                   AS n_txs
FROM tx_executions
WHERE block_number > (SELECT max(number) - 215000 FROM blocks)
  AND contracts IS NOT NULL
GROUP BY array_length(contracts, 1)
ORDER BY n_contracts
LIMIT 60;

\echo ''
\echo '=== STAGE 2: EXPLAIN (no execute) the co-occurrence query, 1-hour window ==='
-- Just the plan. Tells us whether the planner uses a range scan on
-- block_number and how it handles the unnest self-join. Costs nothing.
EXPLAIN
WITH windowed AS (
  SELECT contracts
  FROM tx_executions
  WHERE block_number > (SELECT max(number) - 9000 FROM blocks)
    AND contracts IS NOT NULL
    AND array_length(contracts, 1) BETWEEN 2 AND 20  -- skip no-pair txs, cap explosion
),
pairs AS (
  SELECT p.c1, p.c2
  FROM windowed w
  CROSS JOIN LATERAL (
    SELECT x.a AS c1, y.b AS c2
    FROM unnest(w.contracts) WITH ORDINALITY AS x(a, ia)
    CROSS JOIN unnest(w.contracts) WITH ORDINALITY AS y(b, ib)
    WHERE x.ia < y.ib                                 -- each unordered pair once
  ) p
)
SELECT c1, c2, count(*) AS cooccur
FROM pairs
GROUP BY c1, c2
HAVING count(*) >= 5
ORDER BY count(*) DESC
LIMIT 500;

\echo ''
\echo '=== STAGE 3: EXECUTE the co-occurrence query, 1-HOUR window (real timing) ==='
-- The real thing, but on the smallest window. If this is slow or times
-- out, STOP, do not run stage 4. Paste what you have.
EXPLAIN (ANALYZE, BUFFERS, TIMING)
WITH windowed AS (
  SELECT contracts
  FROM tx_executions
  WHERE block_number > (SELECT max(number) - 9000 FROM blocks)
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
\echo '=== STAGE 4: EXECUTE on 1-DAY window (only if stage 3 was fast, <5s) ==='
-- Scale-up test. The 30s statement_timeout will cancel this if it is too
-- expensive, which is the answer we want (means we need top-K contract
-- pre-filtering before this is production-safe).
EXPLAIN (ANALYZE, BUFFERS, TIMING)
WITH windowed AS (
  SELECT contracts
  FROM tx_executions
  WHERE block_number > (SELECT max(number) - 215000 FROM blocks)
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
HAVING count(*) >= 10
ORDER BY count(*) DESC
LIMIT 500;

\echo ''
\echo '=== DONE. Paste everything above back. ==='
