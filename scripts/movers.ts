#!/usr/bin/env tsx
/**
 * movers.ts, contract contention movers straight off the daily rollup.
 *
 * This is the content query: "who improved / who regressed" over any
 * window. Because it reads contract_stats_daily (small, indexed by day)
 * instead of raw block_hot_slots, it returns in milliseconds and puts
 * effectively no load on the shared DB, unlike scripts/weekly-improvers.ts
 * which scans source tables and takes minutes.
 *
 * Requires the rollup to be populated: npm run stats:daily
 *
 * Usage:
 *   npm run movers                       # last 7d vs prior 7d
 *   npm run movers -- --window=30        # last 30d vs prior 30d (monthly)
 *   npm run movers -- --min-cpb=3        # filter low-signal contracts
 *   npm run movers -- --limit=25
 */

import { closePool } from "../src/lib/db";
import { getContractMovers } from "../src/lib/indexer/store";

function intArg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : dflt;
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const num = (n: number, d = 1) => n.toFixed(d).padStart(8);

async function main(): Promise<number> {
  const windowDays = intArg("window", 7);
  const minCpb = intArg("min-cpb", 3);
  const limit = intArg("limit", 20);

  const started = Date.now();
  const movers = await getContractMovers(windowDays, minCpb, limit);
  const ms = Date.now() - started;

  if (!movers.length) {
    console.log(
      `No movers. Is the rollup populated for the last ${windowDays * 2} days? ` +
        `Run: npm run stats:daily -- --status`,
    );
    return 0;
  }

  console.log(
    `\nContention movers · last ${windowDays}d vs prior ${windowDays}d · min ${minCpb} cpb · queried in ${ms}ms\n`,
  );
  console.log(
    `  ${pad("contract", 42)} ${"prior_cpb".padStart(9)} ${"recent_cpb".padStart(10)} ${"change".padStart(9)}`,
  );
  console.log(`  ${"-".repeat(42)} ${"-".repeat(9)} ${"-".repeat(10)} ${"-".repeat(9)}`);

  for (const m of movers) {
    const name = m.label ?? m.address;
    const arrow = m.pctChange < 0 ? "▼" : "▲";
    console.log(
      `  ${pad(name, 42)} ${num(m.priorCpb)} ${num(m.recentCpb, 1).padStart(10)} ` +
        `${(arrow + " " + m.pctChange.toFixed(1) + "%").padStart(9)}`,
    );
  }

  const improved = movers.filter((m) => m.pctChange < 0).length;
  console.log(
    `\n  ${improved} improving, ${movers.length - improved} regressing (of ${movers.length} shown)\n`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[movers] fatal: ${(err as Error).message}`);
    await closePool();
    process.exit(1);
  });
