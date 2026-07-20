#!/usr/bin/env tsx
/**
 * refresh-contract-stats.ts, fill contract_stats_daily incrementally.
 *
 * This is the content infrastructure: once this rollup is maintained,
 * trend reads (week/month movers, per-contract history, most-parallel
 * boards, anomaly checks) become instant single-table queries instead of
 * multi-minute scans over raw block_hot_slots.
 *
 * GENTLE by construction (post 2026-06-18 meltdown): cursor-based,
 * processes bounded chunks, every chunk runs under a server-side
 * statement_timeout, and the cursor commits per chunk so a kill resumes
 * cleanly. Run it off-peak with the indexer watched.
 *
 * Usage:
 *   npm run stats:daily                          # advance 10 chunks (200k blocks)
 *   npm run stats:daily -- --max-chunks=30       # bigger catch-up pass
 *   npm run stats:daily -- --from-block=83000000 # seed the cursor, then run
 *   npm run stats:daily -- --status              # just report cursor vs head
 *
 * First run: the cursor starts at 0. Do NOT let it grind all of history.
 * Seed it to where you want trends to begin, e.g. ~30 days back for
 * monthly content, then advance in passes.
 */

import { closePool } from "../src/lib/db";
import {
  refreshContractStatsDaily,
  seedContractStatsCursor,
  getContractStatsCursor,
} from "../src/lib/indexer/store";

function intArg(name: string): number | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<number> {
  const { cursor, head } = await getContractStatsCursor();

  if (process.argv.includes("--status")) {
    const behind = head - cursor;
    console.log(
      `[stats-daily] cursor ${cursor.toLocaleString()} · head ${head.toLocaleString()} · ` +
        `${behind.toLocaleString()} blocks behind (~${(behind / 216_000).toFixed(1)} days)`,
    );
    return 0;
  }

  const seed = intArg("from-block");
  if (seed !== undefined) {
    await seedContractStatsCursor(seed);
    console.log(`[stats-daily] cursor seeded to ${seed.toLocaleString()}`);
  }

  const maxChunks = intArg("max-chunks") ?? 10;
  const chunkBlocks = intArg("chunk-blocks") ?? 20_000;
  const timeoutMs = intArg("timeout") ?? 120_000;

  console.log(
    `[stats-daily] starting · max-chunks=${maxChunks} chunk=${chunkBlocks.toLocaleString()} timeout=${timeoutMs}ms`,
  );
  const started = Date.now();
  const r = await refreshContractStatsDaily({ maxChunks, chunkBlocks, timeoutMs });

  console.log(
    `[stats-daily] done in ${Date.now() - started}ms · ` +
      `blocks ${r.fromBlock.toLocaleString()} → ${r.toBlock.toLocaleString()} ` +
      `(${r.blocksProcessed.toLocaleString()} in ${r.chunks} chunk${r.chunks === 1 ? "" : "s"}) · ` +
      `${r.rowsWritten.toLocaleString()} rows · ` +
      `${r.caughtUp ? "CAUGHT UP" : "more backlog remains, run again"}`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[stats-daily] fatal: ${(err as Error).message}`);
    await closePool();
    process.exit(1);
  });
