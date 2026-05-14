/**
 * parallel-probe.ts, server-side library for the Monad Parallel Execution Visualizer.
 *
 * Mirrors scripts/probe-block.ts but as importable functions for Next.js server components.
 * For each block:
 *   1. Fetch via eth_getBlockByNumber
 *   2. Trace via debug_traceBlockByNumber, prestateTracer twice (parallel):
 *        a. diffMode: true   , state changes (drives reads/writes/conflicts)
 *        b. diffMode: false  , full prestate of every touched account
 *                              (catches read-only access that diffMode:true
 *                              filters out: oracle calls, view-only static
 *                              calls, balance reads. callTracer would have
 *                              been the natural choice here but the RPC
 *                              we're using rejects it.)
 *   3. Extract per-tx read/write sets from (a), enrich contracts set
 *      from (b)'s address keys
 *   4. Compute conflict graph (write_a ∩ (read_b ∪ write_b))
 *   5. Wave-assign (critical path through the conflict DAG)
 *   6. Find hot storage slots and contracts
 *
 * Set `PEV_DISABLE_CALL_TRACER=1` to skip the second tracer if your
 * RPC can't keep up, falls back to prestateTracer-only behavior.
 */

export const DEFAULT_RPC =
  process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";
export const FINALITY_LAG = 100;

// ---------- types ----------

export type Hex = string;

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Two shapes of `eth_getBlockByNumber` response:
 *   - With `withTransactionData=false`: transactions = string[] (hashes only)
 *   - With `withTransactionData=true`:  transactions = RpcTx[] (full objects)
 *
 * We use the latter so we get tx.input → first 4 bytes = method selector.
 * Slightly larger response, one fewer roundtrip than fetching each tx
 * individually after the trace.
 */
interface RpcTx {
  hash: Hex;
  /** Tx input data. Empty ("0x") for pure-value transfers; ≥ 4 bytes for contract calls. */
  input: Hex;
  from?: Hex;
  to?: Hex | null;
  value?: Hex;
}

interface RpcBlock {
  number: Hex;
  hash: Hex;
  timestamp: Hex;
  transactions: RpcTx[];
}

interface PrestateAccount {
  storage?: Record<Hex, Hex>;
  balance?: Hex;
  nonce?: number;
  code?: Hex;
}

interface PrestateDiff {
  pre: Record<Hex, PrestateAccount>;
  post: Record<Hex, PrestateAccount>;
}

/**
 * Shape returned by `debug_traceBlockByNumber` with
 * `tracer: "prestateTracer", tracerConfig: { diffMode: false }`.
 *
 * Unlike `diffMode: true` (which returns only state CHANGES wrapped in
 * `pre`/`post`), this mode returns the prestate of EVERY touched
 * account. "Touched" includes accounts whose state was just READ
 * (oracle calls, view-only staticcalls, balance reads etc.), exactly
 * the gap we need to fill. The map is keyed by address; we walk the
 * keys to enrich `contracts[]`.
 *
 * Why this instead of callTracer: the Silk Nodes Monad RPC rejects
 * callTracer with "Internal error: traces not found". prestateTracer
 * with diffMode: false is the same tracer we already use successfully
 * for diffMode: true, just a different config. Reliably supported.
 *
 * We don't need any of the per-account fields (storage, balance, code,
 * nonce); only the address keys matter for the contracts set.
 */
type PrestateFull = Record<Hex, PrestateAccount>;

interface TxAccess {
  hash: Hex;
  position: number;
  reads: Set<string>;
  writes: Set<string>;
  contracts: Set<Hex>;
}

export type ConflictKind = "write-write" | "read-write" | "mixed";

export interface ConflictEdge {
  fromIdx: number;
  toIdx: number;
  fromHash: Hex;
  toHash: Hex;
  sharedSlots: string[];
  /**
   * Classification of why this conflict exists:
   *   write-write , earlier tx wrote a slot, later tx also wrote it
   *   read-write  , earlier tx wrote a slot, later tx read it
   *   mixed       , multiple shared slots, some w-w, some r-w
   */
  kind: ConflictKind;
}

export interface TxSummary {
  hash: Hex;
  position: number;
  wave: number;
  readCount: number;
  writeCount: number;
  contracts: Hex[];
  /** number of edges where this tx is the dependent (toIdx) */
  inboundConflicts: number;
  /** number of edges where this tx is the cause (fromIdx) */
  outboundConflicts: number;
  /**
   * 4-byte function selector ("0x" + 8 hex chars). Null for plain ETH
   * transfers (empty input) or when the RPC didn't return tx data.
   */
  selector: Hex | null;
}

export interface BlockProbe {
  blockNumber: number;
  blockHash: Hex;
  timestamp: number;
  txCount: number;
  statefulTxCount: number;
  parallelismFactor: number;
  executionDepth: number;
  txs: TxSummary[];
  conflictCount: number;
  topConflicts: ConflictEdge[];
  hotSlots: Array<{
    contract: Hex;
    slot: Hex;
    touches: number;
    /** how many conflict edges this slot caused (≤ touches) */
    conflictsCaused: number;
    /** normalized contention 0..1 = touches / max(touches across slots) */
    contention: number;
  }>;
  hotContracts: Array<{ contract: Hex; touches: number }>;
  timing: { rpcMs: number; computeMs: number; totalMs: number };
}

// ---------- rpc ----------

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    // Cache server-side per (url, method, params) for the request lifetime.
    // Block data is immutable once finalized, so we can cache aggressively at the page level.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} on ${method}`);
  const json = (await res.json()) as RpcResponse<T>;
  if (json.error)
    throw new Error(`RPC error on ${method}: ${json.error.message}`);
  if (json.result === undefined)
    throw new Error(`RPC returned no result for ${method}`);
  return json.result;
}

export function toHex(n: number): Hex {
  return "0x" + n.toString(16);
}

// ---------- compute ----------

/**
 * Add every address from a full-prestate response into `into`. The
 * response shape is `{ "0xaddr": { storage: {...}, balance, ... }, ... }`,
 * one entry per touched account. We only need the keys.
 *
 * Addresses are normalized to lowercase to stay consistent with the
 * rest of the indexer (the GIN index on `tx_executions.contracts` is
 * case-insensitive at the bytea level, but normalizing in JS keeps
 * the Buffer comparisons predictable).
 */
function collectFullPrestateAddresses(
  prestate: PrestateFull | null,
  into: Set<Hex>,
): void {
  if (!prestate) return;
  for (const addr of Object.keys(prestate)) {
    into.add(addr.toLowerCase() as Hex);
  }
}

function extractAccess(
  diff: PrestateDiff,
  fullPrestate: PrestateFull | null,
  hash: Hex,
  position: number,
): TxAccess {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const contracts = new Set<Hex>();

  for (const [addr, acc] of Object.entries(diff.pre ?? {})) {
    contracts.add(addr);
    if (acc.storage) {
      for (const slot of Object.keys(acc.storage)) reads.add(`${addr}:${slot}`);
    }
  }
  for (const [addr, acc] of Object.entries(diff.post ?? {})) {
    contracts.add(addr);
    if (acc.storage) {
      for (const slot of Object.keys(acc.storage)) writes.add(`${addr}:${slot}`);
    }
  }

  // Enrich with every touched account from the full-prestate response.
  // prestateTracer with diffMode:true (the diff above) only includes
  // accounts whose state CHANGED. diffMode:false includes every account
  // that was touched, even read-only access (oracle calls, view-only
  // staticcalls, balance reads). Merging the two sources gives us a
  // complete contracts set without losing the diff-driven reads/writes
  // analysis above.
  collectFullPrestateAddresses(fullPrestate, contracts);

  return { hash, position, reads, writes, contracts };
}

function computeConflicts(txs: TxAccess[]): ConflictEdge[] {
  const edges: ConflictEdge[] = [];
  for (let i = 0; i < txs.length; i++) {
    const a = txs[i];
    if (a.writes.size === 0) continue;
    for (let j = i + 1; j < txs.length; j++) {
      const b = txs[j];
      const shared: string[] = [];
      let hasWW = false;
      let hasRW = false;
      for (const w of a.writes) {
        const inBWrites = b.writes.has(w);
        const inBReads = b.reads.has(w);
        if (inBWrites || inBReads) {
          shared.push(w);
          if (inBWrites) hasWW = true;
          if (inBReads && !inBWrites) hasRW = true;
        }
      }
      if (shared.length > 0) {
        const kind: ConflictKind =
          hasWW && hasRW ? "mixed" : hasWW ? "write-write" : "read-write";
        edges.push({
          fromIdx: i,
          toIdx: j,
          fromHash: a.hash,
          toHash: b.hash,
          sharedSlots: shared,
          kind,
        });
      }
    }
  }
  return edges;
}

function assignWaves(
  txCount: number,
  conflicts: ConflictEdge[],
): { waves: number[]; executionDepth: number } {
  const blockedBy: number[][] = Array.from({ length: txCount }, () => []);
  for (const e of conflicts) blockedBy[e.toIdx].push(e.fromIdx);

  const waves: number[] = new Array(txCount).fill(0);
  let executionDepth = txCount === 0 ? 0 : 1;
  for (let i = 0; i < txCount; i++) {
    let w = 0;
    for (const j of blockedBy[i]) {
      if (waves[j] + 1 > w) w = waves[j] + 1;
    }
    waves[i] = w;
    if (w + 1 > executionDepth) executionDepth = w + 1;
  }
  return { waves, executionDepth };
}

function computeHot(
  txs: TxAccess[],
  conflicts: ConflictEdge[],
): {
  hotSlots: BlockProbe["hotSlots"];
  hotContracts: BlockProbe["hotContracts"];
} {
  const slotCount = new Map<string, number>();
  const contractCount = new Map<string, number>();
  for (const t of txs) {
    for (const s of t.reads) slotCount.set(s, (slotCount.get(s) ?? 0) + 1);
    for (const s of t.writes) slotCount.set(s, (slotCount.get(s) ?? 0) + 1);
    for (const c of t.contracts)
      contractCount.set(c, (contractCount.get(c) ?? 0) + 1);
  }

  // Per-slot conflict count: how many conflict edges include this slot
  const slotConflicts = new Map<string, number>();
  for (const e of conflicts) {
    for (const s of e.sharedSlots) {
      slotConflicts.set(s, (slotConflicts.get(s) ?? 0) + 1);
    }
  }

  const sortedSlots = [...slotCount.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);
  const maxTouches = sortedSlots.length > 0 ? sortedSlots[0][1] : 1;

  const hotSlots = sortedSlots.slice(0, 20).map(([key, touches]) => {
    const [contract, slot] = key.split(":") as [Hex, Hex];
    return {
      contract,
      slot,
      touches,
      conflictsCaused: slotConflicts.get(key) ?? 0,
      contention: maxTouches > 0 ? touches / maxTouches : 0,
    };
  });
  const hotContracts = [...contractCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([contract, touches]) => ({ contract: contract as Hex, touches }));
  return { hotSlots, hotContracts };
}

// ---------- public api ----------

export async function getLatestSafeBlockNumber(
  rpcUrl: string = DEFAULT_RPC,
): Promise<number> {
  const head = await rpc<Hex>(rpcUrl, "eth_blockNumber", []);
  return parseInt(head, 16) - FINALITY_LAG;
}

export async function probeBlock(
  blockNumber: number,
  rpcUrl: string = DEFAULT_RPC,
): Promise<BlockProbe> {
  const t0 = performance.now();
  const blockHex = toHex(blockNumber);

  // Three RPC calls in parallel:
  //   1. eth_getBlockByNumber                              , txs (+input → method selector)
  //   2. debug_traceBlockByNumber, prestateTracer diffMode:true  , state changes
  //                                                          (drives reads/writes/conflicts)
  //   3. debug_traceBlockByNumber, prestateTracer diffMode:false , full prestate of every
  //                                                          touched account (catches read-only
  //                                                          access that diffMode:true filters out)
  //
  // We tried callTracer here first because it's the canonical "what
  // contracts did this tx touch" tracer, but the Silk Nodes Monad RPC
  // rejects it with "Internal error: traces not found". prestateTracer
  // with diffMode:false works because we already use the same tracer
  // (different config) for the diffMode:true call above , supported
  // wherever diffMode:true is.
  //
  // Kill switch: `PEV_DISABLE_CALL_TRACER=1` skips call #3 and falls
  // back to diff-only behavior. (Env var name kept for backward compat
  // even though we're no longer using callTracer.)
  const disableFullPrestate = process.env.PEV_DISABLE_CALL_TRACER === "1";

  const [block, prestateTraces, fullPrestateTraces] = await Promise.all([
    // withTransactionData=true so each tx includes its `input` field;
    // we extract the first 4 bytes as the function selector.
    rpc<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [blockHex, true]),
    rpc<Array<{ result: PrestateDiff }>>(rpcUrl, "debug_traceBlockByNumber", [
      blockHex,
      { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
    ]),
    disableFullPrestate
      ? Promise.resolve(null)
      : rpc<Array<{ result: PrestateFull }>>(rpcUrl, "debug_traceBlockByNumber", [
          blockHex,
          { tracer: "prestateTracer", tracerConfig: { diffMode: false } },
        ]).catch((err: Error) => {
          // Tolerate RPC misbehavior. If the full-prestate call fails for
          // any reason we log once and keep going on prestateTracer-diff
          // data alone, same coverage as before this enrichment landed.
          console.warn(
            `[probe] full-prestate trace failed for block ${blockHex}: ${err.message}, ` +
              `falling back to diffMode-only`,
          );
          return null;
        }),
  ]);
  const t1 = performance.now();

  if (!block) throw new Error(`Block ${blockHex} not found`);
  if (!Array.isArray(prestateTraces))
    throw new Error(`Prestate trace did not return an array (got ${typeof prestateTraces})`);
  if (prestateTraces.length !== block.transactions.length) {
    throw new Error(
      `Prestate trace count ${prestateTraces.length} != tx count ${block.transactions.length}`,
    );
  }
  // Length mismatch on the full-prestate response is non-fatal; we use
  // diff-only data for that block. Keeps the indexer running through
  // reorgs or transient RPC inconsistency.
  let validFullPrestateTraces: Array<{ result: PrestateFull }> | null = null;
  if (fullPrestateTraces !== null) {
    if (!Array.isArray(fullPrestateTraces)) {
      console.warn(
        `[probe] full-prestate for block ${blockHex} did not return an array, skipping`,
      );
    } else if (fullPrestateTraces.length !== block.transactions.length) {
      console.warn(
        `[probe] full-prestate length mismatch for block ${blockHex}: got ${fullPrestateTraces.length} ` +
          `vs ${block.transactions.length} txs, skipping enrichment`,
      );
    } else {
      validFullPrestateTraces = fullPrestateTraces;
    }
  }

  const txAccesses: TxAccess[] = prestateTraces.map((t, i) =>
    extractAccess(
      t.result ?? { pre: {}, post: {} },
      validFullPrestateTraces?.[i]?.result ?? null,
      block.transactions[i].hash,
      i,
    ),
  );

  const conflicts = computeConflicts(txAccesses);
  const { waves, executionDepth } = assignWaves(txAccesses.length, conflicts);
  const { hotSlots, hotContracts } = computeHot(txAccesses, conflicts);

  // Per-tx inbound/outbound conflict counts
  const inbound = new Array(txAccesses.length).fill(0);
  const outbound = new Array(txAccesses.length).fill(0);
  for (const e of conflicts) {
    outbound[e.fromIdx]++;
    inbound[e.toIdx]++;
  }

  /** Pull the 4-byte selector from a tx's input. Returns null when the
   *  tx has empty input (plain ETH transfer) or input < 10 chars (no
   *  full selector). Always lowercase + 0x-prefixed. */
  const extractSelector = (rpcTx: RpcTx): Hex | null => {
    const input = rpcTx.input;
    if (!input || input === "0x" || input.length < 10) return null;
    return input.slice(0, 10).toLowerCase() as Hex;
  };

  const txs: TxSummary[] = txAccesses.map((t, i) => ({
    hash: t.hash,
    position: t.position,
    wave: waves[i],
    readCount: t.reads.size,
    writeCount: t.writes.size,
    contracts: [...t.contracts],
    inboundConflicts: inbound[i],
    outboundConflicts: outbound[i],
    selector: extractSelector(block.transactions[i]),
  }));

  const t2 = performance.now();

  return {
    blockNumber: parseInt(block.number, 16),
    blockHash: block.hash,
    timestamp: parseInt(block.timestamp, 16),
    txCount: txAccesses.length,
    statefulTxCount: txAccesses.filter(
      (t) => t.reads.size > 0 || t.writes.size > 0,
    ).length,
    parallelismFactor:
      executionDepth === 0
        ? 0
        : Number((txAccesses.length / executionDepth).toFixed(2)),
    executionDepth,
    txs,
    conflictCount: conflicts.length,
    topConflicts: conflicts.slice(0, 25),
    hotSlots,
    hotContracts,
    timing: {
      rpcMs: Math.round(t1 - t0),
      computeMs: Math.round(t2 - t1),
      totalMs: Math.round(t2 - t0),
    },
  };
}
