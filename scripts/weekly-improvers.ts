#!/usr/bin/env tsx
/**
 * scripts/weekly-improvers.ts
 *
 * Compare two N-day windows of conflicts-per-block, ranked by the
 * biggest movers. Lets us pull "X improved by Y% week-over-week"
 * insights for blog posts / X shares / the /analytics page.
 *
 * Default windows compare two FULL completed weeks (offset=7d), so
 * the most recent window doesn't include a partial current week
 * that would skew the comparison:
 *
 *   recent_window = 14 to 7 days ago
 *   prior_window  = 21 to 14 days ago
 *
 * To compare "current rolling week vs prior" (what we did originally
 * for the Perpl card), pass --offset=0:
 *
 *   recent_window = 7 to 0 days ago      (current rolling week)
 *   prior_window  = 14 to 7 days ago
 *
 * Usage:
 *   npm run weekly-improvers                       # default: two full weeks
 *   npm run weekly-improvers -- --offset=0         # rolling current week
 *   npm run weekly-improvers -- --window=14        # 2-week windows
 *   npm run weekly-improvers -- --top=20           # show top 20 by total
 *   npm run weekly-improvers -- --min-cpb=3        # filter noise
 *
 * Output: a single psql-style table sorted by pct_change ascending
 * (biggest improvers first; negative pct_change = fewer conflicts).
 */

import { closePool, query } from "../src/lib/db";

interface CliArgs {
  windowDays: number;
  offsetDays: number;
  top: number;
  minCpb: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let windowDays = 7;
  let offsetDays = 7;
  let top = 10;
  let minCpb = 2;

  for (const a of args) {
    const m = a.match(/^--(window|offset|top|min-cpb)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val] = m;
    const n = parseFloat(val ?? "");
    if (!Number.isFinite(n)) continue;
    if (key === "window") windowDays = n;
    else if (key === "offset") offsetDays = n;
    else if (key === "top") top = Math.round(n);
    else if (key === "min-cpb") minCpb = n;
  }

  return { windowDays, offsetDays, top, minCpb };
}

async function main() {
  const { windowDays, offsetDays, top, minCpb } = parseArgs();

  // Anchor at NOW so the windows shift consistently regardless of
  // when this is run. Both windows use the same anchor.
  //
  //   recent: [offset + window, offset] days ago
  //   prior:  [offset + 2*window, offset + window] days ago
  //
  // Example (defaults: window=7, offset=7):
  //   recent: 14 to 7 days ago      (last completed week)
  //   prior:  21 to 14 days ago     (week before that)
  const recentStart = offsetDays + windowDays;
  const recentEnd = offsetDays;
  const priorStart = offsetDays + windowDays * 2;
  const priorEnd = offsetDays + windowDays;

  process.stderr.write(
    `Comparing recent window (${recentStart}d ago to ${recentEnd}d ago) ` +
      `vs prior (${priorStart}d ago to ${priorEnd}d ago), ` +
      `top ${top} by total conflicts, min ${minCpb} cpb.\n\n`,
  );

  // We tried pre-aggregating via contract_stats_daily, but that table
  // is empty in prod (the daily upsert pipeline isn't wired up yet).
  // So we go to source: block_hot_slots, filtered by block_number range.
  //
  // To stay under the PG statement_timeout we query each window
  // independently (just 7d of data each) and merge in TypeScript. The
  // combined query timed out at ~3 minutes; per-window finishes in
  // under a minute.
  //
  // First resolve the block_number bounds for each window. Cheap.
  const boundsSql = `
    SELECT
      MIN(number) FILTER (
        WHERE timestamp >= NOW() - ($1 || ' days')::interval
          AND timestamp <  NOW() - ($2 || ' days')::interval
      ) AS recent_min,
      MAX(number) FILTER (
        WHERE timestamp >= NOW() - ($1 || ' days')::interval
          AND timestamp <  NOW() - ($2 || ' days')::interval
      ) AS recent_max,
      MIN(number) FILTER (
        WHERE timestamp >= NOW() - ($3 || ' days')::interval
          AND timestamp <  NOW() - ($4 || ' days')::interval
      ) AS prior_min,
      MAX(number) FILTER (
        WHERE timestamp >= NOW() - ($3 || ' days')::interval
          AND timestamp <  NOW() - ($4 || ' days')::interval
      ) AS prior_max
    FROM blocks
    WHERE timestamp >= NOW() - ($3 || ' days')::interval
      AND timestamp <  NOW() - ($2 || ' days')::interval
  `;
  const boundsRes = await query<{
    recent_min: string | null;
    recent_max: string | null;
    prior_min: string | null;
    prior_max: string | null;
  }>(boundsSql, [recentStart, recentEnd, priorStart, priorEnd]);
  const b = boundsRes.rows[0];
  if (!b || !b.recent_min || !b.recent_max || !b.prior_min || !b.prior_max) {
    console.error("No blocks in one or both windows. Indexer may be lagging.");
    return;
  }
  const recentMin = b.recent_min;
  const recentMax = b.recent_max;
  const priorMin = b.prior_min;
  const priorMax = b.prior_max;
  process.stderr.write(
    `  recent blocks: ${recentMin} to ${recentMax}\n`,
  );
  process.stderr.write(
    `  prior  blocks: ${priorMin} to ${priorMax}\n\n`,
  );

  // Aggregate one window at a time. Returns one row per contract with
  // total conflicts + distinct block count.
  type WindowRow = { contract: Buffer; conf: string; blocks: string };
  const windowSql = `
    SELECT
      contract,
      SUM(conflicts_caused)::text AS conf,
      COUNT(DISTINCT block_number)::text AS blocks
    FROM block_hot_slots
    WHERE block_number BETWEEN $1 AND $2
    GROUP BY contract
    HAVING SUM(conflicts_caused) > 0
  `;

  process.stderr.write("  querying recent window…");
  const t1 = Date.now();
  const recentRes = await query<WindowRow>(windowSql, [recentMin, recentMax]);
  process.stderr.write(` ${recentRes.rows.length} contracts, ${Date.now() - t1} ms\n`);

  process.stderr.write("  querying prior window…");
  const t2 = Date.now();
  const priorRes = await query<WindowRow>(windowSql, [priorMin, priorMax]);
  process.stderr.write(` ${priorRes.rows.length} contracts, ${Date.now() - t2} ms\n\n`);

  // Merge per-contract. Key by hex address (Buffer→hex).
  type Merged = {
    contract: string;
    recent_conf: number;
    prior_conf: number;
    recent_blocks: number;
    prior_blocks: number;
  };
  const merged = new Map<string, Merged>();
  const getOrInit = (key: string): Merged => {
    let m = merged.get(key);
    if (!m) {
      m = { contract: key, recent_conf: 0, prior_conf: 0, recent_blocks: 0, prior_blocks: 0 };
      merged.set(key, m);
    }
    return m;
  };
  for (const r of recentRes.rows) {
    const key = r.contract.toString("hex");
    const m = getOrInit(key);
    m.recent_conf = Number(r.conf);
    m.recent_blocks = Number(r.blocks);
  }
  for (const r of priorRes.rows) {
    const key = r.contract.toString("hex");
    const m = getOrInit(key);
    m.prior_conf = Number(r.conf);
    m.prior_blocks = Number(r.blocks);
  }

  // Compute cpb, pct change, filter, sort by total conflicts desc.
  type Scored = Merged & { recent_cpb: number; prior_cpb: number; pct_change: number; total: number };
  const scored: Scored[] = [];
  for (const m of merged.values()) {
    if (m.recent_blocks === 0 || m.prior_blocks === 0) continue;
    const recent_cpb = m.recent_conf / m.recent_blocks;
    const prior_cpb = m.prior_conf / m.prior_blocks;
    if (recent_cpb < minCpb && prior_cpb < minCpb) continue;
    const pct = prior_cpb === 0 ? 0 : 100 * (recent_cpb - prior_cpb) / prior_cpb;
    scored.push({
      ...m,
      recent_cpb,
      prior_cpb,
      pct_change: pct,
      total: m.recent_conf + m.prior_conf,
    });
  }
  scored.sort((a, b) => b.total - a.total);
  const topRows = scored.slice(0, top);

  // Resolve labels in one shot.
  const addrs = topRows.map((r) => Buffer.from(r.contract, "hex"));
  const labelRes = await query<{ address: Buffer; name: string }>(
    "SELECT address, name FROM contract_labels WHERE address = ANY($1::bytea[]) AND name IS NOT NULL",
    [addrs],
  );
  const labelMap = new Map<string, string>();
  for (const r of labelRes.rows) labelMap.set(r.address.toString("hex"), r.name);

  const rows = topRows.map((r) => ({
    label: labelMap.get(r.contract) ?? `0x${r.contract}`,
    prior_conf: String(r.prior_conf),
    recent_conf: String(r.recent_conf),
    prior_cpb: r.prior_cpb.toFixed(1),
    recent_cpb: r.recent_cpb.toFixed(1),
    pct_change: r.pct_change.toFixed(1),
  }));

  // Pretty-print: same column shape as the original output so we can
  // eyeball-compare with bz89iqecb.output without re-formatting.
  const cols = ["contract", "prior_week_conflicts", "recent_week_conflicts", "prior_cpb", "recent_cpb", "pct_change"];
  const data = rows.map((r) => [
    r.label,
    r.prior_conf,
    r.recent_conf,
    r.prior_cpb,
    r.recent_cpb,
    r.pct_change,
  ]);
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...data.map((row) => String(row[i] ?? "").length)),
  );
  const pad = (v: string, w: number, right = true) =>
    right ? v.padStart(w) : v.padEnd(w);

  // Header (first column left-aligned, the rest right-aligned)
  console.log(
    " " + pad(cols[0], widths[0], false) +
      cols.slice(1).map((c, i) => " | " + pad(c, widths[i + 1])).join(""),
  );
  console.log(
    "-".repeat(widths[0] + 2) +
      widths.slice(1).map((w) => "+" + "-".repeat(w + 2)).join(""),
  );
  for (const row of data) {
    console.log(
      " " + pad(String(row[0]), widths[0], false) +
        row.slice(1).map((v, i) => " | " + pad(String(v), widths[i + 1])).join(""),
    );
  }
  console.log(`(${rows.length} rows)`);

  // Sort the same data by pct_change ASC (biggest improvers first)
  // and re-print, since that's what the user actually wants to scan.
  console.log("");
  console.log("Same rows, sorted by pct_change ascending (biggest improvers first):");
  console.log("");
  const sorted = [...rows].sort((a, b) => parseFloat(a.pct_change) - parseFloat(b.pct_change));
  for (const r of sorted) {
    const sign = parseFloat(r.pct_change) <= 0 ? "" : "+";
    console.log(
      `  ${sign}${r.pct_change.padStart(5)}%   ${r.label.padEnd(45)}  ` +
        `${r.prior_conf.padStart(8)} -> ${r.recent_conf.padStart(8)}  ` +
        `(cpb ${r.prior_cpb} -> ${r.recent_cpb})`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
