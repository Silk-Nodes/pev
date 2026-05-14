#!/usr/bin/env tsx
/**
 * refresh-analytics.ts, recompute the /analytics page payload and
 * upsert it into the analytics_cache table.
 *
 * Run periodically by a systemd timer (every 5 minutes). The web page
 * just reads the cache row, ~5ms; the slow aggregates run here in the
 * background where there is no edge timeout to worry about.
 *
 * Usage:
 *   npm run analytics:refresh
 *
 * Exit codes:
 *   0   success, cache row updated
 *   1   computation failed (DB unreachable, query error, etc.)
 *   2   computation succeeded but the payload was empty (no indexed
 *       blocks at all; cache is left untouched)
 *
 * Operationally: a failed refresh is non-fatal. The page keeps serving
 * the previous cached payload (possibly stale). The systemd timer's
 * `OnFailure` could send an alert, but for now we just log + exit.
 */

import { closePool } from "../src/lib/db";
import { getAnalyticsData, writeAnalyticsCache } from "../src/lib/indexer/store";

const WINDOW_DAYS = 7;

async function main(): Promise<number> {
  const startedAt = Date.now();
  console.log(
    `[analytics-refresh] starting at ${new Date().toISOString()}, window=${WINDOW_DAYS}d`,
  );

  const data = await getAnalyticsData(WINDOW_DAYS);
  const elapsedMs = Date.now() - startedAt;

  if (!data) {
    console.warn(
      `[analytics-refresh] no data (window empty?), leaving cache untouched`,
    );
    return 2;
  }

  await writeAnalyticsCache(data, elapsedMs);
  console.log(
    `[analytics-refresh] cache updated in ${elapsedMs}ms · ` +
      `${data.totals.blocks.toLocaleString()} blocks, ` +
      `${data.killers.length} killers, ` +
      `${data.hotSlots.length} hot slots, ` +
      `${data.methods.length} methods`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[analytics-refresh] fatal: ${(err as Error).message}`);
    console.error((err as Error).stack);
    await closePool();
    process.exit(1);
  });
