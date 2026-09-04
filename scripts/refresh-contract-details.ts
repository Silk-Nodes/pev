#!/usr/bin/env tsx
/**
 * refresh-contract-details.ts, precompute the /contract payloads.
 *
 * The page used to run four aggregates over tx_executions per request.
 * For the contracts people actually look up that means a GIN bitmap over
 * 5M to 74M rows, which no request-time budget can finish, so the page
 * hung. That work lives here now, where it can have a long timeout and
 * run off-peak against a database nobody is waiting on.
 *
 * GENTLE by construction, same discipline as refresh-growth.ts:
 *   - one contract at a time, one window at a time, never in parallel
 *   - a per-window statement_timeout, and a contract that blows it is
 *     skipped rather than retried
 *   - a wall-clock budget for the whole run, so a slow night stops
 *     cleanly instead of overlapping the next tick
 *   - stale-first ordering, so an interrupted run still makes progress
 *     on whatever is most out of date
 *
 * Usage:
 *   npm run contract-details                        # top 40, 24h + 7d
 *   npm run contract-details -- --limit=100
 *   npm run contract-details -- --windows=24h,7d,30d
 *   npm run contract-details -- --budget=900        # seconds
 */

import { closePool } from "../src/lib/db";
import {
  getContractDetail,
  getContractsToPrecompute,
  writeContractDetailCache,
} from "../src/lib/indexer/store";
import type { ContractWindowKey } from "../src/lib/indexer/store";

function intArg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : dflt;
}
function listArg(name: string, dflt: string[]): string[] {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
}

const VALID: readonly string[] = ["1h", "24h", "7d", "30d", "all"];

async function main(): Promise<number> {
  const limit = intArg("limit", 40);
  // ~4 hours at the current block rate, about 800k block_hot_slots rows.
  // A full day (300k blocks, ~4.7M rows) blew a 60s timeout on the live
  // box. The contended-contract ranking is stable over hours, so the
  // shorter range costs nothing that matters.
  const lookbackBlocks = intArg("lookback-blocks", 50_000);
  // Picking targets is one aggregate and it runs once per job, so it gets
  // its own generous budget rather than sharing the per-window one.
  const targetTimeoutMs = intArg("target-timeout", 300_000);
  // 24h and 7d are what the UI actually opens with. 30d and `all` are
  // opt-in because they are the windows that cost the most and get the
  // fewest views.
  const windows = listArg("windows", ["24h", "7d"]);
  const perWindowTimeoutMs = intArg("timeout", 120_000);
  const budgetMs = intArg("budget", 900) * 1000;

  const bad = windows.filter((w) => !VALID.includes(w));
  if (bad.length) {
    console.error(`[details] unknown window(s): ${bad.join(", ")}`);
    return 1;
  }

  const started = Date.now();
  console.log(
    `[details] top ${limit} contracts over ${lookbackBlocks.toLocaleString()} blocks · windows=${windows.join(",")} · ` +
      `per-window timeout=${perWindowTimeoutMs}ms · budget=${budgetMs / 1000}s`,
  );

  let addrs: string[];
  try {
    addrs = await getContractsToPrecompute(limit, lookbackBlocks, targetTimeoutMs);
  } catch (err) {
    // Target selection is the one query that must succeed; without it
    // there is nothing to precompute. Fail with the knob to turn rather
    // than a raw pg stack trace.
    console.error(
      `[details] could not pick targets: ${(err as Error).message}\n` +
        `[details] try a shorter range, e.g. --lookback-blocks=20000`,
    );
    return 1;
  }
  if (addrs.length === 0) {
    // No hot slots in the recent range means the indexer is not writing,
    // which is a much bigger problem than a cold cache. Say so rather than
    // exiting 0 and looking like a successful no-op.
    console.error(
      "[details] no contracts found in block_hot_slots. Is the indexer running?",
    );
    return 1;
  }
  console.log(`[details] ${addrs.length} contracts selected`);

  let ok = 0;
  let skipped = 0;
  let ranOutOfBudget = false;

  outer: for (const addr of addrs) {
    for (const w of windows) {
      if (Date.now() - started > budgetMs) {
        ranOutOfBudget = true;
        break outer;
      }
      const t0 = Date.now();
      try {
        const detail = await getContractDetail(
          addr,
          w as ContractWindowKey,
          perWindowTimeoutMs,
        );
        if (!detail) {
          skipped++;
          continue;
        }
        const ms = Date.now() - t0;
        await writeContractDetailCache(addr, w as ContractWindowKey, detail, ms);
        ok++;
        console.log(`  ${addr} ${w.padEnd(4)} ok in ${ms}ms`);
      } catch (err) {
        // A contract too heavy even for the batch timeout is not fatal.
        // Leave whatever is already cached in place and move on: a stale
        // payload beats an empty one, and the next run tries again.
        skipped++;
        console.warn(`  ${addr} ${w.padEnd(4)} skipped: ${(err as Error).message}`);
      }
    }
  }

  console.log(
    `[details] ${ok} written · ${skipped} skipped · ${Math.round((Date.now() - started) / 1000)}s` +
      (ranOutOfBudget ? " · STOPPED ON BUDGET" : ""),
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("[details] fatal:", err);
    await closePool();
    process.exit(1);
  });
