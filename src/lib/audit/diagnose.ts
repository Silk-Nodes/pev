/**
 * diagnose.ts, pure interpretation of a ContractAudit into a root-cause and
 * a fix DIRECTION. Kept separate from the cached data so we can tune the
 * reasoning without re-running the precompute.
 *
 * Honesty rules baked in:
 *   • Measured facts (slot, kind, method, the slot's own conflict count)
 *     are stated plainly.
 *   • What the slot HOLDS is inferred from its shape (scalar vs hashed
 *     mapping/array key), so copy says "looks like".
 *   • The fix is the standard remedy for the measured pattern, a
 *     DIRECTION, not a claim we rewrote the contract. The exact change
 *     needs the contract's source.
 *   • Impact ("recoverable re-executions") is the hot slot's own measured
 *     conflict count, framed as an upper bound ("up to"), never invented.
 */

import type { ContractAudit } from "@/lib/indexer/store";

export type FixPatternId = "shard-scalar" | "shard-mapping" | "snapshot" | "generic";

export interface Diagnosis {
  headline: string;
  dominantKind: string | null;
  hottestSlot: string | null;
  hottestSlotConflicts: number | null;
  /** inferred from the slot's shape, not measured */
  slotRole: string;
  topMethod: string | null;
  /** measured re-executions attributable to the hottest slot (upper bound recoverable) */
  recoverable: number | null;
  pattern: FixPatternId;
  fix: {
    title: string;
    rationale: string;
    before: string;
    after: string;
  };
}

/**
 * A plain state variable lives at a small slot index (slot 0, 1, 2 …), so
 * its 32-byte key is almost all leading zeros. A mapping/array element
 * lives at a keccak hash, no leading zeros. This lets us tell "one global
 * variable" from "one entry in a mapping" without the source.
 */
function isHashedSlot(slot: string | null): boolean {
  if (!slot) return false;
  const h = slot.replace(/^0x/, "").padStart(64, "0");
  const leadingZeroNibbles = h.length - h.replace(/^0+/, "").length;
  // A real mapping/array hash essentially never has 40+ leading zero
  // nibbles; a declaration-order scalar slot always does.
  return leadingZeroNibbles < 40;
}

const FIXES: Record<FixPatternId, Diagnosis["fix"]> = {
  "shard-scalar": {
    title: "Shard the global counter",
    rationale:
      "This is a single global variable that many transactions write, so they serialize on it. Split it into N independent shards and unrelated writers stop colliding, contention on it drops roughly N-fold.",
    before: `// before: every tx writes one global slot, forced serial
uint256 public total;

function record(uint256 amt) external {
    total += amt;            // <- the hot slot, all writers collide
}`,
    after: `// after: writers hit independent shards, run in parallel
mapping(uint256 => uint256) private totalShard;
uint256 constant SHARDS = 16;

function record(uint256 amt) external {
    totalShard[uint256(uint160(msg.sender)) % SHARDS] += amt;
}
// total = sum(totalShard[0..SHARDS-1]) only when you actually read it`,
  },
  "shard-mapping": {
    title: "Split the hot entry's contended field",
    rationale:
      "The hotspot is one entry in a mapping or array, a single shared resource (a market, pool, or account) that many transactions update together, so they serialize on it. If the contended field is an aggregate (a running total, a fill amount, a counter), split that field into per-entry buckets so concurrent actors stop colliding on the same word.",
    before: `// before: everyone acting on this entry collides on one field
mapping(uint256 => Market) markets;

function execute(uint256 id, uint256 amt) external {
    markets[id].fillTotal += amt;   // <- hot: all actors on \`id\` collide
}`,
    after: `// after: bucket the hot field so concurrent fills don't collide
mapping(uint256 => mapping(uint16 => uint256)) private fillShard;

function execute(uint256 id, uint256 amt) external {
    fillShard[id][uint16(uint160(msg.sender)) & 0x0F] += amt; // 16 buckets
}
// fillTotal(id) = sum(fillShard[id][0..15]) on read`,
  },
  snapshot: {
    title: "Read a snapshot, not the live slot",
    rationale:
      "Read-write contention means a transaction read a slot that a concurrent transaction was writing, forcing a re-run. If the read doesn't need the very latest value, serve it from a periodic checkpoint so it leaves the conflict set entirely.",
    before: `// before: read collides with concurrent writers
uint256 public liveIndex;

function quote() external view returns (uint256) {
    return liveIndex;        // <- races every writer of liveIndex
}`,
    after: `// after: read a frozen checkpoint, no write conflict
mapping(uint256 => uint256) private indexAt;  // epoch => value

function quote(uint256 epoch) external view returns (uint256) {
    return indexAt[epoch];   // immutable once written, never contended
}`,
  },
  generic: {
    title: "Isolate the contended state",
    rationale:
      "Contention concentrates on a small number of storage slots. Moving that shared state so independent users touch independent slots (per-account balances, sharded counters, snapshotted reads) is the highest-leverage change.",
    before: `// before: shared mutable state on a hot path
uint256 public sharedState;`,
    after: `// after: per-actor state, no cross-user collision
mapping(address => uint256) private stateOf;`,
  },
};

export function diagnose(audit: ContractAudit): Diagnosis {
  const top = audit.hotSlots[0] ?? null;
  const topMethod = audit.methods[0]?.selector ?? null;
  const dominantKind = audit.kinds[0]?.kind ?? null;
  const hashed = isHashedSlot(top?.slot ?? null);

  const slotRole = top
    ? hashed
      ? "looks like one entry in a mapping or array, a specific shared resource (a market, pool, or account)"
      : "looks like a single global state variable (a counter, total, or shared accumulator)"
    : "no dominant slot in this window";

  let pattern: FixPatternId;
  if (dominantKind?.includes("read-write")) {
    pattern = "snapshot";
  } else if (dominantKind?.includes("write-write")) {
    pattern = hashed ? "shard-mapping" : "shard-scalar";
  } else if (top) {
    pattern = hashed ? "shard-mapping" : "shard-scalar";
  } else {
    pattern = "generic";
  }

  const headline =
    pattern === "snapshot"
      ? "Reads on a hot slot keep colliding with concurrent writes, forcing transactions to re-run."
      : hashed
        ? "One shared entry is updated by many transactions at once, so they serialize on it instead of running in parallel."
        : "One global storage slot is written by many transactions at once, forcing them to run one at a time.";

  return {
    headline,
    dominantKind,
    hottestSlot: top?.slot ?? null,
    hottestSlotConflicts: top?.conflicts ?? null,
    slotRole,
    topMethod,
    recoverable: top?.conflicts ?? null,
    pattern,
    fix: FIXES[pattern],
  };
}
