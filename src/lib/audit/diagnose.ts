/**
 * diagnose.ts, pure interpretation of a ContractAudit into a root-cause
 * and a concrete fix. Deliberately separate from the cached data so we
 * can tune the wording and the recommended patterns WITHOUT re-running
 * the precompute against the DB.
 *
 * Honesty rules baked in:
 *   • We name the slot (0x…) and its measured access pattern. We do NOT
 *     claim to know the variable name (that needs the contract's verified
 *     storage layout), so copy says "looks like / consistent with".
 *   • The fix is a labelled PATTERN for the detected anti-pattern, never
 *     a claim that we rewrote the team's code.
 */

import type { ContractAudit } from "@/lib/indexer/store";

export type FixPatternId = "shared-write" | "stale-read" | "generic";

export interface Diagnosis {
  /** one-line plain-language summary of the problem */
  headline: string;
  /** the dominant conflict kind we observed, or null if not sampled */
  dominantKind: string | null;
  hottestSlot: string | null;
  hottestSlotConflicts: number | null;
  topMethod: string | null;
  pattern: FixPatternId;
  fix: {
    title: string;
    /** why this fix addresses the observed pattern */
    rationale: string;
    before: string;
    after: string;
  };
}

const FIXES: Record<FixPatternId, Diagnosis["fix"]> = {
  "shared-write": {
    title: "Shard the hot slot",
    rationale:
      "Write-write contention means two transactions wrote the same storage slot, so Monad had to run them one after another. Splitting that one slot into N independent shards lets unrelated writers stop colliding, contention on it drops roughly N-fold.",
    before: `// before: every tx writes the same slot, forced serial
uint256 public total;

function record(uint256 amt) external {
    total += amt;            // <- the hot slot, all writers collide here
}`,
    after: `// after: writers hit independent shards, run in parallel
mapping(uint256 => uint256) private totalShard;
uint256 constant SHARDS = 16;

function record(uint256 amt) external {
    totalShard[uint256(uint160(msg.sender)) % SHARDS] += amt;
}
// read total = sum(totalShard[0..SHARDS-1]) when you actually need it`,
  },
  "stale-read": {
    title: "Read a snapshot, not the live slot",
    rationale:
      "Read-write contention means a transaction read a slot that a concurrent transaction was writing, forcing a re-run. If the read doesn't truly need the very latest value, serve it from a periodic snapshot so it leaves the conflict set entirely.",
    before: `// before: read collides with concurrent writers
uint256 public liveIndex;

function quote() external view returns (uint256) {
    return liveIndex;        // <- read races every writer of liveIndex
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
      "The contention concentrates on a small number of storage slots. Moving that shared state so independent users touch independent slots (per-account balances, sharded counters, snapshotted reads) is the highest-leverage change.",
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

  let pattern: FixPatternId = "generic";
  if (dominantKind?.includes("write-write")) pattern = "shared-write";
  else if (dominantKind?.includes("read-write")) pattern = "stale-read";

  const headline =
    pattern === "shared-write"
      ? "One storage slot is being written by many transactions at once, forcing them to run one at a time."
      : pattern === "stale-read"
        ? "Reads on a hot slot keep colliding with concurrent writes, forcing re-execution."
        : "Contention concentrates on a few shared storage slots that independent users keep hitting together.";

  return {
    headline,
    dominantKind,
    hottestSlot: top?.slot ?? null,
    hottestSlotConflicts: top?.conflicts ?? null,
    topMethod,
    pattern,
    fix: FIXES[pattern],
  };
}
