/**
 * sourcify.ts, fetch verified ABI + storage layout for a Monad contract and
 * resolve method selectors and storage slots to human names.
 *
 * Source: Monad verifications live on BlockVision's Sourcify instance (the
 * one the Monad explorer uses), not the public sourcify.dev. No API key.
 *   GET https://sourcify-api-monad.blockvision.org/v2/contract/143/{addr}
 *       ?fields=abi,storageLayout
 *
 * Used ONLY by the audit precompute (a single off-peak network call per
 * contract, result baked into the cached audit payload). Never called on a
 * page request.
 */

import { keccak256 } from "js-sha3";

const ENDPOINT = "https://sourcify-api-monad.blockvision.org/v2/contract/143";

interface AbiInput {
  name?: string;
  type: string;
  components?: AbiInput[];
}
interface AbiItem {
  type: string;
  name?: string;
  inputs?: AbiInput[];
}
interface StorageEntry {
  label: string;
  slot: string; // decimal string
  offset: number;
  type: string;
}
interface StorageLayout {
  storage: StorageEntry[];
  types?: Record<string, { label?: string; encoding?: string }>;
}
export interface VerifiedMeta {
  abi: AbiItem[];
  storageLayout: StorageLayout | null;
}

/** EIP-55 checksum, the Sourcify path wants a checksummed address. */
function toChecksum(address: string): string {
  const a = address.toLowerCase().replace(/^0x/, "");
  const h = keccak256(a);
  let out = "0x";
  for (let i = 0; i < a.length; i++) {
    out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  }
  return out;
}

/** Canonical type string for a selector (recurses into tuples). */
function canonicalType(i: AbiInput): string {
  if (i.type.startsWith("tuple")) {
    const inner = (i.components ?? []).map(canonicalType).join(",");
    return `(${inner})${i.type.slice("tuple".length)}`; // keep [] / [n] suffix
  }
  return i.type;
}

function selectorOf(fn: AbiItem): string {
  const sig = `${fn.name}(${(fn.inputs ?? []).map(canonicalType).join(",")})`;
  return "0x" + keccak256(sig).slice(0, 8);
}

/** Fetch verified ABI + storage layout, or null if unverified / unreachable. */
export async function fetchVerifiedMeta(address: string): Promise<VerifiedMeta | null> {
  try {
    const res = await fetch(
      `${ENDPOINT}/${toChecksum(address)}?fields=abi,storageLayout`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const abi = (j.abi ?? (j.output as Record<string, unknown>)?.abi) as AbiItem[] | undefined;
    if (!Array.isArray(abi)) return null;
    const storageLayout =
      (j.storageLayout ?? (j.output as Record<string, unknown>)?.storageLayout) as StorageLayout | undefined;
    return { abi, storageLayout: storageLayout ?? null };
  } catch {
    return null;
  }
}

/** selector (0x........) -> function name, e.g. "0x0c7abd22" -> "creditFee". */
export function buildSelectorMap(abi: AbiItem[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const item of abi) {
    if (item.type === "function" && item.name) {
      m.set(selectorOf(item).toLowerCase(), item.name);
    }
  }
  return m;
}

/**
 * Resolve a storage slot to its variable name. Scalars (low slot indices)
 * map exactly; hashed mapping/array slots won't match a layout slot, so
 * those return null here (the mapping labels are surfaced separately).
 */
export function resolveScalarSlot(
  layout: StorageLayout,
  slotHex: string,
): string | null {
  let n: bigint;
  try {
    n = BigInt(slotHex);
  } catch {
    return null;
  }
  for (const e of layout.storage) {
    try {
      if (BigInt(e.slot) === n) return e.label;
    } catch {
      /* skip malformed slot */
    }
  }
  return null;
}

/** Names of the contract's mapping variables (for naming hashed hot slots). */
export function mappingLabels(layout: StorageLayout): string[] {
  return layout.storage
    .filter((e) => layout.types?.[e.type]?.encoding === "mapping" || e.type.includes("mapping"))
    .map((e) => e.label);
}

/**
 * Resolve 4-byte selectors to function names via the openchain.xyz public
 * signature database. Needed because the audit's measured selectors are the
 * transaction's ENTRY method, which for an internally-called contract (a
 * shared ledger like MarginAccount) belongs to the caller, not the audited
 * contract, so the contract's own ABI can't name them. Best-effort: returns
 * the bare function name, may be approximate (collisions), empty on failure.
 */
export async function fetchSelectorNames(selectors: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(selectors.map((s) => s.toLowerCase()))].filter((s) => /^0x[0-9a-f]{8}$/.test(s));
  if (!uniq.length) return out;
  try {
    const res = await fetch(
      `https://api.openchain.xyz/signature-database/v1/lookup?function=${uniq.join(",")}&filter=true`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return out;
    const j = (await res.json()) as { result?: { function?: Record<string, { name?: string }[] | null> } };
    const fns = j.result?.function ?? {};
    for (const sel of uniq) {
      const hit = fns[sel];
      if (Array.isArray(hit) && hit[0]?.name) {
        out.set(sel, String(hit[0].name).split("(")[0]); // bare name, drop the params
      }
    }
  } catch {
    /* best-effort */
  }
  return out;
}
