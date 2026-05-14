/**
 * probe-block.ts, Phase 1 feasibility spike for the Monad Parallel Execution Visualizer.
 *
 * For a given block number, this script:
 *   1. Fetches the block via eth_getBlockByNumber
 *   2. Calls debug_traceBlockByNumber with prestateTracer + diffMode
 *   3. Extracts read set + write set per transaction (per contract, per slot)
 *   4. Computes the pairwise conflict graph
 *      (tx_a conflicts with tx_b iff write_set(a) intersects read_set(b) ∪ write_set(b))
 *   5. Greedy lane assignment (theoretical max parallelism)
 *   6. Computes hot storage slots within the block
 *   7. Outputs a single structured JSON result
 *
 * Usage:
 *   npx tsx scripts/probe-block.ts                    # uses recent finalized block
 *   npx tsx scripts/probe-block.ts <blockNumber>      # decimal or 0x-prefixed hex
 *   npx tsx scripts/probe-block.ts --rpc <url>
 *   npx tsx scripts/probe-block.ts --pretty           # human summary instead of JSON
 *   npx tsx scripts/probe-block.ts --sample 50        # sample N recent blocks, summary only
 */

const DEFAULT_RPC = "https://rpc.silknodes.io/monad";
const FINALITY_LAG = 100; // blocks back from head when no block is specified

// ---------- types ----------

type Hex = string;

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

interface RpcBlock {
  number: Hex;
  hash: Hex;
  timestamp: Hex;
  transactions: Hex[];
}

/**
 * prestateTracer + diffMode response shape:
 *   {
 *     pre:  { [contract]: { storage?: { [slot]: value }, balance?, nonce?, code? } },
 *     post: { [contract]: { storage?: { [slot]: value }, ... } }
 *   }
 *
 * "pre"  = state read by the tx (what existed before)
 * "post" = state changed by the tx (what's different after)
 */
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

interface TxAccess {
  hash: Hex;
  position: number;
  /** "{contract}:{slot}", set of slots read */
  reads: Set<string>;
  /** "{contract}:{slot}", set of slots written */
  writes: Set<string>;
  contracts: Set<Hex>;
}

type ConflictKind = "write-write" | "read-write" | "mixed";

interface ConflictEdge {
  fromIdx: number;
  toIdx: number;
  fromHash: Hex;
  toHash: Hex;
  /** which "{contract}:{slot}" entries caused the conflict */
  sharedSlots: string[];
  kind: ConflictKind;
}

interface BlockProbe {
  blockNumber: number;
  blockHash: Hex;
  timestamp: number;
  txCount: number;
  /** number of txs that touched any storage (rest are simple transfers, trivially parallel) */
  statefulTxCount: number;
  /** theoretical max speedup: txCount / executionDepth (critical-path length) */
  parallelismFactor: number;
  /** number of sequential execution waves needed = critical-path length through the conflict DAG */
  executionDepth: number;
  /** wave assignment per tx index (0..executionDepth-1). Txs in the same wave run in parallel. */
  waves: number[];
  conflictCount: number;
  /** top conflict edges (capped to keep payload sane) */
  topConflicts: ConflictEdge[];
  /** "{contract}:{slot}" → number of txs touching it */
  hotSlots: Array<{ contract: Hex; slot: Hex; touches: number }>;
  /** how often each contract appears across txs in this block */
  hotContracts: Array<{ contract: Hex; touches: number }>;
  /** rpc + compute timing */
  timing: { rpcMs: number; computeMs: number; totalMs: number };
}

// ---------- rpc ----------

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} on ${method}`);
  const json = (await res.json()) as RpcResponse<T>;
  if (json.error) throw new Error(`RPC error on ${method}: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`RPC returned no result for ${method}`);
  return json.result;
}

async function getBlock(url: string, blockHex: Hex): Promise<RpcBlock> {
  return rpc<RpcBlock>(url, "eth_getBlockByNumber", [blockHex, false]);
}

async function traceBlock(url: string, blockHex: Hex): Promise<Array<{ result: PrestateDiff }>> {
  return rpc(url, "debug_traceBlockByNumber", [
    blockHex,
    { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
  ]);
}

// ---------- compute ----------

function extractAccess(diff: PrestateDiff, hash: Hex, position: number): TxAccess {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const contracts = new Set<Hex>();

  // pre = what was read (slots present in pre but unchanged are still reads)
  for (const [addr, acc] of Object.entries(diff.pre ?? {})) {
    contracts.add(addr);
    if (acc.storage) {
      for (const slot of Object.keys(acc.storage)) reads.add(`${addr}:${slot}`);
    }
  }
  // post = what was written (slot diff means it changed)
  for (const [addr, acc] of Object.entries(diff.post ?? {})) {
    contracts.add(addr);
    if (acc.storage) {
      for (const slot of Object.keys(acc.storage)) writes.add(`${addr}:${slot}`);
    }
  }

  return { hash, position, reads, writes, contracts };
}

/**
 * Compute the conflict DAG: tx_a (earlier) → tx_b (later) edge if they cannot
 * run in parallel. Conflict := write(a) ∩ (read(b) ∪ write(b)) ≠ ∅.
 *
 * Edges are directed earlier→later, matching transaction position in the block.
 */
function computeConflicts(txs: TxAccess[]): ConflictEdge[] {
  const edges: ConflictEdge[] = [];
  for (let i = 0; i < txs.length; i++) {
    const a = txs[i];
    if (a.writes.size === 0) continue; // pure reader: cannot conflict-cause anyone after
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

/**
 * Compute the wave assignment over the conflict DAG.
 * Each tx is placed in the earliest wave (round) such that no earlier-conflicting
 * tx is in the same wave. wave[i] = 1 + max(wave[j] for j in blockedBy[i]).
 * executionDepth = max(wave) + 1 = critical-path length through the DAG.
 *
 * Interpretation: txs sharing a wave can run in parallel. Total waves =
 * minimum sequential rounds needed = how slow this block is *forced* to be.
 */
function assignWaves(txCount: number, conflicts: ConflictEdge[]): { waves: number[]; executionDepth: number } {
  // For each tx, list of earlier txs it conflicts with
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

function computeHotSlots(txs: TxAccess[]): { hotSlots: BlockProbe["hotSlots"]; hotContracts: BlockProbe["hotContracts"] } {
  const slotCount = new Map<string, number>();
  const contractCount = new Map<string, number>();
  for (const t of txs) {
    for (const s of t.reads) slotCount.set(s, (slotCount.get(s) ?? 0) + 1);
    for (const s of t.writes) slotCount.set(s, (slotCount.get(s) ?? 0) + 1);
    for (const c of t.contracts) contractCount.set(c, (contractCount.get(c) ?? 0) + 1);
  }
  const hotSlots = [...slotCount.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, touches]) => {
      const [contract, slot] = key.split(":") as [Hex, Hex];
      return { contract, slot, touches };
    });
  const hotContracts = [...contractCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([contract, touches]) => ({ contract: contract as Hex, touches }));
  return { hotSlots, hotContracts };
}

// ---------- orchestration ----------

async function probeBlock(rpcUrl: string, blockHex: Hex): Promise<BlockProbe> {
  const t0 = performance.now();
  const [block, traces] = await Promise.all([getBlock(rpcUrl, blockHex), traceBlock(rpcUrl, blockHex)]);
  const t1 = performance.now();

  if (!block) throw new Error(`Block ${blockHex} not found`);
  if (!Array.isArray(traces)) throw new Error(`Trace did not return an array (got ${typeof traces})`);
  if (traces.length !== block.transactions.length) {
    throw new Error(
      `Trace count ${traces.length} != tx count ${block.transactions.length} for block ${blockHex}`,
    );
  }

  const txs: TxAccess[] = traces.map((t, i) => extractAccess(t.result ?? { pre: {}, post: {} }, block.transactions[i], i));

  const conflicts = computeConflicts(txs);
  const { waves, executionDepth } = assignWaves(txs.length, conflicts);
  const { hotSlots, hotContracts } = computeHotSlots(txs);
  const t2 = performance.now();

  const statefulTxCount = txs.filter((t) => t.reads.size > 0 || t.writes.size > 0).length;

  const blockNumber = parseInt(block.number, 16);
  const timestamp = parseInt(block.timestamp, 16);

  return {
    blockNumber,
    blockHash: block.hash,
    timestamp,
    txCount: txs.length,
    statefulTxCount,
    parallelismFactor: executionDepth === 0 ? 0 : Number((txs.length / executionDepth).toFixed(2)),
    executionDepth,
    waves,
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

// ---------- cli ----------

interface Args {
  rpc: string;
  blockArg: string | null;
  pretty: boolean;
  sampleN: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { rpc: DEFAULT_RPC, blockArg: null, pretty: false, sampleN: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rpc") args.rpc = argv[++i];
    else if (a === "--pretty") args.pretty = true;
    else if (a === "--sample") args.sampleN = parseInt(argv[++i], 10);
    else if (!a.startsWith("--")) args.blockArg = a;
  }
  return args;
}

function toHex(n: number): Hex {
  return "0x" + n.toString(16);
}

function formatPretty(p: BlockProbe): string {
  const lines: string[] = [];
  lines.push(`Block ${p.blockNumber.toLocaleString()}  (${p.blockHash})`);
  lines.push(`  ${p.txCount} txs, ${p.statefulTxCount} stateful`);
  lines.push(`  parallelism factor: ${p.parallelismFactor}× (depth ${p.executionDepth})`);
  lines.push(`  conflicts: ${p.conflictCount}`);
  if (p.hotContracts.length) {
    lines.push(`  top contracts:`);
    for (const c of p.hotContracts.slice(0, 5)) {
      lines.push(`    ${c.contract}  ×${c.touches}`);
    }
  }
  if (p.hotSlots.length) {
    lines.push(`  top hot slots:`);
    for (const s of p.hotSlots.slice(0, 5)) {
      lines.push(`    ${s.contract} :: ${s.slot.slice(0, 18)}…  ×${s.touches}`);
    }
  }
  lines.push(`  timing: rpc ${p.timing.rpcMs}ms · compute ${p.timing.computeMs}ms · total ${p.timing.totalMs}ms`);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resolve target block
  let targetBlock: number;
  if (args.blockArg) {
    targetBlock = args.blockArg.startsWith("0x") ? parseInt(args.blockArg, 16) : parseInt(args.blockArg, 10);
  } else {
    const headHex = await rpc<Hex>(args.rpc, "eth_blockNumber", []);
    targetBlock = parseInt(headHex, 16) - FINALITY_LAG;
  }

  if (args.sampleN && args.sampleN > 0) {
    const stats: BlockProbe[] = [];
    const errors: Array<{ block: number; error: string }> = [];
    for (let i = 0; i < args.sampleN; i++) {
      const n = targetBlock - i;
      try {
        const p = await probeBlock(args.rpc, toHex(n));
        stats.push(p);
        process.stderr.write(`  ${i + 1}/${args.sampleN}  block ${n}  ${p.parallelismFactor}× depth=${p.executionDepth}  ${p.txCount}tx  conf=${p.conflictCount}  ${p.timing.totalMs}ms\n`);
      } catch (e) {
        errors.push({ block: n, error: (e as Error).message });
        process.stderr.write(`  ${i + 1}/${args.sampleN}  block ${n}  ERROR ${(e as Error).message}\n`);
      }
    }
    const validStats = stats.filter((s) => s.txCount > 0);
    const summary = {
      sampled: stats.length,
      withTxs: validStats.length,
      errors: errors.length,
      avgParallelismFactor: validStats.length
        ? Number((validStats.reduce((s, p) => s + p.parallelismFactor, 0) / validStats.length).toFixed(2))
        : 0,
      avgTxsPerBlock: validStats.length
        ? Number((validStats.reduce((s, p) => s + p.txCount, 0) / validStats.length).toFixed(1))
        : 0,
      avgConflicts: validStats.length
        ? Number((validStats.reduce((s, p) => s + p.conflictCount, 0) / validStats.length).toFixed(1))
        : 0,
      maxParallelismFactor: validStats.length ? Math.max(...validStats.map((p) => p.parallelismFactor)) : 0,
      minParallelismFactor: validStats.length ? Math.min(...validStats.map((p) => p.parallelismFactor)) : 0,
      avgRpcMs: validStats.length
        ? Math.round(validStats.reduce((s, p) => s + p.timing.rpcMs, 0) / validStats.length)
        : 0,
      avgComputeMs: validStats.length
        ? Math.round(validStats.reduce((s, p) => s + p.timing.computeMs, 0) / validStats.length)
        : 0,
    };
    console.log(JSON.stringify({ summary, errors: errors.slice(0, 5) }, null, 2));
    return;
  }

  const probe = await probeBlock(args.rpc, toHex(targetBlock));

  if (args.pretty) {
    console.log(formatPretty(probe));
  } else {
    // Replace Set instances aren't here, already converted. Stringify directly.
    console.log(JSON.stringify(probe, null, 2));
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
