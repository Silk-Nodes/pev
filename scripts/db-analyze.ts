#!/usr/bin/env tsx
/**
 * db-analyze.ts, run ANALYZE on the hot tables so the planner has fresh
 * row-count + value-distribution stats for the tx_executions GIN index
 * and the per-block btree paths.
 *
 * Why this exists as its own script:
 *
 * Symptom we're fixing: a contract page query like
 *   SELECT … FROM tx_executions
 *    WHERE $1 = ANY(contracts) AND block_number >= $2
 * was timing out at 2.5s for an address that has zero matching rows in
 * the entire table. The planner was picking a btree-on-block_number scan
 * + per-row contracts filter (~7,200 blocks × 30 rows/block = 216k rows
 * walked) instead of the GIN bitmap scan that returns an empty bitmap
 * in a single millisecond.
 *
 * Root cause: the planner's stats for tx_executions were stale enough
 * that it underestimated the GIN selectivity. Postgres autovacuum runs
 * ANALYZE periodically but not always fast enough on tables that grow
 * by millions of rows per day. Running ANALYZE explicitly resets the
 * stats and the planner picks the right path for both empty and popular
 * contracts on the next query.
 *
 * Usage:
 *   npm run db:analyze            # one-shot, prints which tables and how long
 *   npm run db:analyze -- --all   # also analyzes secondary tables
 *
 * Idempotent and safe to re-run anytime; ANALYZE takes a brief share
 * lock per table (no writes blocked, no readers blocked beyond the
 * stats catalog update).
 */

import { closePool, query } from "../src/lib/db";

// Hot tables in priority order. The first three drive the contract
// page; the rest are touched by /analytics and the leaderboard API.
const HOT_TABLES = ["tx_executions", "blocks", "block_hot_slots"];
const SECONDARY_TABLES = ["conflicts", "contract_stats_daily", "analytics_cache"];

async function analyzeOne(table: string): Promise<{ table: string; ms: number }> {
  const start = Date.now();
  await query(`ANALYZE ${table}`);
  return { table, ms: Date.now() - start };
}

async function main() {
  const includeSecondary = process.argv.includes("--all");
  const tables = [...HOT_TABLES, ...(includeSecondary ? SECONDARY_TABLES : [])];

  console.log(`pev db:analyze · ${tables.length} tables`);
  console.log("");

  for (const t of tables) {
    process.stdout.write(`  ANALYZE ${t}…`);
    try {
      const { ms } = await analyzeOne(t);
      console.log(` done in ${ms} ms`);
    } catch (err) {
      console.log(` FAILED: ${(err as Error).message}`);
    }
  }
  console.log("");
  console.log("Stats refreshed. Test the diagnostic endpoint:");
  console.log("  curl https://pev.silknodes.io/api/v1/debug/contract/0x…");
}

main()
  .catch((err) => {
    console.error("[db:analyze] error:", err);
    process.exit(1);
  })
  .finally(() => closePool());
