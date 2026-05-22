/**
 * indexer/store.ts, Postgres write + read layer for indexed block data.
 *
 * One main entry point: `writeBlock(probe, pev)`, atomically writes
 * everything a finalized block produces (1 blocks row, N tx_executions,
 * M conflicts, K hot slots) and updates the indexer cursor.
 *
 * Design notes:
 *   • All writes go through ON CONFLICT … DO UPDATE so re-indexing the
 *     same block is idempotent (handy for rewinds and engine_version bumps).
 *   • Multi-row INSERTs via UNNEST/json_to_recordset for performance, we
 *     can write a 200-tx block in 4 round trips instead of 200+.
 *   • All hex strings (tx hashes, contract addresses, storage slots) are
 *     stored as BYTEA. The hexToBuffer() helper handles the conversion.
 *   • Reads return shapes that mirror what the UI expects (PEVData), so
 *     server components can pull a block in 1 query and pass it straight
 *     to <EditorialView />.
 */

import type { PoolClient } from "pg";
import {
  withTransaction,
  runWithStatementTimeout,
  query,
  queryOne,
  queryRows,
} from "@/lib/db";
import type { BlockProbe, ConflictKind, Hex } from "@/lib/parallel-probe";
import type { PEVData, PEVStatus } from "@/lib/probe-to-pev";
import { shortHex } from "@/lib/probe-to-pev";
import { publishBlockIndexed } from "@/lib/api/pubsub";

// ─── helpers ──────────────────────────────────────────────────────

/** "0xabc…" or "abc…" → Buffer (bytea-friendly) */
function hexToBuffer(hex: string): Buffer {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  // Postgres bytea wants even-length hex
  return Buffer.from(stripped.length % 2 === 0 ? stripped : "0" + stripped, "hex");
}

/** Buffer → "0x…" lowercase */
function bufferToHex(buf: Buffer): Hex {
  return "0x" + buf.toString("hex");
}

// ─── writes ───────────────────────────────────────────────────────

/**
 * Atomically write a fully-traced block to Postgres.
 *
 * Order:
 *   1. INSERT/UPDATE blocks (with full probe_data JSONB blob)
 *   2. DELETE existing rows in tx_executions, conflicts, block_hot_slots
 *      for this block (handles re-indexing cleanly without dup PK errors)
 *   3. Bulk INSERT tx_executions, conflicts, block_hot_slots
 *   4. UPDATE indexer_cursor.last_indexed_block (only if higher than current)
 *
 * Everything in a single transaction, partial writes never visible.
 */
export async function writeBlock(
  probe: BlockProbe,
  pev: PEVData,
  engineVersion = 1,
): Promise<void> {
  await withTransaction(async (client) => {
    await writeBlocksRow(client, probe, pev, engineVersion);

    // Wipe-then-insert is the simplest path to re-index correctness.
    // Block-scoped, so cheap.
    await client.query(
      "DELETE FROM tx_executions   WHERE block_number = $1",
      [probe.blockNumber],
    );
    await client.query(
      "DELETE FROM conflicts       WHERE block_number = $1",
      [probe.blockNumber],
    );
    await client.query(
      "DELETE FROM block_hot_slots WHERE block_number = $1",
      [probe.blockNumber],
    );

    await writeTxExecutions(client, probe.blockNumber, pev);
    await writeConflicts(client, probe.blockNumber, pev);
    await writeHotSlots(client, probe.blockNumber, pev);

    await advanceCursor(client, probe.blockNumber);
  });

  // Fire NOTIFY *after* the transaction commits, Postgres delivers
  // notifications on commit anyway, but doing it post-tx keeps the
  // intent obvious. SSE subscribers in the Next.js process will fan
  // out to all connected clients.
  // Best-effort: never block the indexer on a notification failure.
  publishBlockIndexed(probe.blockNumber).catch((err) => {
    console.warn(
      `[store] NOTIFY failed for block ${probe.blockNumber}:`,
      (err as Error).message,
    );
  });
}

async function writeBlocksRow(
  client: PoolClient,
  probe: BlockProbe,
  pev: PEVData,
  engineVersion: number,
): Promise<void> {
  await client.query(
    `INSERT INTO blocks (
       number, hash, timestamp, tx_count, stateful_count,
       parallelism_factor, parallelism_score, execution_depth,
       conflict_count, blocked_pct, avg_conflicts_per_tx, hot_slot_count,
       probe_data, engine_version, trace_ms
     ) VALUES (
       $1, $2, to_timestamp($3), $4, $5,
       $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15
     )
     ON CONFLICT (number) DO UPDATE SET
       hash                 = EXCLUDED.hash,
       timestamp            = EXCLUDED.timestamp,
       tx_count             = EXCLUDED.tx_count,
       stateful_count       = EXCLUDED.stateful_count,
       parallelism_factor   = EXCLUDED.parallelism_factor,
       parallelism_score    = EXCLUDED.parallelism_score,
       execution_depth      = EXCLUDED.execution_depth,
       conflict_count       = EXCLUDED.conflict_count,
       blocked_pct          = EXCLUDED.blocked_pct,
       avg_conflicts_per_tx = EXCLUDED.avg_conflicts_per_tx,
       hot_slot_count       = EXCLUDED.hot_slot_count,
       probe_data           = EXCLUDED.probe_data,
       engine_version       = EXCLUDED.engine_version,
       indexed_at           = NOW(),
       trace_ms             = EXCLUDED.trace_ms`,
    [
      probe.blockNumber,
      hexToBuffer(probe.blockHash),
      probe.timestamp,
      probe.txCount,
      probe.statefulTxCount,
      probe.parallelismFactor,
      pev.summary.parallelismScore,
      probe.executionDepth,
      probe.conflictCount,
      pev.summary.blockedPct,
      pev.summary.avgConflictsPerTx,
      probe.hotSlots.length,
      // probe_data: NULL by design. We used to JSON.stringify(pev) here, but
      // it was a duplicate of the data we already store in tx_executions,
      // conflicts, and block_hot_slots. At 1.5M blocks the blob hit ~11GB
      // and pushed the DB working set out of RAM. getBlockPEV now
      // reconstructs PEVData from the normalized tables when probe_data
      // is NULL (which is now always). Migration 007 made the column
      // nullable; migration 008 NULLs out the historical rows.
      null,
      engineVersion,
      probe.timing.totalMs,
    ],
  );
}

async function writeTxExecutions(
  client: PoolClient,
  blockNumber: number,
  pev: PEVData,
): Promise<void> {
  if (pev.txs.length === 0) return;
  // Build a multi-row VALUES (...), (...), (...), much faster than per-row inserts.
  const rows = pev.txs;
  const params: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const tx of rows) {
    tuples.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    params.push(
      blockNumber,
      hexToBuffer(tx.hash),
      tx.position,
      tx.wave,
      tx.status,
      tx.readCount,
      tx.writeCount,
      tx.inboundConflicts,
      tx.outboundConflicts,
      tx.contracts.map(hexToBuffer), // BYTEA[]
      tx.selector ? hexToBuffer(tx.selector) : null, // 4-byte BYTEA or NULL
    );
  }
  await client.query(
    `INSERT INTO tx_executions
       (block_number, tx_hash, position, wave, status,
        read_count, write_count, inbound_conflicts, outbound_conflicts,
        contracts, method_selector)
     VALUES ${tuples.join(",\n")}`,
    params,
  );
}

async function writeConflicts(
  client: PoolClient,
  blockNumber: number,
  pev: PEVData,
): Promise<void> {
  if (pev.conflicts.length === 0) return;
  const params: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const c of pev.conflicts) {
    const fromTx = pev.txs[c.fromIdx];
    const toTx = pev.txs[c.toIdx];
    tuples.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    params.push(
      blockNumber,
      c.fromIdx,
      c.toIdx,
      hexToBuffer(fromTx.hash),
      hexToBuffer(toTx.hash),
      c.kind,
      JSON.stringify(c.sharedSlots),
    );
  }
  await client.query(
    `INSERT INTO conflicts
       (block_number, from_position, to_position,
        from_tx_hash, to_tx_hash, kind, shared_slots)
     VALUES ${tuples.join(",\n")}`,
    params,
  );
}

async function writeHotSlots(
  client: PoolClient,
  blockNumber: number,
  pev: PEVData,
): Promise<void> {
  if (pev.hotSlots.length === 0) return;
  const params: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const s of pev.hotSlots) {
    tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(
      blockNumber,
      hexToBuffer(s.contract),
      hexToBuffer(s.slot),
      s.touches,
      s.conflictsCaused,
      s.contention,
    );
  }
  await client.query(
    `INSERT INTO block_hot_slots
       (block_number, contract, slot, touches, conflicts_caused, contention)
     VALUES ${tuples.join(",\n")}`,
    params,
  );
}

/**
 * Move the cursor forward, but only if `blockNumber` is greater than the
 * current value. Backfill jobs writing older blocks shouldn't rewind the
 * forward-progress marker.
 */
async function advanceCursor(client: PoolClient, blockNumber: number): Promise<void> {
  await client.query(
    `UPDATE indexer_cursor
       SET last_indexed_block = $1, last_indexed_at = NOW()
     WHERE id = 1 AND $1 > last_indexed_block`,
    [blockNumber],
  );
}

// ─── reads ────────────────────────────────────────────────────────

/**
 * Get a block's full PEVData by number. Two paths:
 *
 *   1. Fast path, probe_data JSONB blob is present on the row (recent
 *      blocks, < 24h). Return it directly.
 *   2. Reconstruction path, probe_data is NULL (older blocks). Build the
 *      PEVData by reading the normalized tables (tx_executions, conflicts,
 *      block_hot_slots). Slightly slower (~30-100ms vs ~5ms) but no live
 *      RPC trace needed, all data still indexed.
 *
 * The historical reason for storing probe_data was speed: one row read
 * vs three table joins. But that JSONB blob ballooned to ~11GB at 1.5M
 * blocks, blowing past the VM's 7.7GB RAM and forcing every page query
 * to hit cold disk. Dropping the blob on old blocks reclaims most of
 * that space; reconstruction makes the page still work.
 *
 * Returns null only when the block has no row in `blocks` at all (i.e.
 * never indexed). Block page falls back to live RPC trace in that case.
 */
export async function getBlockPEV(blockNumber: number): Promise<PEVData | null> {
  // Read the summary row + probe_data in one query. We need the summary
  // fields either way (for reconstruction) and probe_data tells us which
  // path to take. Cheaper than two round trips.
  interface BlockRow {
    number: string;
    hash: Buffer;
    timestamp: Date;
    tx_count: number;
    stateful_count: number;
    parallelism_factor: string;
    parallelism_score: number;
    execution_depth: number;
    conflict_count: number;
    blocked_pct: number;
    avg_conflicts_per_tx: string;
    hot_slot_count: number;
    probe_data: PEVData | null;
  }
  const row = await queryOne<BlockRow>(
    `SELECT number::text, hash, timestamp, tx_count, stateful_count,
            parallelism_factor::text, parallelism_score, execution_depth,
            conflict_count, blocked_pct, avg_conflicts_per_tx::text,
            hot_slot_count, probe_data
       FROM blocks WHERE number = $1`,
    [blockNumber],
  );
  if (!row) return null;

  // Fast path: blob is still cached on the row.
  if (row.probe_data) return row.probe_data;

  // Reconstruction path: build PEVData from normalized tables.
  return reconstructPEV(row);
}

/**
 * Rebuild PEVData from the three normalized tables (tx_executions,
 * conflicts, block_hot_slots) plus the summary row. Three indexed
 * queries on a single block_number, each touching at most a few hundred
 * rows. Cheap because every WHERE clause is a fully-indexed equality.
 *
 * The output shape matches what probeToPEV() produces, so EditorialView
 * + enrichPEVData consume it identically.
 */
async function reconstructPEV(row: {
  number: string;
  hash: Buffer;
  timestamp: Date;
  tx_count: number;
  stateful_count: number;
  parallelism_factor: string;
  parallelism_score: number;
  execution_depth: number;
  conflict_count: number;
  blocked_pct: number;
  avg_conflicts_per_tx: string;
  hot_slot_count: number;
}): Promise<PEVData> {
  const blockNumber = parseInt(row.number, 10);
  const blockHash = bufferToHex(row.hash);

  // Three queries in parallel, all indexed on block_number.
  interface TxRow {
    tx_hash: Buffer;
    position: number;
    wave: number;
    status: string;
    read_count: number;
    write_count: number;
    inbound_conflicts: number;
    outbound_conflicts: number;
    contracts: Buffer[];
    method_selector: Buffer | null;
  }
  interface ConflictRow {
    from_position: number;
    to_position: number;
    kind: ConflictKind;
    shared_slots: string[];
  }
  interface HotSlotRow {
    contract: Buffer;
    slot: Buffer;
    touches: number;
    conflicts_caused: number;
    contention: string;
  }

  const [txRows, conflictRows, hotSlotRows] = await Promise.all([
    queryRows<TxRow>(
      `SELECT tx_hash, position, wave, status,
              read_count, write_count, inbound_conflicts, outbound_conflicts,
              contracts, method_selector
         FROM tx_executions
        WHERE block_number = $1
        ORDER BY position`,
      [blockNumber],
    ),
    queryRows<ConflictRow>(
      `SELECT from_position, to_position, kind, shared_slots
         FROM conflicts
        WHERE block_number = $1
        ORDER BY from_position, to_position`,
      [blockNumber],
    ),
    queryRows<HotSlotRow>(
      `SELECT contract, slot, touches, conflicts_caused, contention::text
         FROM block_hot_slots
        WHERE block_number = $1
        ORDER BY contention DESC, conflicts_caused DESC`,
      [blockNumber],
    ),
  ]);

  // Build PEVTx[] in source order. Mirrors probeToPEV().
  const txs = txRows.map((t, i) => {
    const contracts = t.contracts.map(bufferToHex);
    return {
      id: `tx${i}`,
      hash: bufferToHex(t.tx_hash),
      position: t.position,
      wave: t.wave,
      status: t.status as PEVStatus,
      contracts,
      readCount: t.read_count,
      writeCount: t.write_count,
      inboundConflicts: t.inbound_conflicts,
      outboundConflicts: t.outbound_conflicts,
      selector: t.method_selector
        ? (bufferToHex(t.method_selector) as Hex)
        : null,
      label: shortHex(bufferToHex(t.tx_hash), 6, 4),
      contractLabel:
        contracts.length > 0 ? shortHex(contracts[0], 6, 4) : "-",
    };
  });

  // Group by wave. waves array length = max wave + 1, never < 1.
  const waveCount = Math.max(row.execution_depth, 1);
  const waveTxs: typeof txs[] = Array.from({ length: waveCount }, () => []);
  for (const tx of txs) {
    if (tx.wave >= 0 && tx.wave < waveCount) {
      waveTxs[tx.wave].push(tx);
    }
  }

  const conflicts = conflictRows.map((c) => ({
    fromId: `tx${c.from_position}`,
    toId: `tx${c.to_position}`,
    fromIdx: c.from_position,
    toIdx: c.to_position,
    sharedSlots: c.shared_slots,
    kind: c.kind,
  }));

  const hotSlots = hotSlotRows.map((s) => {
    const contract = bufferToHex(s.contract);
    const slot = bufferToHex(s.slot);
    return {
      contract,
      slot,
      touches: s.touches,
      conflictsCaused: s.conflicts_caused,
      contention: parseFloat(s.contention),
      label: shortHex(slot, 8, 4),
      contractLabel: shortHex(contract, 6, 4),
    };
  });

  // hotContracts isn't stored separately and isn't read by any UI today.
  // probeToPEV computes it from the probe; we'd need an UNNEST aggregate
  // over tx_executions.contracts to replicate. Skipping: returning [] is
  // both correct (no consumer breaks) and saves a fourth query per page.
  return {
    query: {
      kind: "block",
      value: blockHash,
      label: `Block #${blockNumber.toLocaleString()}`,
    },
    summary: {
      block: blockNumber,
      blockHash,
      timestamp: Math.floor(row.timestamp.getTime() / 1000),
      txCount: row.tx_count,
      statefulTxCount: row.stateful_count,
      parallelismScore: row.parallelism_score,
      parallelismFactor: parseFloat(row.parallelism_factor),
      blockedPct: row.blocked_pct,
      avgConflictsPerTx: parseFloat(row.avg_conflicts_per_tx),
      longestChain: row.execution_depth,
      waves: row.execution_depth,
      conflictCount: row.conflict_count,
      hotSlotCount: row.hot_slot_count,
    },
    txs,
    conflicts,
    hotSlots,
    waveTxs,
    hotContracts: [],
  };
}

/**
 * Read the indexer's progress (last block indexed + when).
 * Used by the health endpoint and the landing page's "live status" badge.
 */
export async function getCursor(): Promise<{
  lastIndexedBlock: number;
  lastIndexedAt: Date | null;
} | null> {
  const row = await queryOne<{
    last_indexed_block: string;
    last_indexed_at: Date;
  }>("SELECT last_indexed_block::text, last_indexed_at FROM indexer_cursor WHERE id = 1");
  if (!row) return null;
  return {
    lastIndexedBlock: parseInt(row.last_indexed_block, 10),
    lastIndexedAt: row.last_indexed_at,
  };
}

/**
 * Recent indexed blocks, newest first. Used for the landing-page live feed
 * and the leaderboards.
 */
export interface BlockSummaryRow {
  number: number;
  hash: Hex;
  timestamp: Date;
  txCount: number;
  parallelismScore: number;
  blockedPct: number;
  conflictCount: number;
  executionDepth: number;
}

export async function getRecentBlocks(limit = 20): Promise<BlockSummaryRow[]> {
  interface Row {
    number: string;
    hash: Buffer;
    timestamp: Date;
    tx_count: number;
    parallelism_score: number;
    blocked_pct: number;
    conflict_count: number;
    execution_depth: number;
  }
  // Note: do NOT cast `number` to text here. With `SELECT number::text, ...`
  // Postgres exposes the cast result as a column also named `number`,
  // which then shadows the BIGINT column in the ORDER BY, so sorting
  // happens on the text representation and the PK index can't be used.
  // Result was a Parallel Seq Scan over 1.75M rows = 1.4s for 10 rows.
  // node-postgres returns BIGINT as a string by default, so we don't
  // need the cast anyway.
  const result = await query<Row>(
    `SELECT number, hash, timestamp, tx_count, parallelism_score,
            blocked_pct, conflict_count, execution_depth
       FROM blocks ORDER BY number DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => ({
    number: parseInt(r.number, 10),
    hash: bufferToHex(r.hash),
    timestamp: r.timestamp,
    txCount: r.tx_count,
    parallelismScore: r.parallelism_score,
    blockedPct: r.blocked_pct,
    conflictCount: r.conflict_count,
    executionDepth: r.execution_depth,
  }));
}

// ─── tx detail reads ─────────────────────────────────────────────

export interface TxDetail {
  hash: Hex;
  blockNumber: number;
  blockHash: Hex;
  blockTimestamp: Date;
  position: number;
  wave: number;
  status: PEVStatus;
  readCount: number;
  writeCount: number;
  inboundConflicts: number;
  outboundConflicts: number;
  contracts: Hex[];
  /** 4-byte selector ("0xa9059cbb") or null. Resolve via enrichment lib for human name. */
  selector: Hex | null;
  conflicts: Array<{
    blockNumber: number;
    fromPosition: number;
    toPosition: number;
    fromHash: Hex;
    toHash: Hex;
    kind: ConflictKind;
    sharedSlots: string[];
    /** "blocks" if this tx is the upstream cause; "blocked-by" if the downstream waiter */
    relation: "blocks" | "blocked-by";
  }>;
}

export async function getTxDetail(txHashHex: string): Promise<TxDetail | null> {
  const lower = txHashHex.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(lower)) return null;
  const buf = Buffer.from(lower.slice(2), "hex");

  interface TxRow {
    block_number: string;
    position: number;
    wave: number;
    status: string;
    read_count: number;
    write_count: number;
    inbound_conflicts: number;
    outbound_conflicts: number;
    contracts: Buffer[];
    method_selector: Buffer | null;
    block_hash: Buffer;
    block_timestamp: Date;
  }
  const tx = await queryOne<TxRow>(
    `SELECT t.block_number::text, t.position, t.wave, t.status,
            t.read_count, t.write_count, t.inbound_conflicts, t.outbound_conflicts,
            t.contracts, t.method_selector,
            b.hash AS block_hash, b.timestamp AS block_timestamp
       FROM tx_executions t
       JOIN blocks b ON b.number = t.block_number
      WHERE t.tx_hash = $1`,
    [buf],
  );
  if (!tx) return null;

  interface ConflictRow {
    block_number: string;
    from_position: number;
    to_position: number;
    from_tx_hash: Buffer;
    to_tx_hash: Buffer;
    kind: ConflictKind;
    shared_slots: string[];
  }
  const conflicts = await queryRows<ConflictRow>(
    `SELECT block_number::text, from_position, to_position,
            from_tx_hash, to_tx_hash, kind, shared_slots
       FROM conflicts
      WHERE block_number = $1
        AND (from_tx_hash = $2 OR to_tx_hash = $2)
      ORDER BY from_position, to_position`,
    [tx.block_number, buf],
  );

  return {
    hash: lower as Hex,
    blockNumber: parseInt(tx.block_number, 10),
    blockHash: bufferToHex(tx.block_hash),
    blockTimestamp: tx.block_timestamp,
    position: tx.position,
    wave: tx.wave,
    status: tx.status as PEVStatus,
    readCount: tx.read_count,
    writeCount: tx.write_count,
    inboundConflicts: tx.inbound_conflicts,
    outboundConflicts: tx.outbound_conflicts,
    contracts: tx.contracts.map(bufferToHex),
    selector: tx.method_selector ? (bufferToHex(tx.method_selector) as Hex) : null,
    conflicts: conflicts.map((c) => ({
      blockNumber: parseInt(c.block_number, 10),
      fromPosition: c.from_position,
      toPosition: c.to_position,
      fromHash: bufferToHex(c.from_tx_hash),
      toHash: bufferToHex(c.to_tx_hash),
      kind: c.kind,
      sharedSlots: c.shared_slots,
      relation: c.from_tx_hash.equals(buf) ? "blocks" : "blocked-by",
    })),
  };
}

// ─── contract detail reads ───────────────────────────────────────

export interface ContractHotSlot {
  slot: Hex;
  appearances: number;
  totalTouches: number;
  totalConflicts: number;
}

export interface ContractMethod {
  /** 4-byte selector, lowercase 0x-hex (e.g. "0xa9059cbb") */
  selector: Hex;
  /** Total tx count for this method on this contract */
  txCount: number;
  /** Sum of outbound conflicts attributed to this method */
  conflictsCaused: number;
  /** Distinct blocks this method appeared in */
  blocksAppearedIn: number;
}

export interface ContractDetail {
  address: Hex;
  /**
   * All aggregates below are computed over the `[windowFromBlock, windowToBlock]`
   * range. The window is selectable per request via ContractWindowKey,
   * with `all` meaning every block pev has indexed (windowFromBlock = 0).
   * The page surfaces the resolved window in its caveat so numbers are honest.
   */
  blocksAppeared: number;
  txsTouched: number;
  avgParallelismScore: number;
  conflictsCaused: number;
  /** The window key the caller requested (echoed for UI selection state). */
  windowKey: ContractWindowKey;
  windowFromBlock: number;
  windowToBlock: number;
  recentBlocks: BlockSummaryRow[];
  hotSlots: ContractHotSlot[];
  /** Top methods by conflicts caused. Empty for plain-transfer-only contracts. */
  methods: ContractMethod[];
}

/**
 * Time-range buckets exposed on /contract/[address]. Each maps to a
 * block count using the current Monad cadence (~0.5s/block ⇒ 7200 blocks/h).
 * `all` is a sentinel meaning "no block lower bound, use everything we
 * have indexed" and is implemented by skipping the `block_number >= $2`
 * predicate so the GIN index on contracts is the only filter.
 */
export type ContractWindowKey = "1h" | "24h" | "7d" | "30d" | "all";

export const DEFAULT_CONTRACT_WINDOW: ContractWindowKey = "7d";

const BLOCKS_PER_HOUR = 7200;

const WINDOW_BLOCK_COUNT: Record<ContractWindowKey, number | null> = {
  "1h": BLOCKS_PER_HOUR,
  "24h": BLOCKS_PER_HOUR * 24,
  "7d": BLOCKS_PER_HOUR * 24 * 7,
  "30d": BLOCKS_PER_HOUR * 24 * 30,
  all: null,
};

/**
 * Legacy export. Pre-windowing code paths used a single global constant.
 * Keeping the name so callers that imported it still compile; new code
 * should use ContractWindowKey + getContractDetail(addr, window).
 */
export const CONTRACT_WINDOW_BLOCKS = WINDOW_BLOCK_COUNT["7d"] ?? 5000;

export async function getContractDetail(
  addrHex: string,
  windowKey: ContractWindowKey = DEFAULT_CONTRACT_WINDOW,
  /**
   * Optional per-statement timeout override. The page layer passes a
   * value derived from its remaining total budget so a single window's
   * timeout never lets the overall request exceed Cloudflare's 30s
   * edge ceiling. Defaults to TIMEOUT_BY_WINDOW for the requested
   * window when not provided.
   */
  statementTimeoutMs?: number,
): Promise<ContractDetail | null> {
  const lower = addrHex.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) return null;
  const buf = Buffer.from(lower.slice(2), "hex");

  // Resolve window. For finite windows we anchor to the current chain
  // tip and subtract the window size. For `all`, we previously dropped
  // the block_number predicate entirely, which let the planner pick a
  // GIN-only plan that scanned millions of rows for popular contracts
  // and timed out. Now `all` uses an explicit wide range (90 days) so
  // the planner has a btree path to choose, while still covering every
  // block we've actually indexed today.
  const ALL_WINDOW_BLOCKS = BLOCKS_PER_HOUR * 24 * 90; // 90 days of headroom
  const blockCount = WINDOW_BLOCK_COUNT[windowKey] ?? ALL_WINDOW_BLOCKS;
  const tipRow = await queryOne<{ hi: string }>(
    `SELECT max(number)::text AS hi FROM blocks`,
  );
  const windowHi = tipRow ? parseInt(tipRow.hi, 10) : 0;
  const windowLo = Math.max(0, windowHi - (blockCount - 1));

  // Single parameterization now that we always have a block lower bound.
  // The planner sees a selective range filter and can choose between
  // btree-on-block_number (good for narrow windows, popular contracts)
  // and GIN-on-contracts (good for wide windows, niche contracts).
  const params: unknown[] = [buf, windowLo];
  const blockClause = "AND t.block_number >= $2";
  const blockClauseNoAlias = "AND block_number >= $2";

  interface SummaryRow {
    blocks: string;
    txs: string;
    avg_score: string | null;
    conflicts_caused: string | null;
  }
  interface RecentRow {
    number: string;
    hash: Buffer;
    timestamp: Date;
    tx_count: number;
    parallelism_score: number;
    blocked_pct: number;
    conflict_count: number;
    execution_depth: number;
  }
  interface HotSlotRow {
    slot: Buffer;
    appearances: string;
    total_touches: string;
    total_conflicts: string;
  }
  interface MethodRow {
    method_selector: Buffer;
    tx_count: string;
    conflicts_caused: string;
    blocks_seen: string;
  }

  // Per-window default per-statement timeout. These are the BUDGETS we'd
  // pick if no remaining-budget cap forces us lower. The page layer can
  // override via statementTimeoutMs to keep the overall request under
  // Cloudflare's 30s edge ceiling when retrying through the fallback
  // ladder.
  //
  // These are intentionally small. With 4 queries running in parallel
  // on separate connections the worst case per call is ~max(4)+overhead,
  // not 4×. A popular contract can still hit the limit on the slowest
  // query (summary or methods); when that happens the page narrows the
  // window and tries again.
  const TIMEOUT_BY_WINDOW: Record<ContractWindowKey, number> = {
    "1h": 2_500,
    "24h": 4_000,
    "7d": 7_000,
    "30d": 9_000,
    all: 10_000,
  };
  const stmtTimeout = statementTimeoutMs ?? TIMEOUT_BY_WINDOW[windowKey];

  // Run all 4 queries in parallel on separate connections (NOT serialized
  // on a single client). Each carries its own statement_timeout so a
  // single slow query can't block the others, and any one timing out
  // surfaces as PG_QUERY_CANCELED which the page layer catches.
  const [summaryRes, recentRes, hotSlotsRes, methodsRes] = await Promise.all([
    runWithStatementTimeout<SummaryRow>(
      stmtTimeout,
      `SELECT
         count(DISTINCT t.block_number)::text   AS blocks,
         count(*)::text                          AS txs,
         avg(b.parallelism_score)::text          AS avg_score,
         sum(t.outbound_conflicts)::text         AS conflicts_caused
       FROM tx_executions t
       JOIN blocks b ON b.number = t.block_number
       WHERE $1 = ANY(t.contracts)
         ${blockClause}`,
      params,
    ),
    runWithStatementTimeout<RecentRow>(
      stmtTimeout,
      `SELECT b.number::text, b.hash, b.timestamp, b.tx_count,
              b.parallelism_score, b.blocked_pct, b.conflict_count,
              b.execution_depth
         FROM blocks b
         JOIN (
           SELECT DISTINCT block_number
             FROM tx_executions
            WHERE $1 = ANY(contracts)
              ${blockClauseNoAlias}
            ORDER BY block_number DESC
            LIMIT 10
         ) recent_blocks ON recent_blocks.block_number = b.number
        ORDER BY b.number DESC`,
      params,
    ),
    runWithStatementTimeout<HotSlotRow>(
      stmtTimeout,
      `SELECT slot,
              count(*)::text                AS appearances,
              sum(touches)::text            AS total_touches,
              sum(conflicts_caused)::text   AS total_conflicts
         FROM block_hot_slots
        WHERE contract = $1
          ${blockClauseNoAlias}
        GROUP BY slot
        ORDER BY total_conflicts DESC, total_touches DESC
        LIMIT 10`,
      params,
    ),
    // Per-method breakdown: which 4-byte selector causes the most contention.
    // Order by conflicts caused first (the killer signal), then by tx count
    // as a tiebreaker. method_selector is NULL for plain ETH transfers; we
    // exclude those because a "method" with no selector is just an EOA
    // transfer, not contract logic.
    runWithStatementTimeout<MethodRow>(
      stmtTimeout,
      `SELECT method_selector,
              count(*)::text                       AS tx_count,
              sum(outbound_conflicts)::text        AS conflicts_caused,
              count(DISTINCT block_number)::text   AS blocks_seen
         FROM tx_executions
        WHERE $1 = ANY(contracts)
          AND method_selector IS NOT NULL
          ${blockClauseNoAlias}
        GROUP BY method_selector
        ORDER BY sum(outbound_conflicts) DESC NULLS LAST,
                 count(*) DESC
        LIMIT 10`,
      params,
    ),
  ]);
  const summary = summaryRes.rows[0] ?? null;
  const recent = recentRes.rows;
  const hotSlots = hotSlotsRes.rows;
  const methods = methodsRes.rows;

  if (!summary || parseInt(summary.txs, 10) === 0) return null;

  return {
    address: lower as Hex,
    blocksAppeared: parseInt(summary.blocks, 10),
    txsTouched: parseInt(summary.txs, 10),
    avgParallelismScore: summary.avg_score
      ? Math.round(parseFloat(summary.avg_score) * 10) / 10
      : 0,
    conflictsCaused: summary.conflicts_caused
      ? parseInt(summary.conflicts_caused, 10)
      : 0,
    // Window bounds, the actual block range these aggregates cover. The
    // page surfaces this so users see "stats from #X to #Y" instead of
    // wondering whether the numbers are all-time or recent.
    windowKey,
    windowFromBlock: windowLo,
    windowToBlock: windowHi,
    recentBlocks: recent.map((r) => ({
      number: parseInt(r.number, 10),
      hash: bufferToHex(r.hash),
      timestamp: r.timestamp,
      txCount: r.tx_count,
      parallelismScore: r.parallelism_score,
      blockedPct: r.blocked_pct,
      conflictCount: r.conflict_count,
      executionDepth: r.execution_depth,
    })),
    hotSlots: hotSlots.map((s) => ({
      slot: bufferToHex(s.slot),
      appearances: parseInt(s.appearances, 10),
      totalTouches: parseInt(s.total_touches, 10),
      totalConflicts: parseInt(s.total_conflicts, 10),
    })),
    methods: methods.map((m) => ({
      selector: bufferToHex(m.method_selector),
      txCount: parseInt(m.tx_count, 10),
      conflictsCaused: parseInt(m.conflicts_caused, 10),
      blocksAppearedIn: parseInt(m.blocks_seen, 10),
    })),
  };
}

/**
 * Cheap probe to distinguish "never indexed" from "indexed but quiet."
 *
 * Hits the GIN index on tx_executions.contracts via `$1 = ANY(contracts)` and
 * pulls only the latest block for that contract. Bounded by LIMIT 1, so the
 * cost stays roughly constant regardless of contract popularity.
 *
 * Returns null if pev has never seen a tx touching this address. Otherwise
 * returns the last-seen block number plus its timestamp, so the NotSeen page
 * can show "last active 4h ago" instead of the misleading "never indexed."
 */
export async function getContractLastSeen(
  addrHex: string,
): Promise<{ block: number; at: Date } | null> {
  const lower = addrHex.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) return null;
  const buf = Buffer.from(lower.slice(2), "hex");

  // Primary path: contract_index PK lookup. This is a single-row btree
  // probe by bytea, O(log n), microseconds, regardless of contract
  // popularity. The table is maintained out-of-band by a systemd timer
  // (`pev-contract-index-refresh.timer`, every 15 min) that does the
  // expensive unnest+GROUP BY across tx_executions once and stores the
  // result. Both empty contracts (no row → instant null) and popular
  // contracts (one row, point lookup → instant) are handled the same.
  //
  // Why we don't query tx_executions directly: a `WHERE $1 = ANY(contracts)`
  // probe over 23M+ rows forces the planner to choose between:
  //   (a) GIN bitmap scan + sort + LIMIT 1 (multi-second on popular
  //       contracts because the bitmap is huge),
  //   (b) btree-on-block_number walk + per-row GIN check (multi-second
  //       on rarely-active or empty contracts).
  // Neither is acceptable, and the planner picks badly often enough
  // that pages were timing out. contract_index sidesteps the entire
  // problem.
  //
  // Staleness: contract_index lags real-time by at most one refresh
  // tick (15 min). For "is this contract here?" lookups that's fine,
  // the user just wants existence, not last-block-precision.
  interface IndexRow {
    last_block: string;
  }
  const idxRow = await queryOne<IndexRow>(
    `SELECT last_block::text FROM contract_index WHERE contract = $1`,
    [buf],
  );
  if (!idxRow) return null;
  const block = parseInt(idxRow.last_block, 10);
  const tsRow = await queryOne<{ timestamp: Date }>(
    `SELECT timestamp FROM blocks WHERE number = $1`,
    [block],
  );
  if (!tsRow) return null;
  return { block, at: tsRow.timestamp };
}

// ─── block bottleneck (hero verdict line) ────────────────────────

export interface BlockBottleneck {
  /** Contract that owns the most-contested slot in this block */
  topContract: Hex;
  /** The slot itself (32-byte storage location, hex-encoded) */
  topSlot: Hex;
  /** How many tx pairs in this block had a conflict on this slot */
  topSlotConflicts: number;
  /** How many txs in this block touched this slot at all */
  topSlotTouches: number;
  /** Total distinct (contract, slot) pairs that were "hot" in this block */
  totalHotSlots: number;
}

/**
 * Find the single most-contested storage slot in a block.
 *
 * Used by the landing-page hero card to render a one-line *verdict*
 * underneath the metrics strip ("Bottleneck: vault.deposit at 0x… ·
 * slot 0x…01, 4 conflicts"). Without this, the hero card answers
 * the H1 question ("Is your contract killing parallelism?") with
 * four numbers and a click-through; the verdict bridges data → cause.
 *
 * Cheap: two indexed lookups on block_hot_slots, both PK-scoped to
 * a single block. Returns null if the block has no hot slots (every
 * storage location was touched by ≤1 tx).
 */
export async function getBlockBottleneck(
  blockNumber: number,
): Promise<BlockBottleneck | null> {
  interface TopRow {
    contract: Buffer;
    slot: Buffer;
    conflicts_caused: number;
    touches: number;
  }
  const top = await queryOne<TopRow>(
    `SELECT contract, slot, conflicts_caused, touches
       FROM block_hot_slots
      WHERE block_number = $1
      ORDER BY conflicts_caused DESC, touches DESC, contention DESC
      LIMIT 1`,
    [blockNumber],
  );
  if (!top) return null;

  const totalRow = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM block_hot_slots WHERE block_number = $1`,
    [blockNumber],
  );

  return {
    topContract: bufferToHex(top.contract),
    topSlot: bufferToHex(top.slot),
    topSlotConflicts: top.conflicts_caused,
    topSlotTouches: top.touches,
    totalHotSlots: totalRow ? parseInt(totalRow.n, 10) : 1,
  };
}

// ─── top bottleneck contracts (landing search affordance) ─────────

export interface TopBottleneckContract {
  /** Contract address, lowercase 0x-hex */
  address: Hex;
  /** Distinct blocks (in the recent window) where this contract had a hot slot */
  hotBlocks: number;
  /** Sum of conflicts caused across those blocks */
  totalConflicts: number;
  /** Sum of touches across those blocks */
  totalTouches: number;
}

/**
 * Top contracts that have been *causing* parallelism issues recently.
 *
 * Used by the landing-page search affordance, small chips under the
 * input that say "try a contract: 0xabc… · 0xdef… · 0x123…". Clicking
 * one routes to /contract/[address] and lets the user see exactly how
 * that contract has been killing throughput.
 *
 * The H1 promise is "Is *your* contract killing parallelism?", these
 * chips show concrete proof that the tool delivers on that promise,
 * even before the visitor pastes their own address.
 *
 * Source: `block_hot_slots` table, only contracts that had a hot slot
 * (≥2 txs touching the same storage location) appear here, which is
 * exactly the audience we want to surface. Window is the last `recent`
 * blocks, default 200 (~100 seconds of mainnet).
 */
export async function getTopBottleneckContracts(
  limit = 3,
  recentBlocks = 200,
): Promise<TopBottleneckContract[]> {
  interface Row {
    contract: Buffer;
    hot_blocks: string;
    total_conflicts: string;
    total_touches: string;
  }

  // Compute the window-bound separately so the planner sees `block_number
  // > <constant>` and can use the index range scan on block_hot_slots_pkey
  // (which leads with block_number). The previous CTE-based query had
  // `block_number > max_n.m - 200` which the planner couldn't push into
  // the index condition, so it Seq Scanned all 31M rows = 68 seconds.
  // Now: one quick max() + one bounded range scan = <100ms total.
  const maxRow = await queryOne<{ m: string | null }>(
    `SELECT max(block_number)::text AS m FROM block_hot_slots`,
  );
  if (!maxRow?.m) return [];
  const lo = parseInt(maxRow.m, 10) - recentBlocks;

  const rows = await queryRows<Row>(
    `SELECT contract,
            count(DISTINCT block_number)::text   AS hot_blocks,
            sum(conflicts_caused)::text          AS total_conflicts,
            sum(touches)::text                   AS total_touches
       FROM block_hot_slots
      WHERE block_number > $2
      GROUP BY contract
      ORDER BY sum(conflicts_caused) DESC, sum(touches) DESC
      LIMIT $1`,
    [limit, lo],
  );
  return rows.map((r) => ({
    address: bufferToHex(r.contract),
    hotBlocks: parseInt(r.hot_blocks, 10),
    totalConflicts: parseInt(r.total_conflicts, 10),
    totalTouches: parseInt(r.total_touches, 10),
  }));
}

// ─── analytics page (chain-wide stats over a recent window) ─────

export interface AnalyticsDayPoint {
  /** ISO date string YYYY-MM-DD (UTC) */
  date: string;
  /** Average parallelism score across all blocks indexed on this day */
  avgScore: number;
  /** Sum of all block-level conflict counts on this day */
  totalConflicts: number;
  /** Block count on this day */
  blockCount: number;
  /** Sum of tx counts across blocks on this day */
  txCount: number;
}

export interface AnalyticsKiller {
  address: Hex;
  /** Total conflicts caused by this contract over the window */
  totalConflicts: number;
  /** Distinct blocks where this contract had at least one hot slot */
  hotBlocks: number;
  /** Total touches (read+write events) on this contract's hot slots */
  totalTouches: number;
}

export interface AnalyticsHotSlot {
  /** Contract address that owns this slot */
  contract: Hex;
  /** 32-byte storage slot, hex-encoded */
  slot: Hex;
  /** Total conflicts caused by this exact (contract, slot) pair over the window */
  totalConflicts: number;
  /** Total touches across all blocks where this slot was hot */
  totalTouches: number;
  /** Distinct blocks where this slot was hot */
  hotBlocks: number;
}

export interface AnalyticsMethod {
  /** 4-byte function selector, hex-encoded */
  selector: Hex;
  /** Total transactions invoking this selector over the window */
  txCount: number;
  /** Sum of outbound conflicts across all txs invoking it */
  conflictsCaused: number;
  /** Distinct blocks containing at least one call to this selector */
  blockCount: number;
}

export interface AnalyticsConflictKind {
  /** "write_write" / "read_write" / "write_read" */
  kind: ConflictKind;
  /** Total conflicts of this kind over the window */
  count: number;
  /** Share of all conflicts in the window, 0..1 */
  share: number;
}

export interface AnalyticsWaveBucket {
  /** Number of execution waves (1 = fully parallel, N = N rounds of serialization) */
  waves: number;
  /** How many blocks landed in this bucket */
  blockCount: number;
  /** Share of all blocks in the window, 0..1 */
  share: number;
}

/**
 * One block, surfaced as an editorial example on the analytics page.
 * Used for the "cleanest block today" / "worst block today" pair so
 * readers can click into a concrete example of either extreme.
 */
export interface AnalyticsStandoutBlock {
  number: number;
  hash: string;
  timestamp: string; // ISO
  txCount: number;
  parallelismScore: number;
  conflictCount: number;
}

export interface AnalyticsStandout {
  /** Highest parallelism_score in the last 24h with tx_count >= 5. */
  cleanest: AnalyticsStandoutBlock | null;
  /** Lowest parallelism_score in the last 24h with tx_count >= 5. */
  worst: AnalyticsStandoutBlock | null;
}

export interface AnalyticsData {
  /** Range covered by the main aggregates (chart, killers, kinds, waves) */
  windowFromBlock: number;
  windowToBlock: number;
  /** Narrower window used for the heavy queries (hot slots, methods).
   *  See getAnalyticsData for the perf rationale. */
  narrowWindowFromBlock: number;
  /** Per-day rollup for the chart, oldest-first so the chart reads left-to-right */
  daily: AnalyticsDayPoint[];
  /** Window-wide totals (one row, used in the stat strip) */
  totals: {
    blocks: number;
    txs: number;
    conflicts: number;
    avgScore: number;
  };
  /** Top contracts by conflicts caused over the window */
  killers: AnalyticsKiller[];
  /** Top (contract, slot) pairs by conflicts caused, the storage-level granularity */
  hotSlots: AnalyticsHotSlot[];
  /** Top 4-byte function selectors by total conflicts caused */
  methods: AnalyticsMethod[];
  /** Conflict kind breakdown, the "what KIND of contention dominates Monad" question */
  conflictKinds: AnalyticsConflictKind[];
  /** Wave depth histogram, the "how parallel is Monad structurally" question */
  waveDistribution: AnalyticsWaveBucket[];
  /**
   * Two single-block examples for the "today's standout" editorial
   * callouts. Optional so older cached payloads (pre-standout) don't
   * break the deserialize on the page. New refreshes always populate
   * it; the page tolerates undefined.
   */
  standout?: AnalyticsStandout;
}

/**
 * One-shot fetch for everything the /analytics page needs over the last
 * `windowDays` of mainnet (default 7).
 *
 * Two indexed queries against the recent block window, plus one max()
 * lookup to bound it. All bounds are passed as JS-computed literals
 * (not CTE-derived) so the planner uses the index range scan, not a
 * Seq Scan. This is the lesson we learned the hard way last week.
 *
 * Cost on the current dataset (~1.5M total blocks, last 7d ~1.2M):
 *   • max(number) lookup: ~1 ms (PK index)
 *   • daily rollup over `blocks`: ~150-300 ms (indexed range scan,
 *     small heap reads, group by date_trunc)
 *   • killers leaderboard over `block_hot_slots`: ~50-150 ms (range
 *     scan via PK on block_number, group + sort by sum)
 *
 * The page wraps this in a Next.js `revalidate: 300` cache so we hit
 * the DB at most every 5 minutes per region.
 */
export async function getAnalyticsData(
  windowDays = 7,
): Promise<AnalyticsData | null> {
  // Monad produces blocks at ~2/sec (~172,800/day). 1.21M for 7 days,
  // with a small fudge factor to handle bursts. We use a block-number
  // window rather than a timestamp window because every relevant index
  // (blocks_pkey, block_hot_slots_pkey) leads with block_number; using
  // block_number directly is the fast path. The chart still groups by
  // calendar day from `timestamp` to keep the visual honest.
  const blocksPerDay = 175_000;
  const windowBlocks = blocksPerDay * windowDays;

  // narrowWindowFromBlock = windowFromBlock now: the heavy queries can
  // use the same 7-day window because /analytics no longer runs them on
  // every page hit. The page reads a precomputed payload from
  // `analytics_cache` (refreshed every 5 minutes by the systemd timer
  // pev-analytics-refresh). The refresh job has no edge timeout, so
  // multi-second aggregates are fine.
  const narrowWindowDays = windowDays;
  const narrowWindowBlocks = blocksPerDay * narrowWindowDays;

  const maxRow = await queryOne<{ m: string | null }>(
    `SELECT max(number)::text AS m FROM blocks`,
  );
  if (!maxRow?.m) return null;
  const windowToBlock = parseInt(maxRow.m, 10);
  const windowFromBlock = Math.max(0, windowToBlock - windowBlocks);
  const narrowWindowFromBlock = Math.max(
    0,
    windowToBlock - narrowWindowBlocks,
  );

  // ─── daily rollup ─────────────────────────────────────────────
  // date_trunc('day', timestamp) gives us a UTC day bucket. We avoid
  // any locale conversion: the chart axis labels day names from the
  // ISO date so it's the same number for every viewer.
  interface DayRow {
    day: string;
    avg_score: string;
    total_conflicts: string;
    block_count: string;
    tx_count: string;
  }
  const dailyRows = await queryRows<DayRow>(
    `SELECT to_char(date_trunc('day', timestamp), 'YYYY-MM-DD') AS day,
            avg(parallelism_score)::text   AS avg_score,
            sum(conflict_count)::text       AS total_conflicts,
            count(*)::text                  AS block_count,
            sum(tx_count)::text             AS tx_count
       FROM blocks
      WHERE number > $1
      GROUP BY day
      ORDER BY day ASC`,
    [windowFromBlock],
  );

  const daily: AnalyticsDayPoint[] = dailyRows.map((r) => ({
    date: r.day,
    avgScore: Math.round(parseFloat(r.avg_score) * 10) / 10,
    totalConflicts: parseInt(r.total_conflicts, 10),
    blockCount: parseInt(r.block_count, 10),
    txCount: parseInt(r.tx_count, 10),
  }));

  const totals = daily.reduce(
    (acc, d) => ({
      blocks: acc.blocks + d.blockCount,
      txs: acc.txs + d.txCount,
      conflicts: acc.conflicts + d.totalConflicts,
      // weighted avg of daily scores by block count, more honest than
      // taking a flat average of daily averages
      _scoreSum: acc._scoreSum + d.avgScore * d.blockCount,
    }),
    { blocks: 0, txs: 0, conflicts: 0, _scoreSum: 0 },
  );
  const avgScore =
    totals.blocks > 0
      ? Math.round((totals._scoreSum / totals.blocks) * 10) / 10
      : 0;

  // ─── killers leaderboard ──────────────────────────────────────
  // Top 10 contracts by total conflicts caused over the window. Real
  // counts, no rate normalization (per the product call: "should not
  // assume, just display the data").
  interface KillerRow {
    contract: Buffer;
    total_conflicts: string;
    hot_blocks: string;
    total_touches: string;
  }
  // ─── hot slots leaderboard ────────────────────────────────────
  // Same shape as killers but one level deeper: aggregate by
  // (contract, slot) so we surface the EXACT storage location that's
  // causing contention. Often reveals universal anti-patterns ("slot 0
  // is a global counter on N contracts").
  interface HotSlotRow {
    contract: Buffer;
    slot: Buffer;
    total_conflicts: string;
    total_touches: string;
    hot_blocks: string;
  }
  // ─── methods leaderboard ──────────────────────────────────────
  // Aggregate conflicts by 4-byte selector across ALL contracts. This
  // is the cross-contract pattern view: which function shape is the
  // chain's worst-parallelizing? Heavier query (scans tx_executions
  // rather than block_hot_slots) but bounded by block_number index.
  interface MethodRow {
    method_selector: Buffer;
    tx_count: string;
    conflicts: string;
    block_count: string;
  }
  // ─── conflict kinds breakdown ─────────────────────────────────
  // One row per kind (write_write / read_write / write_read). Tiny
  // result, used to render a stacked bar showing which contention type
  // dominates Monad in this window.
  interface ConflictKindRow {
    kind: ConflictKind;
    count: string;
  }
  // ─── wave depth histogram ─────────────────────────────────────
  // How many blocks ran in 1 wave vs 2 vs 3+ ? Quantifies the
  // structural parallelism of the chain. Cheap aggregate over `blocks`.
  interface WaveBucketRow {
    waves: number;
    block_count: string;
  }

  // Standout-block lookup row shape. Single query returns up to two
  // rows tagged "cleanest" or "worst"; we union them so the page only
  // pays one round-trip for both editorial callouts.
  interface StandoutRow {
    kind: string; // "cleanest" | "worst"
    number: string;
    hash: Buffer;
    timestamp: Date;
    tx_count: number;
    parallelism_score: number;
    conflict_count: number;
  }

  // Block count cap on the standout query. 24h on Monad mainnet at
  // ~0.5s block time is ~172,800 blocks. We bound the scan by block
  // number (last 200K blocks) instead of timestamp so the query uses
  // the PK index range scan directly. Slightly wider than 24h, but
  // it's also faster and the worst/best within that window are still
  // representative of "today".
  const standoutFromBlock = Math.max(0, windowToBlock - 200_000);

  // Run all 6 leaderboard/breakdown queries in parallel. They all
  // share the same windowFromBlock literal so the planner uses the
  // same range scan for every one. This is the post-rewrite version,
  // no CTE-derived bounds anywhere.
  const [
    killerRows,
    hotSlotRows,
    methodRows,
    conflictKindRows,
    waveRows,
    standoutRows,
  ] = await Promise.all([
    queryRows<KillerRow>(
      `SELECT contract,
              sum(conflicts_caused)::text         AS total_conflicts,
              count(DISTINCT block_number)::text  AS hot_blocks,
              sum(touches)::text                  AS total_touches
         FROM block_hot_slots
        WHERE block_number > $1
          AND conflicts_caused > 0
        GROUP BY contract
        ORDER BY sum(conflicts_caused) DESC, sum(touches) DESC
        LIMIT 10`,
      [windowFromBlock],
    ),
    // Heavy queries on the NARROW window (24h), see narrowWindowFromBlock
    // comment above. Without composite indexes on tx_executions and
    // block_hot_slots, these are the two queries that would push the page
    // past the 30s edge timeout if run over the full 7d window.
    queryRows<HotSlotRow>(
      `SELECT contract, slot,
              sum(conflicts_caused)::text         AS total_conflicts,
              sum(touches)::text                  AS total_touches,
              count(DISTINCT block_number)::text  AS hot_blocks
         FROM block_hot_slots
        WHERE block_number > $1
          AND conflicts_caused > 0
        GROUP BY contract, slot
        ORDER BY sum(conflicts_caused) DESC, sum(touches) DESC
        LIMIT 10`,
      [narrowWindowFromBlock],
    ),
    queryRows<MethodRow>(
      `SELECT method_selector,
              count(*)::text                       AS tx_count,
              sum(outbound_conflicts)::text        AS conflicts,
              count(DISTINCT block_number)::text   AS block_count
         FROM tx_executions
        WHERE block_number > $1
          AND method_selector IS NOT NULL
        GROUP BY method_selector
        ORDER BY sum(outbound_conflicts) DESC NULLS LAST,
                 count(*) DESC
        LIMIT 10`,
      [narrowWindowFromBlock],
    ),
    queryRows<ConflictKindRow>(
      `SELECT kind, count(*)::text AS count
         FROM conflicts
        WHERE block_number > $1
        GROUP BY kind
        ORDER BY count(*) DESC`,
      [windowFromBlock],
    ),
    queryRows<WaveBucketRow>(
      `SELECT execution_depth AS waves,
              count(*)::text   AS block_count
         FROM blocks
        WHERE number > $1
        GROUP BY execution_depth
        ORDER BY execution_depth ASC`,
      [windowFromBlock],
    ),
    // Cleanest + worst block in the last ~24h. Two UNION'd selects so
    // we get both rows in one round-trip. tx_count >= 5 filters out
    // near-empty blocks that would trivially score 100/100 with no
    // conflicts (not editorially interesting). Each tagged with kind
    // so the result mapper knows which is which.
    queryRows<StandoutRow>(
      `WITH recent AS (
         SELECT number, hash, timestamp, tx_count, parallelism_score, conflict_count
           FROM blocks
          WHERE number > $1
            AND tx_count >= 5
       )
       (SELECT 'cleanest' AS kind, number::text, hash, timestamp,
               tx_count, parallelism_score, conflict_count
          FROM recent
         ORDER BY parallelism_score DESC, tx_count DESC, number DESC
         LIMIT 1)
       UNION ALL
       (SELECT 'worst', number::text, hash, timestamp,
               tx_count, parallelism_score, conflict_count
          FROM recent
         ORDER BY parallelism_score ASC, conflict_count DESC, number DESC
         LIMIT 1)`,
      [standoutFromBlock],
    ),
  ]);

  const killers: AnalyticsKiller[] = killerRows.map((r) => ({
    address: bufferToHex(r.contract),
    totalConflicts: parseInt(r.total_conflicts, 10),
    hotBlocks: parseInt(r.hot_blocks, 10),
    totalTouches: parseInt(r.total_touches, 10),
  }));

  const hotSlots: AnalyticsHotSlot[] = hotSlotRows.map((r) => ({
    contract: bufferToHex(r.contract),
    slot: bufferToHex(r.slot),
    totalConflicts: parseInt(r.total_conflicts, 10),
    totalTouches: parseInt(r.total_touches, 10),
    hotBlocks: parseInt(r.hot_blocks, 10),
  }));

  const methods: AnalyticsMethod[] = methodRows.map((r) => ({
    selector: bufferToHex(r.method_selector) as Hex,
    txCount: parseInt(r.tx_count, 10),
    conflictsCaused: parseInt(r.conflicts, 10),
    blockCount: parseInt(r.block_count, 10),
  }));

  const totalKindCount = conflictKindRows.reduce(
    (s, r) => s + parseInt(r.count, 10),
    0,
  );
  const conflictKinds: AnalyticsConflictKind[] = conflictKindRows.map((r) => ({
    kind: r.kind,
    count: parseInt(r.count, 10),
    share: totalKindCount > 0 ? parseInt(r.count, 10) / totalKindCount : 0,
  }));

  // Bucket waves > 4 into a single "4+" row so the histogram doesn't
  // grow long tail bars for rare deep blocks. Bucketing happens here
  // (in JS) rather than in SQL so the raw counts stay accurate; if we
  // ever want them, they're in the array before the reduce.
  const waveTotal = waveRows.reduce(
    (s, r) => s + parseInt(r.block_count, 10),
    0,
  );
  const bucketed: Map<number, number> = new Map();
  for (const r of waveRows) {
    const bucket = r.waves >= 4 ? 4 : r.waves; // 4 means "4+"
    bucketed.set(bucket, (bucketed.get(bucket) ?? 0) + parseInt(r.block_count, 10));
  }
  const waveDistribution: AnalyticsWaveBucket[] = Array.from(
    bucketed.entries(),
  )
    .map(([waves, blockCount]) => ({
      waves,
      blockCount,
      share: waveTotal > 0 ? blockCount / waveTotal : 0,
    }))
    .sort((a, b) => a.waves - b.waves);

  // Map standout rows: tag by kind, keep null when the window had no
  // qualifying blocks (e.g. early on a brand-new indexer install).
  let cleanest: AnalyticsStandoutBlock | null = null;
  let worst: AnalyticsStandoutBlock | null = null;
  for (const r of standoutRows) {
    const block: AnalyticsStandoutBlock = {
      number: parseInt(r.number, 10),
      hash: bufferToHex(r.hash),
      timestamp: r.timestamp.toISOString(),
      txCount: r.tx_count,
      parallelismScore: r.parallelism_score,
      conflictCount: r.conflict_count,
    };
    if (r.kind === "cleanest") cleanest = block;
    else if (r.kind === "worst") worst = block;
  }

  return {
    windowFromBlock,
    windowToBlock,
    narrowWindowFromBlock,
    daily,
    totals: {
      blocks: totals.blocks,
      txs: totals.txs,
      conflicts: totals.conflicts,
      avgScore,
    },
    killers,
    hotSlots,
    methods,
    conflictKinds,
    waveDistribution,
    standout: { cleanest, worst },
  };
}

// ─── analytics cache (precomputed payload for /analytics) ───────

/**
 * Read the precomputed analytics payload from the cache table.
 * Returns null if the cache is empty (e.g. immediately after deploy
 * before the first refresh has run). The page treats null as "fall
 * back to live computation".
 *
 * This is the hot path for /analytics: a single PK lookup, ~5ms.
 */
export async function getCachedAnalyticsData(): Promise<{
  data: AnalyticsData;
  refreshedAt: Date;
  refreshMs: number | null;
} | null> {
  const row = await queryOne<{
    payload: AnalyticsData;
    refreshed_at: Date;
    refresh_ms: number | null;
  }>(
    `SELECT payload, refreshed_at, refresh_ms
       FROM analytics_cache
      WHERE id = 1`,
  );
  if (!row) return null;
  return {
    data: row.payload,
    refreshedAt: row.refreshed_at,
    refreshMs: row.refresh_ms,
  };
}

/**
 * Upsert the analytics cache. Called by scripts/refresh-analytics.ts on
 * the systemd timer schedule (every 5 minutes). The single-row pattern
 * means every call is an in-place UPDATE after the first INSERT.
 */
export async function writeAnalyticsCache(
  payload: AnalyticsData,
  refreshMs: number,
): Promise<void> {
  await query(
    `INSERT INTO analytics_cache (id, payload, refreshed_at, refresh_ms)
       VALUES (1, $1::jsonb, NOW(), $2)
     ON CONFLICT (id) DO UPDATE
       SET payload      = EXCLUDED.payload,
           refreshed_at = NOW(),
           refresh_ms   = EXCLUDED.refresh_ms`,
    [JSON.stringify(payload), refreshMs],
  );
}

// Re-export the conflict kind so callers don't need two imports
export type { ConflictKind, PEVStatus };
