/**
 * Rolling retention. pev keeps the last RETENTION_DAYS of full block data
 * and nothing older, apart from one summary row per day (daily_summary).
 *
 * The three big tables (tx_executions, conflicts, block_hot_slots) are
 * range-partitioned on block_number, one partition per PARTITION_BLOCKS
 * (a little over a day). Retention is then two cheap catalog operations:
 *
 *   - create the partitions the chain head is about to write into
 *   - DROP partitions that sit entirely below the cutoff
 *
 * Dropping a partition returns its disk space at once and writes no WAL
 * for the rows, unlike a DELETE. The small tables (blocks and the
 * per-contract daily aggregates) are pruned with bounded DELETEs.
 *
 * Until scripts/retention-cutover.ts has converted the big tables to
 * partitioned ones, everything here is a no-op: nothing is pruned from a
 * database that has not been cut over.
 */

import { query, queryOne, queryRows } from "@/lib/db";

function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (!raw) return dflt;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[retention] ${name} is not a positive integer, using ${dflt}`);
    return dflt;
  }
  return n;
}

export const RETENTION_DAYS = envInt("PEV_RETENTION_DAYS", 7);
/** Monad produces a block every 0.4s. */
export const BLOCKS_PER_DAY = 216_000;
export const RETENTION_BLOCKS = RETENTION_DAYS * BLOCKS_PER_DAY;
/** Width of one partition, in blocks. 250k is about 28 hours. */
export const PARTITION_BLOCKS = 250_000;
/** How many partitions to keep ready ahead of the chain head. */
const PARTITIONS_AHEAD = 3;
const BLOCK_DELETE_BATCH = 20_000;

export const PARTITIONED_TABLES = ["tx_executions", "conflicts", "block_hot_slots"] as const;
export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];

export interface PartitionInfo {
  name: string;
  from: number;
  to: number;
}

export function partitionStart(block: number): number {
  return Math.floor(block / PARTITION_BLOCKS) * PARTITION_BLOCKS;
}

export function partitionName(table: string, from: number): string {
  return `${table}_p${from}`;
}

/** Lowest block the window still holds, given the newest indexed block. */
export function cutoffBlock(head: number): number {
  return Math.max(0, head - RETENTION_BLOCKS);
}

export async function isPartitioned(table: string): Promise<boolean> {
  const row = await queryOne<{ relkind: string }>(
    `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = $1`,
    [table],
  );
  return row?.relkind === "p";
}

/** True once every big table has been converted by the cutover script. */
export async function retentionActive(): Promise<boolean> {
  for (const t of PARTITIONED_TABLES) {
    if (!(await isPartitioned(t))) return false;
  }
  return true;
}

export async function listPartitions(table: string): Promise<PartitionInfo[]> {
  const rows = await queryRows<{ name: string; bound: string }>(
    `SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = current_schema() AND p.relname = $1`,
    [table],
  );
  const out: PartitionInfo[] = [];
  for (const r of rows) {
    const m = /FROM \('?(\d+)'?\) TO \('?(\d+)'?\)/.exec(r.bound);
    if (m) out.push({ name: r.name, from: parseInt(m[1], 10), to: parseInt(m[2], 10) });
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Create every missing partition of `parent` between the partition that
 * holds `fromBlock` and PARTITIONS_AHEAD partitions past `head`. `nameAs`
 * lets the cutover script build partitions for a table that will be
 * renamed to its final name later.
 */
export async function ensurePartitions(
  parent: string,
  fromBlock: number,
  head: number,
  nameAs: string = parent,
): Promise<string[]> {
  const have = new Set((await listPartitions(parent)).map((p) => p.from));
  const created: string[] = [];
  const last = partitionStart(head) + PARTITIONS_AHEAD * PARTITION_BLOCKS;
  for (let from = partitionStart(fromBlock); from <= last; from += PARTITION_BLOCKS) {
    if (have.has(from)) continue;
    const name = partitionName(nameAs, from);
    // Identifiers are built from our own constants and integers, never
    // from user input.
    await query(
      `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${parent}"
         FOR VALUES FROM (${from}) TO (${from + PARTITION_BLOCKS})`,
    );
    created.push(name);
  }
  return created;
}

/** Drop partitions whose whole range is below the cutoff. */
export async function dropExpiredPartitions(table: string, cutoff: number): Promise<string[]> {
  const dropped: string[] = [];
  for (const p of await listPartitions(table)) {
    if (p.to > cutoff) continue;
    await query(`DROP TABLE IF EXISTS "${p.name}"`);
    dropped.push(p.name);
  }
  return dropped;
}

/** The lowest block any big table can currently store, or null before cutover. */
export async function lowestWritableBlock(): Promise<number | null> {
  let lowest: number | null = null;
  for (const t of PARTITIONED_TABLES) {
    if (!(await isPartitioned(t))) return null;
    const parts = await listPartitions(t);
    if (parts.length === 0) return null;
    lowest = lowest === null ? parts[0].from : Math.max(lowest, parts[0].from);
  }
  return lowest;
}

/**
 * Rewrite daily_summary for every day that still has blocks at or after
 * `fromBlock`. Days are UTC. Run before blocks are pruned, so the day a
 * prune cuts into was summarised while it was still whole.
 */
export async function rollDailySummary(fromBlock: number, toBlock?: number): Promise<number> {
  const res = await query(
    `INSERT INTO daily_summary AS d
            (day, blocks, first_block, last_block, txs, stateful_txs, conflicts, hot_slots,
             avg_parallelism_score, avg_blocked_pct, avg_execution_depth, gas_used, gas_limit, updated_at)
     SELECT (timestamp AT TIME ZONE 'UTC')::date, count(*)::int, min(number), max(number),
            sum(tx_count)::bigint, sum(stateful_count)::bigint, sum(conflict_count)::bigint,
            sum(hot_slot_count)::bigint, avg(parallelism_score)::real, avg(blocked_pct)::real,
            avg(execution_depth)::real, sum(gas_used), sum(gas_limit), now()
       FROM blocks
      WHERE number >= $1 AND ($2::bigint IS NULL OR number <= $2)
      GROUP BY 1
     ON CONFLICT (day) DO UPDATE SET
            blocks = EXCLUDED.blocks, first_block = EXCLUDED.first_block, last_block = EXCLUDED.last_block,
            txs = EXCLUDED.txs, stateful_txs = EXCLUDED.stateful_txs, conflicts = EXCLUDED.conflicts,
            hot_slots = EXCLUDED.hot_slots, avg_parallelism_score = EXCLUDED.avg_parallelism_score,
            avg_blocked_pct = EXCLUDED.avg_blocked_pct, avg_execution_depth = EXCLUDED.avg_execution_depth,
            gas_used = EXCLUDED.gas_used, gas_limit = EXCLUDED.gas_limit, updated_at = now()
      -- a day that has already lost blocks to pruning keeps its fuller, earlier row
      WHERE EXCLUDED.blocks >= d.blocks`,
    [fromBlock, toBlock ?? null],
  );
  return res.rowCount ?? 0;
}

/** Delete blocks below the cutoff, a bounded batch at a time. */
export async function pruneBlocks(cutoff: number, maxBatches = 50): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await query(
      `DELETE FROM blocks WHERE number IN (
         SELECT number FROM blocks WHERE number < $1 ORDER BY number LIMIT $2)`,
      [cutoff, BLOCK_DELETE_BATCH],
    );
    const n = res.rowCount ?? 0;
    total += n;
    if (n < BLOCK_DELETE_BATCH) break;
  }
  return total;
}

/** Prune the small per-contract aggregates to the same window. */
export async function pruneAggregates(cutoff: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const run = async (label: string, sql: string, params: unknown[]) => {
    try {
      out[label] = (await query(sql, params)).rowCount ?? 0;
    } catch (err) {
      console.warn(`[retention] ${label} prune skipped: ${(err as Error).message}`);
    }
  };
  const days = `${RETENTION_DAYS} days`;
  await run("contract_pair_daily", `DELETE FROM contract_pair_daily WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::interval`, [days]);
  // Per-contract daily rollups are small and the week-over-week reports
  // (weekly improvers, movers) need two full weeks, so they get 35 days.
  await run("contract_stats_daily", `DELETE FROM contract_stats_daily WHERE day < (now() AT TIME ZONE 'UTC')::date - interval '35 days'`, []);
  await run("contract_index", `DELETE FROM contract_index WHERE last_block < $1`, [cutoff]);
  return out;
}

export interface RetentionReport {
  active: boolean;
  head: number;
  cutoff: number;
  created: string[];
  dropped: string[];
  summaryDays: number;
  blocksDeleted: number;
  aggregates: Record<string, number>;
}

/**
 * One retention pass. Safe to run at any time and from more than one
 * process: every step is idempotent.
 */
export async function runRetention(): Promise<RetentionReport> {
  const report: RetentionReport = {
    active: false, head: 0, cutoff: 0, created: [], dropped: [], summaryDays: 0, blocksDeleted: 0, aggregates: {},
  };
  const cur = await queryOne<{ b: string }>(
    "SELECT last_indexed_block::text AS b FROM indexer_cursor WHERE id = 1",
  );
  const head = cur ? parseInt(cur.b, 10) : 0;
  report.head = head;
  if (head <= 0) return report;
  report.cutoff = cutoffBlock(head);

  report.active = await retentionActive();
  if (!report.active) return report;

  // Partitions first: a missing partition makes block writes fail.
  for (const t of PARTITIONED_TABLES) {
    report.created.push(...(await ensurePartitions(t, head, head)));
  }
  for (const t of PARTITIONED_TABLES) {
    report.dropped.push(...(await dropExpiredPartitions(t, report.cutoff)));
  }
  // Summarise the last two days and everything about to be pruned, then prune.
  const oldest = await queryOne<{ n: string | null }>("SELECT min(number)::text AS n FROM blocks");
  const lo = oldest?.n ? parseInt(oldest.n, 10) : head;
  if (lo < report.cutoff) report.summaryDays += await rollDailySummary(lo, report.cutoff + BLOCKS_PER_DAY);
  report.summaryDays += await rollDailySummary(Math.max(0, head - 2 * BLOCKS_PER_DAY));
  report.blocksDeleted = await pruneBlocks(report.cutoff);
  report.aggregates = await pruneAggregates(report.cutoff);
  return report;
}

/**
 * Run retention now and then every `everyMs`, until the signal aborts.
 * A failed pass is logged with its cause and retried on the next tick;
 * it never takes the indexer down.
 */
export function startRetentionLoop(signal: AbortSignal, everyMs = 15 * 60_000): void {
  let warnedInactive = false;
  const tick = async () => {
    if (signal.aborted) return;
    try {
      const r = await runRetention();
      if (!r.active) {
        if (!warnedInactive && r.head > 0) {
          console.warn(
            "[retention] INACTIVE: the big tables are not partitioned yet, so nothing is being pruned. " +
              "Run scripts/retention-cutover.ts to convert them.",
          );
          warnedInactive = true;
        }
        return;
      }
      if (r.created.length || r.dropped.length || r.blocksDeleted) {
        console.log(
          `[retention] head ${r.head.toLocaleString()} · cutoff ${r.cutoff.toLocaleString()} · ` +
            `created ${r.created.length} · dropped ${r.dropped.length} partitions` +
            (r.dropped.length ? ` (${r.dropped.join(", ")})` : "") +
            ` · blocks deleted ${r.blocksDeleted.toLocaleString()}`,
        );
      }
    } catch (err) {
      console.error("[retention] pass FAILED, will retry:", (err as Error).message);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });
}
