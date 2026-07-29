#!/usr/bin/env tsx
/**
 * refresh-growth.ts, build the /scale payload and cache it.
 *
 * GENTLE by construction: each aggregate runs on its own connection under
 * a server-side statement_timeout, sequentially, and a query over budget
 * is skipped (report marked partial) rather than left to grind. Run it
 * off-peak with the indexer watched.
 *
 * Usage:
 *   npm run growth                      # 30-day window
 *   npm run growth -- --days=60         # wider (heavier, watch it)
 *   npm run growth -- --timeout=90000
 *
 * NOTE: the "new contracts per week" section reads contract_index. If
 * that table is stale, refresh it first:
 *   npm run db:refresh-contract-index
 */

import { closePool } from "../src/lib/db";
import { refreshGrowthData, writeGrowthCache } from "../src/lib/indexer/store";

function intArg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : dflt;
}

async function main(): Promise<number> {
  const windowDays = intArg("days", 30);
  const timeoutMs = intArg("timeout", 60_000);
  // The slot-concentration query scans block_hot_slots chain-wide, by far
  // the heaviest part. Keep its window short and independent of --days.
  const concentrationDays = intArg("concentration-days", 3);

  console.log(
    `[growth] building · window=${windowDays}d · concentration=${concentrationDays}d · ` +
      `per-query timeout=${timeoutMs}ms`,
  );
  const started = Date.now();
  const data = await refreshGrowthData({ windowDays, timeoutMs, concentrationDays });
  const ms = Date.now() - started;

  if (data.daily.length === 0) {
    console.error("[growth] no daily rows, cache left untouched (query timed out?)");
    return 1;
  }

  await writeGrowthCache(data, ms);
  console.log(
    `[growth] cached in ${ms}ms · ${data.daily.length} days · ` +
      `${data.newContracts.length} weeks of new contracts · ` +
      `${data.totals.txs.toLocaleString()} txs · ` +
      `${(data.totals.contractsTracked ?? 0).toLocaleString()} contracts tracked` +
      (data.partial ? " · PARTIAL (a query was skipped)" : ""),
  );
  console.log(
    `[growth] waves: ${data.waves?.length ?? 0} buckets · ` +
      `concentration: ${data.concentration
        ? `top10 = ${data.concentration.pct}% of conflicts (${data.concentration.windowDays}d)`
        : "skipped"}`,
  );
  const d = data.deltas;
  console.log(
    `[growth] first vs last week · txs ${d.txsPct ?? "?"}% · ` +
      `score ${d.scorePct ?? "?"}% · conflicts/block ${d.cpbPct ?? "?"}%`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[growth] fatal: ${(err as Error).message}`);
    await closePool();
    process.exit(1);
  });
