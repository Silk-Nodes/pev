#!/usr/bin/env tsx
/**
 * refresh-contract-index.ts, rebuild the contract_index aggregate.
 *
 * Why this script:
 *
 * tx_executions stores one row per executed tx with a `contracts BYTEA[]`
 * column listing every address that participated in state read/write.
 * Looking up "what's the last block this address appeared in?" against
 * 23M+ tx_executions rows + a GIN index on the array column was timing
 * out on popular contracts (the planner's choice between bitmap-sort
 * and btree-walk-with-per-row-filter both have pathological cases).
 *
 * This script does the unnesting + grouping ONCE per refresh tick,
 * then point-lookups against the resulting `contract_index` table are
 * O(1) regardless of contract popularity.
 *
 * Usage:
 *   npm run db:refresh-contract-index
 *
 * Designed to be invoked from a systemd timer every ~5 min. Idempotent
 * (UPSERTs into contract_index). Safe to run repeatedly. The refresh
 * runs in the same connection-pool model as the rest of the app so it
 * shares the DATABASE_URL convention.
 *
 * Performance:
 *   • The unnest+GROUP BY is the heavy step. On 23M rows × ~3 contracts
 *     each = ~70M (contract, block) pairs to fold into ~few-hundred-K
 *     unique contracts. Estimated 30-90s for the full scan.
 *   • Memory: the GROUP BY runs server-side, no JS-side accumulation.
 *   • Locks: ON CONFLICT DO UPDATE acquires row-level locks per contract
 *     during write but no table-level locks. Indexer continues writing
 *     to tx_executions concurrently.
 *
 * Failure modes:
 *   • If the script crashes mid-write, contract_index is partially
 *     updated; the next run will reconcile because UPSERT is idempotent.
 *   • Stale rows (contract no longer in tx_executions) are not pruned;
 *     in practice tx_executions doesn't shrink, so this isn't an issue.
 */

import { closePool, query } from "../src/lib/db";

async function main() {
  const start = Date.now();
  console.log("pev refresh-contract-index · start");

  // The big aggregation. We do it in a single SQL statement so Postgres
  // can stream the unnest + group + upsert without round trips.
  //
  // Two notes on this query:
  //   1. We use `array_position` and `unnest WITH ORDINALITY` indirectly
  //      via plain `unnest` because we don't need the ordinality —
  //      every element gets the same block_number from its parent row.
  //   2. ON CONFLICT … DO UPDATE keeps first_block at the minimum across
  //      runs (in case rows roll in older for some reason) and updates
  //      last_block / tx_count from the new aggregation.
  const result = await query(
    `INSERT INTO contract_index AS ci (contract, first_block, last_block, tx_count, refreshed_at)
     SELECT contract,
            min(block_number) AS first_block,
            max(block_number) AS last_block,
            count(*)          AS tx_count,
            NOW()             AS refreshed_at
       FROM tx_executions, unnest(contracts) AS contract
      GROUP BY contract
     ON CONFLICT (contract) DO UPDATE SET
       first_block  = LEAST(ci.first_block, EXCLUDED.first_block),
       last_block   = GREATEST(ci.last_block, EXCLUDED.last_block),
       tx_count     = EXCLUDED.tx_count,
       refreshed_at = EXCLUDED.refreshed_at`,
  );

  const elapsedMs = Date.now() - start;
  const rows = result.rowCount ?? 0;
  console.log(
    `pev refresh-contract-index · done in ${(elapsedMs / 1000).toFixed(1)}s, ${rows.toLocaleString()} contracts upserted`,
  );
}

main()
  .catch((err) => {
    console.error("[refresh-contract-index] error:", err);
    process.exit(1);
  })
  .finally(() => closePool());
