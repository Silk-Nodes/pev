#!/usr/bin/env tsx
/**
 * retention-cutover.ts, the one-time move from "keep everything" to a
 * rolling window (see src/lib/indexer/retention.ts).
 *
 * The big tables hold hundreds of GB of which the window keeps a few
 * percent, so rows are not deleted. The window is copied into new
 * partitioned tables, the names are swapped, and the old tables are
 * dropped, which hands their disk space straight back.
 *
 * Steps, each its own invocation so a human decides when to go on:
 *
 *   --plan      (default) read-only: sizes, cutoff, what each step will do
 *   --summary   fill daily_summary from the whole blocks table, a day at a time
 *   --copy      build the new tables and copy the window. Safe while the
 *               indexer runs; resumable; run again to catch up
 *   --swap      INDEXER MUST BE STOPPED. Re-copies the recent tail, then
 *               renames old -> *_old and new -> live in one transaction
 *   --drop-old  IRREVERSIBLE. Drops the *_old tables. Needs --yes
 *
 * Until --drop-old, undo is a rename back.
 */

import { closePool, query, queryOne, queryRows, withTransaction } from "../src/lib/db";
import {
  BLOCKS_PER_DAY,
  PARTITIONED_TABLES,
  RETENTION_DAYS,
  cutoffBlock,
  ensurePartitions,
  isPartitioned,
  listPartitions,
  rollDailySummary,
} from "../src/lib/indexer/retention";

const NEW = (t: string) => `${t}_new`;
const OLD = (t: string) => `${t}_old`;
const COPY_CHUNK = 5_000; // blocks per INSERT ... SELECT
const TAIL_RECOPY = 60_000; // blocks re-copied at swap: the indexer can fill blocks out of order
const PAUSE_MS = Number(process.env.PEV_CUTOVER_PAUSE_MS ?? 150); // breathing room between chunks so the live indexer keeps its IO
const has = (flag: string) => process.argv.includes(flag);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toLocaleString("en-US");

async function exists(table: string): Promise<boolean> {
  const r = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = current_schema() AND c.relname = $1 AND c.relkind IN ('r','p')) AS ok`,
    [table],
  );
  return r?.ok ?? false;
}

async function size(table: string): Promise<string> {
  // For a partitioned parent pg_total_relation_size is 0, so add the children.
  const r = await queryOne<{ s: string }>(
    `SELECT pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)), 0)) AS s
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND (c.relname = $1 OR c.oid IN (SELECT inhrelid FROM pg_inherits WHERE inhparent = to_regclass($1)))`,
    [table],
  );
  return r?.s ?? "?";
}

async function bounds(table: string): Promise<{ lo: number; hi: number } | null> {
  const col = table.startsWith("blocks") ? "number" : "block_number";
  const r = await queryOne<{ lo: string | null; hi: string | null }>(
    `SELECT min(${col})::text AS lo, max(${col})::text AS hi FROM "${table}"`,
  );
  return r?.lo && r?.hi ? { lo: parseInt(r.lo, 10), hi: parseInt(r.hi, 10) } : null;
}

async function cursor(): Promise<number> {
  const r = await queryOne<{ b: string }>("SELECT last_indexed_block::text AS b FROM indexer_cursor WHERE id = 1");
  return r ? parseInt(r.b, 10) : 0;
}

/** The window's lower edge, fixed for the whole cutover once copying starts. */
async function windowStart(): Promise<number> {
  for (const t of PARTITIONED_TABLES) {
    if (await exists(NEW(t))) {
      const parts = await listPartitions(NEW(t));
      if (parts.length) return parts[0].from;
    }
  }
  const c = await cutoffBlock();
  if (c <= 0) throw new Error(`no indexed block in the last ${RETENTION_DAYS} days, refusing to pick a window`);
  return c;
}

async function primaryKeyDef(table: string): Promise<string> {
  const r = await queryOne<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass($1) AND contype = 'p'`,
    [table],
  );
  if (!r) throw new Error(`${table} has no primary key`);
  return r.def;
}

async function secondaryIndexes(table: string): Promise<{ name: string; def: string }[]> {
  return queryRows<{ name: string; def: string }>(
    `SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS def
       FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = to_regclass($1) AND NOT x.indisprimary`,
    [table],
  );
}

// ─── plan ─────────────────────────────────────────────────────────

async function plan(): Promise<void> {
  const head = await cursor();
  const start = await windowStart();
  console.log(`retention window: ${RETENTION_DAYS} days, cut by block timestamp`);
  console.log(`newest indexed block: ${fmt(head)} · window starts at block ${fmt(start)}`);
  const db = await queryOne<{ s: string }>("SELECT pg_size_pretty(pg_database_size(current_database())) AS s");
  console.log(`database size: ${db?.s}`);
  for (const t of [...PARTITIONED_TABLES, "blocks"]) {
    const b = await bounds(t);
    const part = t === "blocks" ? false : await isPartitioned(t);
    const line = [`${t}: ${await size(t)}`, b ? `blocks ${fmt(b.lo)} to ${fmt(b.hi)}` : "empty", part ? "ALREADY PARTITIONED" : ""];
    if (await exists(NEW(t))) {
      const nb = await bounds(NEW(t));
      line.push(`| ${NEW(t)}: ${await size(NEW(t))}${nb ? `, copied to block ${fmt(nb.hi)}` : ", empty"}`);
    }
    if (await exists(OLD(t))) line.push(`| ${OLD(t)}: ${await size(OLD(t))} waiting for --drop-old`);
    console.log("  " + line.filter(Boolean).join(" · "));
  }
  const days = await queryOne<{ n: string; lo: string | null; hi: string | null }>(
    "SELECT count(*)::text AS n, min(day)::text AS lo, max(day)::text AS hi FROM daily_summary",
  ).catch(() => null);
  console.log(days ? `daily_summary: ${days.n} days (${days.lo ?? "-"} to ${days.hi ?? "-"})` : "daily_summary: table missing, run db:migrate");
  const acl = await queryRows<{ t: string; owner: string; acl: string | null }>(
    `SELECT c.relname AS t, pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = ANY($1)`, [[...PARTITIONED_TABLES, "blocks"]]);
  for (const r of acl) if (r.acl) console.log(`  WARNING ${r.t} has explicit grants (${r.acl}); the new table will need the same`);
  const deps = await queryRows<{ v: string; t: string }>(
    `SELECT DISTINCT v.relname AS v, t.relname AS t FROM pg_depend d
       JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
       JOIN pg_class t ON t.oid = d.refobjid
      WHERE t.relname = ANY($1) AND v.relname <> t.relname`, [[...PARTITIONED_TABLES, "blocks"]]);
  for (const r of deps) console.log(`  WARNING view ${r.v} reads ${r.t} and would keep pointing at the old table after the swap`);
  const trg = await queryRows<{ t: string; n: string }>(
    `SELECT c.relname AS t, tg.tgname AS n FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      WHERE NOT tg.tgisinternal AND c.relname = ANY($1)`, [[...PARTITIONED_TABLES, "blocks"]]);
  for (const r of trg) console.log(`  WARNING trigger ${r.n} on ${r.t} is not carried to the new table`);
  console.log("\nnext: --summary, then --copy (indexer may run), stop the indexer, --swap, start it, check the site, --drop-old --yes");
}

// ─── summary ──────────────────────────────────────────────────────

async function summary(): Promise<void> {
  const b = await bounds("blocks");
  if (!b) throw new Error("blocks is empty");
  console.log(`[summary] blocks ${fmt(b.lo)} to ${fmt(b.hi)}, one day of blocks per query`);
  let days = 0;
  // Slices overlap by a day's worth of blocks on purpose: a UTC day that
  // straddles two slices is only ever kept in its fullest form.
  for (let lo = b.lo; lo <= b.hi; lo += BLOCKS_PER_DAY) {
    days += await rollDailySummary(Math.max(b.lo, lo - BLOCKS_PER_DAY), lo + 2 * BLOCKS_PER_DAY);
    if (((lo - b.lo) / BLOCKS_PER_DAY) % 20 === 0) console.log(`[summary] at block ${fmt(lo)}`);
    await sleep(PAUSE_MS);
  }
  const n = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM daily_summary");
  console.log(`[summary] done · ${n?.n} days in daily_summary (${fmt(days)} row writes)`);
}

// ─── copy ─────────────────────────────────────────────────────────

async function createNewTables(start: number, head: number): Promise<void> {
  for (const t of PARTITIONED_TABLES) {
    if (await isPartitioned(t)) throw new Error(`${t} is already partitioned, the cutover has been done`);
    if (!(await exists(NEW(t)))) {
      const pk = await primaryKeyDef(t);
      await query(`CREATE TABLE "${NEW(t)}" (LIKE "${t}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMPRESSION) PARTITION BY RANGE (block_number)`);
      await query(`ALTER TABLE "${NEW(t)}" ADD ${pk}`);
      console.log(`[copy] created ${NEW(t)} · ${pk}`);
    }
    // Partitions carry their final names (tx_executions_p123250000) from the start.
    const made = await ensurePartitions(NEW(t), start, head, t);
    if (made.length) console.log(`[copy] ${NEW(t)}: ${made.length} partitions created`);
  }
  if (!(await exists(NEW("blocks")))) {
    await query(`CREATE TABLE "${NEW("blocks")}" (LIKE blocks INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMPRESSION)`);
    await query(`ALTER TABLE "${NEW("blocks")}" ADD ${await primaryKeyDef("blocks")}`);
    console.log(`[copy] created ${NEW("blocks")}`);
  }
}

/** Copy [from, to] of one table in block-range chunks. */
async function copyRange(table: string, from: number, to: number, label: string): Promise<number> {
  const col = table === "blocks" ? "number" : "block_number";
  let rows = 0;
  let last = Date.now();
  for (let lo = from; lo <= to; lo += COPY_CHUNK) {
    const hi = Math.min(to, lo + COPY_CHUNK - 1);
    const res = await query(
      `INSERT INTO "${NEW(table)}" SELECT * FROM "${table}" WHERE ${col} BETWEEN $1 AND $2 ON CONFLICT DO NOTHING`,
      [lo, hi],
    );
    rows += res.rowCount ?? 0;
    if (Date.now() - last > 15_000) {
      console.log(`[${label}] ${table} at block ${fmt(hi)} of ${fmt(to)} · ${fmt(rows)} rows`);
      last = Date.now();
    }
    await sleep(PAUSE_MS);
  }
  return rows;
}

async function buildIndexes(): Promise<void> {
  for (const t of [...PARTITIONED_TABLES, "blocks"]) {
    const have = new Set((await secondaryIndexes(NEW(t))).map((i) => i.name));
    for (const ix of await secondaryIndexes(t)) {
      const name = `${ix.name}_new`;
      if (have.has(name)) continue;
      // Same definition, pointed at the new table under a temporary name.
      const def = ix.def
        .replace(`INDEX ${ix.name} ON`, `INDEX "${name}" ON`)
        .replace(/ ON (ONLY )?(\w+\.)?"?\w+"? /, ` ON "${NEW(t)}" `);
      const t0 = Date.now();
      await query(def);
      console.log(`[copy] index ${name} built in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }
}

async function copy(): Promise<void> {
  const head = await cursor();
  const start = await windowStart();
  await createNewTables(start, head);
  for (const t of [...PARTITIONED_TABLES, "blocks"]) {
    const src = await bounds(t);
    if (!src) continue;
    const done = await bounds(NEW(t));
    const from = done ? done.hi + 1 : Math.max(start, src.lo);
    if (from > src.hi) { console.log(`[copy] ${t}: up to date at block ${fmt(src.hi)}`); continue; }
    console.log(`[copy] ${t}: blocks ${fmt(from)} to ${fmt(src.hi)}`);
    const rows = await copyRange(t, from, src.hi, "copy");
    console.log(`[copy] ${t}: ${fmt(rows)} rows copied · ${NEW(t)} is ${await size(NEW(t))}`);
  }
  await buildIndexes();
  for (const t of [...PARTITIONED_TABLES, "blocks"]) await query(`ANALYZE "${NEW(t)}"`);
  console.log("[copy] done. Run --copy again to catch up, or stop the indexer and run --swap.");
}

// ─── swap ─────────────────────────────────────────────────────────

async function swap(): Promise<void> {
  const before = await cursor();
  console.log("[swap] checking the indexer is stopped (20s)…");
  await sleep(20_000);
  if ((await cursor()) !== before) throw new Error("the indexer cursor is still moving. Stop pev-indexer first.");
  for (const t of [...PARTITIONED_TABLES, "blocks"]) {
    if (!(await exists(NEW(t)))) throw new Error(`${NEW(t)} does not exist, run --copy first`);
    if (await exists(OLD(t))) throw new Error(`${OLD(t)} already exists, a swap has already happened`);
  }
  const start = await windowStart();
  await createNewTables(start, before);

  // The indexer writes newest-first and can fill a block hours late, so
  // the recent tail is copied again now that nothing is writing.
  for (const t of [...PARTITIONED_TABLES, "blocks"]) {
    const src = await bounds(t);
    if (!src) continue;
    const col = t === "blocks" ? "number" : "block_number";
    const tail = Math.max(start, src.hi - TAIL_RECOPY);
    await query(`DELETE FROM "${NEW(t)}" WHERE ${col} >= $1`, [tail]);
    const rows = await copyRange(t, tail, src.hi, "swap");
    console.log(`[swap] ${t}: tail from block ${fmt(tail)} re-copied, ${fmt(rows)} rows`);
  }
  await buildIndexes();

  // Row counts over the last day must match exactly before anything is renamed.
  for (const t of [...PARTITIONED_TABLES, "blocks"]) {
    const src = await bounds(t);
    if (!src) continue;
    const col = t === "blocks" ? "number" : "block_number";
    const lo = Math.max(start, src.hi - BLOCKS_PER_DAY);
    const a = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM "${t}" WHERE ${col} >= $1`, [lo]);
    const b = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM "${NEW(t)}" WHERE ${col} >= $1`, [lo]);
    if (a?.n !== b?.n) throw new Error(`${t}: last-day row count differs (old ${a?.n}, new ${b?.n}). Nothing was renamed.`);
    console.log(`[swap] ${t}: last-day rows match (${fmt(parseInt(a?.n ?? "0", 10))})`);
  }

  await withTransaction(async (c) => {
    await c.query("SET LOCAL lock_timeout = '15s'");
    for (const t of [...PARTITIONED_TABLES, "blocks"]) {
      const oldIx = await c.query<{ name: string }>(
        `SELECT i.relname AS name FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = to_regclass($1)`, [t]);
      const newIx = await c.query<{ name: string }>(
        `SELECT i.relname AS name FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = to_regclass($1)`, [NEW(t)]);
      await c.query(`ALTER TABLE "${t}" RENAME TO "${OLD(t)}"`);
      for (const r of oldIx.rows) await c.query(`ALTER INDEX "${r.name}" RENAME TO "${r.name}_old"`);
      await c.query(`ALTER TABLE "${NEW(t)}" RENAME TO "${t}"`);
      for (const r of newIx.rows) {
        // tx_executions_new_pkey -> tx_executions_pkey, idx_x_new -> idx_x
        const final = r.name.endsWith("_new") ? r.name.slice(0, -4) : r.name.replace(`${NEW(t)}_`, `${t}_`);
        if (final !== r.name) await c.query(`ALTER INDEX "${r.name}" RENAME TO "${final}"`);
      }
    }
  });
  console.log("[swap] done. The live tables now hold only the window.");
  console.log("[swap] start pev-indexer, check the site, then run --drop-old --yes to free the disk.");
  console.log("[swap] undo before that: rename each *_old table back.");
}

// ─── drop ─────────────────────────────────────────────────────────

async function dropOld(): Promise<void> {
  const targets: string[] = [];
  for (const t of [...PARTITIONED_TABLES, "blocks"]) if (await exists(OLD(t))) targets.push(OLD(t));
  if (!targets.length) { console.log("[drop-old] nothing to drop"); return; }
  for (const t of targets) console.log(`[drop-old] ${t}: ${await size(t)}`);
  if (!has("--yes")) { console.log("[drop-old] not dropping without --yes. This cannot be undone."); return; }
  for (const t of PARTITIONED_TABLES) if (!(await isPartitioned(t))) throw new Error(`${t} is not partitioned, refusing to drop anything`);
  const live = await bounds("blocks");
  if (!live || (await cursor()) - live.hi > 5_000) throw new Error("the live blocks table is behind the cursor, refusing to drop the old data");
  for (const t of targets) {
    await query(`DROP TABLE "${t}"`);
    console.log(`[drop-old] dropped ${t}`);
  }
  const db = await queryOne<{ s: string }>("SELECT pg_size_pretty(pg_database_size(current_database())) AS s");
  console.log(`[drop-old] database is now ${db?.s}`);
}

async function main(): Promise<void> {
  if (has("--summary")) await summary();
  else if (has("--copy")) await copy();
  else if (has("--swap")) await swap();
  else if (has("--drop-old")) await dropOld();
  else await plan();
}

main()
  .catch((err) => { console.error("[cutover] FAILED:", (err as Error).message); process.exitCode = 1; })
  .finally(() => closePool());
