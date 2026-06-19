#!/usr/bin/env tsx
/**
 * contract-audit.ts, build the per-contract contention audit and cache it.
 *
 * GENTLE by design (post 2026-06-18 meltdown): each aggregate is bounded
 * by a server-side statement_timeout and runs sequentially on its own
 * connection, so it can never pile up load on the shared indexer DB. Run
 * it off-peak; if a query is too heavy it's skipped and the report is
 * marked partial rather than hanging.
 *
 * Usage:
 *   npm run audit:contract -- 0x34b6552d57a35a1d042ccae1951bd1c370112a6f
 *   npm run audit:contract -- 0x34b6… --window=7 --timeout=25000
 *
 * Exit codes: 0 ok, 1 bad args / fatal.
 */

import { closePool } from "../src/lib/db";
import { refreshContractAudit, writeContractAudit } from "../src/lib/indexer/store";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main(): Promise<number> {
  const address = process.argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  if (!address) {
    console.error("usage: npm run audit:contract -- 0x<40-hex-address> [--window=7] [--timeout=25000]");
    return 1;
  }
  const windowDays = Number(arg("window")) || 2;
  const timeoutMs = Number(arg("timeout")) || 35_000;

  console.log(
    `[audit] building for ${address} · window=${windowDays}d · per-query timeout=${timeoutMs}ms`,
  );
  const started = Date.now();
  const audit = await refreshContractAudit(address, { windowDays, timeoutMs });
  await writeContractAudit(audit);

  console.log(
    `[audit] done in ${Date.now() - started}ms · ` +
      `label=${audit.label ?? "(none)"} · ` +
      `txs=${audit.totals.txs ?? "?"} conflicts=${audit.totals.conflicts ?? "?"} ` +
      `rate=${audit.totals.conflictRate != null ? Math.round(audit.totals.conflictRate * 100) + "%" : "?"} · ` +
      `slots=${audit.hotSlots.length} methods=${audit.methods.length} kinds=${audit.kinds.length} ` +
      `${audit.partial ? "· PARTIAL (a query was skipped)" : ""}`,
  );
  if (audit.hotSlots[0]) {
    console.log(
      `[audit] hottest slot ${audit.hotSlots[0].slot} · ${audit.hotSlots[0].conflicts.toLocaleString()} collisions`,
    );
  }
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[audit] fatal: ${(err as Error).message}`);
    await closePool();
    process.exit(1);
  });
