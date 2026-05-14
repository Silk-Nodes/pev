/**
 * enrich-pev.ts, server-only helper that mutates a PEVData with
 * resolved method names + primary-contract names.
 *
 * SPLIT OUT FROM probe-to-pev.ts because the enrichment library imports
 * `pg` (Postgres client), which can't be bundled for the browser. Client
 * components import probe-to-pev (for types + shortHex); they must NOT
 * transitively depend on `pg` or any node-only module.
 *
 * Use only in server components, route handlers, and scripts.
 */

import { resolveManyMethods, resolveManyContracts } from "./enrichment";
import type { PEVData } from "./probe-to-pev";
import type { Hex } from "./parallel-probe";

/**
 * Resolve all unique selectors + primary contract addresses in a PEVData,
 * mutating each tx with `method` and `contractName`. Returns the same
 * object for convenience.
 *
 * Cost on a typical block:
 *   • Cache hits only: 1 DB query + ~5ms
 *   • Cold cache (rare): up to ~1s if many unverified contracts
 *     (Sourcify concurrency is capped at 8). 4byte is faster.
 */
export async function enrichPEVData(pev: PEVData): Promise<PEVData> {
  const selectors = pev.txs
    .map((t) => t.selector)
    .filter((s): s is Hex => !!s);
  // Use the first contract per tx as the "primary" contract for label
  // purposes (the one shown in the contractName slot). This matches what
  // explorers do.
  const primaryContracts = pev.txs
    .map((t) => t.contracts[0])
    .filter((c): c is Hex => !!c);

  const [methodMap, contractMap] = await Promise.all([
    selectors.length > 0
      ? resolveManyMethods(selectors)
      : Promise.resolve(new Map<string, string | null>()),
    primaryContracts.length > 0
      ? resolveManyContracts(primaryContracts)
      : Promise.resolve(new Map<string, string | null>()),
  ]);

  for (const tx of pev.txs) {
    if (tx.selector) {
      tx.method = methodMap.get(tx.selector.toLowerCase()) ?? null;
    }
    const primary = tx.contracts[0]?.toLowerCase();
    if (primary) {
      tx.contractName = contractMap.get(primary) ?? null;
    }
  }

  // CRITICAL: pev.waveTxs is a SEPARATE COPY of the tx objects (JSON
  // serialization in the indexer broke the reference equality between
  // pev.txs[i] and pev.waveTxs[wave][n]). The Timeline iterates waveTxs,
  // not txs, so we have to either (a) mutate the wave copies too or
  // (b) rebuild waveTxs from the now-enriched txs.
  //
  // We pick (b): rebuild waveTxs by referencing the already-enriched
  // pev.txs objects. Same shape, but every wave entry is now the same
  // reference as its corresponding txs entry, so future mutations
  // would also propagate.
  const waveCount = pev.waveTxs.length;
  pev.waveTxs = Array.from({ length: waveCount }, () => [] as typeof pev.txs);
  for (const tx of pev.txs) {
    if (tx.wave >= 0 && tx.wave < waveCount) {
      pev.waveTxs[tx.wave].push(tx);
    }
  }

  return pev;
}
