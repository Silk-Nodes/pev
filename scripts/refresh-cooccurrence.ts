#!/usr/bin/env tsx
/**
 * refresh-cooccurrence.ts, incrementally roll up contract co-occurrence
 * into contract_pair_daily.
 *
 * Backs the contract relationship-graph product. Processes only blocks
 * newer than the stored cursor, in small chunks, server-side. Cheap
 * enough to run frequently on a systemd timer in steady state; backfills
 * the recent window over several runs on first invocation.
 *
 * Usage:
 *   npm run cooccurrence:refresh                  # steady-state tick
 *   npm run cooccurrence:refresh -- --max-chunks=5   # bounded backfill step
 *   npm run cooccurrence:refresh -- --chunk-blocks=10000
 *
 * Exit codes:
 *   0  success (cursor advanced, or already caught up)
 *   1  failure (DB unreachable, query error, etc.)
 *
 * A failed run is non-fatal: the cursor only advances per committed
 * chunk, so the next run resumes where this one stopped.
 */

import { closePool } from "../src/lib/db";
import {
  refreshCooccurrence,
  type CooccurrenceRefreshOptions,
} from "../src/lib/indexer/store";

function parseArgs(): CooccurrenceRefreshOptions {
  const opts: CooccurrenceRefreshOptions = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z-]+)=(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    const n = parseInt(val, 10);
    if (key === "chunk-blocks" && Number.isFinite(n)) opts.chunkBlocks = n;
    else if (key === "max-chunks" && Number.isFinite(n)) opts.maxChunks = n;
    else if (key === "cold-start-backfill-blocks" && Number.isFinite(n))
      opts.coldStartBackfillBlocks = n;
    else if (key === "max-contracts-per-tx" && Number.isFinite(n))
      opts.maxContractsPerTx = n;
    else if (key === "work-mem") opts.workMem = val;
  }
  return opts;
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  const opts = parseArgs();
  console.log(
    `[cooccurrence-refresh] starting at ${new Date().toISOString()}` +
      (Object.keys(opts).length ? ` opts=${JSON.stringify(opts)}` : ""),
  );

  const r = await refreshCooccurrence(opts);
  const elapsedMs = Date.now() - startedAt;

  console.log(
    `[cooccurrence-refresh] done in ${elapsedMs}ms · ` +
      `blocks ${r.fromBlock.toLocaleString()} → ${r.toBlock.toLocaleString()} ` +
      `(${r.blocksProcessed.toLocaleString()} in ${r.chunks} chunk${r.chunks === 1 ? "" : "s"}) · ` +
      `${r.caughtUp ? "caught up" : "MORE BACKLOG REMAINS, run again"}`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[cooccurrence-refresh] fatal: ${(err as Error).message}`);
    console.error((err as Error).stack);
    await closePool();
    process.exit(1);
  });
