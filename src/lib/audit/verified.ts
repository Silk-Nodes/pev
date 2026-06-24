/**
 * verified.ts, hand-authored, source-backed analyses for contracts whose
 * verified source we've actually read. When present, the audit shows this
 * exact analysis (with a "verified source" badge) instead of the
 * automated, inferred diagnosis. This is the gold tier: the measured data
 * is the same, but the interpretation and the fix are grounded in real
 * source, not pattern inference.
 *
 * Honesty: every entry still states its residual uncertainty in
 * `confidence` (e.g. the exact mapping key behind a hashed slot isn't
 * reversed). We never claim more than the source + traces support.
 */

export interface VerifiedAnalysis {
  /** lowercase 0x address */
  address: string;
  name: string;
  /** short provenance line, e.g. "verified · solc 0.8.30 · UUPS" */
  source: string;
  /** one-line plain-language root cause */
  headline: string;
  /** what the hot slot actually is, from the storage layout */
  slotMeaning: string;
  /** how the contention happens, citing real functions */
  mechanism: string;
  fix: { title: string; rationale: string; before: string; after: string };
  /** residual uncertainty, stated plainly */
  confidence: string;
}

const ENTRIES: VerifiedAnalysis[] = [
  {
    address: "0x57cf97fe1fac7d78b07e7e0761410cb2e91f0ca7",
    name: "MarginAccount",
    source: "verified · solc 0.8.30 · UUPS · BUSL-1.1",
    headline:
      "Per-user balances already run in parallel. The contention is a shared accumulator in the balances mapping that nearly every trade writes.",
    slotMeaning:
      "The hot slot is an entry in the balances mapping (storage slot 1). Per-user keys, balances[user, token], are isolated and parallel-safe; the contended entry is a shared key written by a large fraction of all trades.",
    mechanism:
      "creditFee writes balances[accountKey(feeCollector, token)] += fee on every trade, so all concurrent trades write the same fee-sink entry and serialize on it. debitUser, creditUser, deposit and withdraw use per-user keys and already parallelize, they are not the problem. (A single dominant market-maker's own balance entry can be hot the same way.)",
    fix: {
      title: "Shard the fee accrual",
      rationale:
        "The fee sink is a single balances entry every trade writes, so trades serialize on it. Accrue fees into N rotating buckets per token and sweep to the fee collector periodically; concurrent trades hit different buckets and stop colliding, contention on that slot drops ~N-fold. Per-user balances need no change.",
      before: `// before: every trade writes the SAME fee entry, all trades serialize
function creditFee(address a, uint256 fa, address b, uint256 fb) external {
    balances[_accountKey(feeCollector, a)] += fa;   // <- hot slot
    balances[_accountKey(feeCollector, b)] += fb;   // <- hot slot
}`,
      after: `// after: accrue into rotating buckets, sweep to feeCollector later
uint256 constant FEE_SHARDS = 16;
uint256 private feeNonce;
mapping(bytes32 => uint256) private feeShard;   // key: hash(token, shard)

function creditFee(address a, uint256 fa, address b, uint256 fb) external {
    uint256 s = feeNonce++ % FEE_SHARDS;        // rotate buckets
    feeShard[keccak256(abi.encodePacked(a, s))] += fa;
    feeShard[keccak256(abi.encodePacked(b, s))] += fb;
}
// feeCollector claims sum(feeShard[token][0..15]) on a sweep`,
    },
    confidence:
      "Source-backed. The exact (user, token) behind the hashed slot isn't reversed, but the storage layout plus the access pattern make the shared balances accumulator (structurally the fee sink) the cause. The feeCollector address would confirm the exact slot.",
  },
];

const BY_ADDRESS = new Map(ENTRIES.map((e) => [e.address.toLowerCase(), e]));

export function getVerifiedAnalysis(address: string): VerifiedAnalysis | null {
  return BY_ADDRESS.get(address.toLowerCase()) ?? null;
}
