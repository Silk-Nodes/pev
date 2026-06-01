#!/usr/bin/env tsx
/**
 * scripts/contract-daily.ts
 *
 * Per-day stats for one or more contracts over a date range. Useful for
 * spotting step-functions, ramp-downs, or anything that doesn't look like
 * smooth organic drift.
 *
 * For each (contract, day) we report:
 *   - blocks_appeared: distinct blocks where this contract had hot slots
 *   - conflicts:       total conflicts_caused that day
 *   - cpb:             conflicts / blocks (the per-block metric)
 *
 * Note: blocks_appeared here comes from block_hot_slots, so it's "blocks
 * where this contract had at least one hot slot," not "blocks where any
 * tx touched it." For high-traffic contracts these are usually identical;
 * for low-traffic contracts blocks_appeared can undercount. Good enough
 * for spotting week-over-week or day-over-day movement.
 *
 * Usage:
 *   npm run contract-daily -- <address> [<address> ...] [--days=20]
 *
 * Example: investigate FastLane's May dip
 *   npm run contract-daily -- 0xd32edf6642d917dbbe7b8bf8e5d6f5df6a9fff58 --days=20
 *
 * Example: compare two contracts side by side
 *   npm run contract-daily -- 0xd32edf66... 0x065c9d28... --days=18
 */

import { closePool, query } from "../src/lib/db";

interface CliArgs {
  contracts: string[];
  days: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const contracts: string[] = [];
  let days = 21;

  for (const a of args) {
    const m = a.match(/^--days(?:=(.+))?$/);
    if (m) {
      const n = parseInt(m[1] ?? "", 10);
      if (Number.isFinite(n)) days = n;
      continue;
    }
    if (a.startsWith("0x") && /^0x[0-9a-fA-F]{40}$/.test(a)) {
      contracts.push(a.toLowerCase());
    }
  }

  if (contracts.length === 0) {
    console.error("Error: at least one 0x-address required.");
    console.error("Usage: npm run contract-daily -- <address> [<address> ...] [--days=N]");
    process.exit(2);
  }
  return { contracts, days };
}

async function fetchLabel(addressHex: string): Promise<string> {
  const buf = Buffer.from(addressHex.replace(/^0x/, ""), "hex");
  const { rows } = await query<{ name: string | null }>(
    "SELECT name FROM contract_labels WHERE address = $1",
    [buf],
  );
  return rows[0]?.name ?? `0x${addressHex.replace(/^0x/, "").slice(0, 8)}…`;
}

async function fetchDaily(addressHex: string, days: number) {
  const buf = Buffer.from(addressHex.replace(/^0x/, ""), "hex");
  // Use the (contract, block_number DESC) index. Filter by contract
  // first, then join blocks for the date. With contract pinned, this
  // visits a tiny slice of block_hot_slots and the join is cheap.
  // Cast day to text so pg's Date parser doesn't bite us.
  const sql = `
    SELECT
      to_char(DATE(b.timestamp), 'YYYY-MM-DD') AS day,
      COUNT(DISTINCT bhs.block_number)::text AS blocks_appeared,
      SUM(bhs.conflicts_caused)::text AS conflicts,
      SUM(bhs.touches)::text AS touches
    FROM block_hot_slots bhs
    JOIN blocks b ON b.number = bhs.block_number
    WHERE bhs.contract = $1
      AND b.timestamp >= NOW() - ($2 || ' days')::interval
    GROUP BY DATE(b.timestamp)
    ORDER BY DATE(b.timestamp)
  `;
  const { rows } = await query<{
    day: string;
    blocks_appeared: string;
    conflicts: string;
    touches: string;
  }>(sql, [buf, days]);
  return rows;
}

async function main() {
  const { contracts, days } = parseArgs();
  process.stderr.write(`Pulling daily stats for ${contracts.length} contract(s), last ${days} days...\n\n`);

  for (const addr of contracts) {
    const label = await fetchLabel(addr);
    const rows = await fetchDaily(addr, days);

    console.log(`### ${label}`);
    console.log(`    ${addr}`);
    console.log("");

    if (rows.length === 0) {
      console.log("    (no data in window)");
      console.log("");
      continue;
    }

    // Header. Right-aligned numeric columns.
    console.log(
      "    " +
        "day".padEnd(12) +
        "blocks".padStart(10) +
        "conflicts".padStart(12) +
        "touches".padStart(12) +
        "cpb".padStart(8) +
        "  bar (conflicts)",
    );
    const maxConf = Math.max(...rows.map((r) => Number(r.conflicts)));
    for (const r of rows) {
      const blocks = Number(r.blocks_appeared);
      const conflicts = Number(r.conflicts);
      const touches = Number(r.touches);
      const cpb = blocks > 0 ? conflicts / blocks : 0;
      const barLen = maxConf > 0 ? Math.round((conflicts / maxConf) * 40) : 0;
      const bar = "█".repeat(barLen);
      console.log(
        "    " +
          r.day.padEnd(12) +
          blocks.toLocaleString().padStart(10) +
          conflicts.toLocaleString().padStart(12) +
          touches.toLocaleString().padStart(12) +
          cpb.toFixed(2).padStart(8) +
          "  " + bar,
      );
    }
    console.log("");
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => closePool());
