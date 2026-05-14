/**
 * probe-to-pev.ts, adapter from our real BlockProbe (parallel-probe.ts)
 * to the data shape consumed by the Editorial visualization components.
 *
 * Honest data adaptations (decided in design review):
 *
 *   1. NO physical "threads/lanes". The original design (variation-a.jsx)
 *      grouped txs by physical CPU thread. Monad's RPC doesn't expose that.
 *      We group by **wave** instead, wave N = txs that must wait for at
 *      least one wave-(N-1) tx. Same horizontal-row visualization, but
 *      semantically accurate.
 *
 *   2. NO ms timing. The X-axis in the original was real time. We don't
 *      have it. Instead each wave row contains its txs side-by-side at
 *      equal width. The width metaphor becomes "fraction of this wave's
 *      capacity", wide cells = lots of parallelism, narrow = bottleneck.
 *
 *   3. NO "re-executed" status with retry counts. We can't measure how
 *      many times Monad's scheduler re-ran a tx. We replace the diagonal
 *      stripe pattern with "conflict source" semantics: stripes mean
 *      "this tx wrote a slot that later txs needed → it blocked others".
 *
 *   4. NO method/contract decoding for v1. Show short hex; wire 4byte +
 *      Sourcify in a follow-up.
 *
 * Status taxonomy (per-tx):
 *   - "clean":   wave === 0 AND outboundConflicts === 0
 *                → ran first, blocked nobody. Best citizen.
 *   - "source":  outboundConflicts > 0
 *                → wrote slots that later txs needed. Caused serialization.
 *                Renders with the stripe pattern (same visual as old "reexec").
 *   - "delayed": wave > 0 AND outboundConflicts === 0
 *                → had to wait, but didn't cascade further.
 *
 * A tx in wave > 0 that ALSO has outbound conflicts is "source", the
 * stripe pattern dominates because that's the more important fact.
 */

import type { BlockProbe, ConflictKind, Hex } from "./parallel-probe";

export type PEVStatus = "clean" | "delayed" | "source";

export interface PEVTx {
  id: string; // "tx0", "tx1"..., used as React keys + selection IDs
  hash: Hex;
  position: number;
  wave: number;
  status: PEVStatus;
  contracts: Hex[];
  readCount: number;
  writeCount: number;
  inboundConflicts: number;
  outboundConflicts: number;
  /** 4-byte function selector ("0xa9059cbb"); null for plain ETH transfers */
  selector: Hex | null;
  /** Resolved method name (e.g. "transfer(address,uint256)") when known.
   *  Filled in by the server-side enrichment step on the block page;
   *  absent on raw probes. UI falls back to selector hex or short hash. */
  method?: string | null;
  /** Resolved primary-contract name (e.g. "wmonUSDC Pool") when known.
   *  Filled by enrichment; absent on raw probes. UI falls back to
   *  contractLabel (short hex). */
  contractName?: string | null;
  /** display label, short hash, used as a hex fallback in the UI */
  label: string;
  /** display contract label, first contract address shortened */
  contractLabel: string;
}

export interface PEVConflict {
  fromId: string;
  toId: string;
  fromIdx: number;
  toIdx: number;
  /** "{contract}:{slot}" pairs that caused the conflict */
  sharedSlots: string[];
  kind: ConflictKind;
}

export interface PEVHotSlot {
  contract: Hex;
  slot: Hex;
  touches: number;
  conflictsCaused: number;
  contention: number; // 0..1
  /** display label, for now `shortHex(slot)` */
  label: string;
  /** display contract label, for now `shortHex(contract)` */
  contractLabel: string;
}

export interface PEVSummary {
  block: number;
  blockHash: Hex;
  timestamp: number;
  txCount: number;
  statefulTxCount: number;
  /** 0..100, derived from parallelism factor */
  parallelismScore: number;
  /** factor from the probe (txCount / executionDepth) */
  parallelismFactor: number;
  /** % of stateful txs that were forced to wait (wave > 0) */
  blockedPct: number;
  /** average outbound-conflict count per tx (proxy for "how much serialization did each tx cause") */
  avgConflictsPerTx: number;
  /** longest wait chain (= executionDepth) */
  longestChain: number;
  /** number of execution waves (alias for executionDepth, kept for UI clarity) */
  waves: number;
  conflictCount: number;
  hotSlotCount: number;
}

export interface PEVData {
  query: { kind: "block"; value: string; label: string };
  summary: PEVSummary;
  txs: PEVTx[];
  conflicts: PEVConflict[];
  hotSlots: PEVHotSlot[];
  /** txs grouped by wave for the gantt visualization (wave index → ordered tx list) */
  waveTxs: PEVTx[][];
  hotContracts: Array<{ contract: Hex; touches: number; label: string }>;
}

// ---------- helpers ----------

export function shortHex(h: string, headChars = 6, tailChars = 4): string {
  if (h.length <= 2 + headChars + tailChars) return h;
  return h.slice(0, 2 + headChars) + "…" + h.slice(-tailChars);
}

function deriveStatus(wave: number, outbound: number): PEVStatus {
  if (outbound > 0) return "source";
  if (wave > 0) return "delayed";
  return "clean";
}

/**
 * Map a 0..N parallelism factor to a 0..100 score. Logarithmic-ish so that
 * a block doing 4× already feels "great" without forcing 10× to mean only 50.
 *   factor 1   → 0    (fully serial)
 *   factor 2   → 50
 *   factor 4   → 75
 *   factor 8   → 87
 *   factor 16+ → ~94
 */
function parallelismToScore(factor: number): number {
  if (factor <= 1) return 0;
  // 100 * (1 - 1/factor) gives a smooth asymptote at 100
  return Math.round(100 * (1 - 1 / factor));
}

// ---------- main adapter ----------

export function probeToPEV(probe: BlockProbe): PEVData {
  // Build PEVTx[] in source order. Status uses outbound to mark "source"
  // (which renders striped, the visual that means "blocks others").
  const txs: PEVTx[] = probe.txs.map((t, i) => {
    const status = deriveStatus(t.wave, t.outboundConflicts);
    return {
      id: `tx${i}`,
      hash: t.hash,
      position: t.position,
      wave: t.wave,
      status,
      contracts: t.contracts,
      readCount: t.readCount,
      writeCount: t.writeCount,
      inboundConflicts: t.inboundConflicts,
      outboundConflicts: t.outboundConflicts,
      selector: t.selector ?? null,
      label: shortHex(t.hash, 6, 4),
      contractLabel: t.contracts.length > 0 ? shortHex(t.contracts[0], 6, 4) : "-",
    };
  });

  // Group txs by wave for the gantt rows
  const waves = Math.max(probe.executionDepth, 1);
  const waveTxs: PEVTx[][] = Array.from({ length: waves }, () => []);
  for (const tx of txs) waveTxs[tx.wave].push(tx);

  // Conflicts → PEV conflicts (with stable string IDs)
  const conflicts: PEVConflict[] = probe.topConflicts.map((c) => ({
    fromId: `tx${c.fromIdx}`,
    toId: `tx${c.toIdx}`,
    fromIdx: c.fromIdx,
    toIdx: c.toIdx,
    sharedSlots: c.sharedSlots,
    kind: c.kind,
  }));

  // Hot slots already include contention + conflictsCaused from the probe
  const hotSlots: PEVHotSlot[] = probe.hotSlots.map((s) => ({
    contract: s.contract,
    slot: s.slot,
    touches: s.touches,
    conflictsCaused: s.conflictsCaused,
    contention: s.contention,
    label: shortHex(s.slot, 8, 4),
    contractLabel: shortHex(s.contract, 6, 4),
  }));

  const hotContracts = probe.hotContracts.map((c) => ({
    contract: c.contract,
    touches: c.touches,
    label: shortHex(c.contract, 6, 4),
  }));

  // Derived summary metrics, all honestly computed
  const stateful = probe.statefulTxCount;
  const blockedCount = txs.filter((t) => t.wave > 0).length;
  const blockedPct = stateful > 0 ? Math.round((blockedCount / stateful) * 100) : 0;
  const totalOutbound = txs.reduce((s, t) => s + t.outboundConflicts, 0);
  const avgConflictsPerTx = txs.length > 0 ? Number((totalOutbound / txs.length).toFixed(2)) : 0;

  const summary: PEVSummary = {
    block: probe.blockNumber,
    blockHash: probe.blockHash,
    timestamp: probe.timestamp,
    txCount: probe.txCount,
    statefulTxCount: probe.statefulTxCount,
    parallelismScore: parallelismToScore(probe.parallelismFactor),
    parallelismFactor: probe.parallelismFactor,
    blockedPct,
    avgConflictsPerTx,
    longestChain: probe.executionDepth,
    waves: probe.executionDepth,
    conflictCount: probe.conflictCount,
    hotSlotCount: probe.hotSlots.length,
  };

  return {
    query: {
      kind: "block",
      value: probe.blockHash,
      label: `Block #${probe.blockNumber.toLocaleString()}`,
    },
    summary,
    txs,
    conflicts,
    hotSlots,
    waveTxs,
    hotContracts,
  };
}

// Note: server-side enrichment helper (resolves method + contract names
// against Postgres caches + outbound API) is in `./enrich-pev.ts`. Kept
// out of this file because client components import probe-to-pev for
// types + shortHex, and pulling the enrichment lib would drag the `pg`
// client into the browser bundle.
//
// Server callers:  import { enrichPEVData } from "@/lib/enrich-pev";
