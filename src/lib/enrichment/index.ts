/**
 * enrichment/index.ts, human-readable labels for Monad contracts + methods.
 *
 * Two resolvers, both with persistent (Postgres) cache:
 *   • resolveMethod(selector)   → "transfer(address,uint256)"  (via 4byte directory)
 *   • resolveContract(address)  → "wmonUSDC Pool"               (via Sourcify)
 *
 * Bulk variants (`resolveManyMethods`, `resolveManyContracts`) return a Map
 *, used by block + tx pages to enrich N items in one round trip.
 *
 * Cache strategy:
 *   • Successful resolution: written to DB once, read forever (selectors
 *     are immutable; contract names are extremely stable).
 *   • Failed resolution: written with `negative_until = NOW() + 1h` so we
 *     don't hammer the upstream APIs on every page view.
 *   • Process-local Map for the request lifetime to dedupe in-flight
 *     lookups (so 50 contracts on a page → 1 DB query, not 50).
 *
 * Network calls:
 *   • 4byte: https://www.4byte.directory/api/v1/signatures/?hex_signature=0x…
 *     Free, public, no auth. Returns multiple matches; we pick the most-
 *     upvoted (lowest id is typically the original/canonical one).
 *   • openchain.xyz: https://api.openchain.xyz/signature-database/v1/lookup?function=0x…
 *     Free, public, no auth. Used as a fallback when 4byte misses. Often
 *     covers newer/rarer selectors that 4byte doesn't have. Run AFTER
 *     4byte so we prefer the canonical-with-most-upvotes signature when
 *     both have it.
 *   • Sourcify: https://repo.sourcify.dev/contracts/full_match/<chain>/<addr>/metadata.json
 *     Free, public, no auth. Falls back to partial_match. 404 on unknown.
 *
 * If the upstream call fails entirely, we negative-cache for 1 hour and
 * return null. The UI falls back to short hex.
 */

import { query, queryOne, queryRows } from "@/lib/db";

const SOURCIFY_REPO = "https://repo.sourcify.dev/contracts";
const FOURBYTE_API = "https://www.4byte.directory/api/v1/signatures";
const OPENCHAIN_API = "https://api.openchain.xyz/signature-database/v1/lookup";
// Monad mainnet chain ID, used in Sourcify URLs
const MONAD_CHAIN_ID = 143;
const NEGATIVE_CACHE_HOURS = 1;
const FETCH_TIMEOUT_MS = 4_000;

// ─── helpers ──────────────────────────────────────────────────────

function hexToBuffer(hex: string): Buffer {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(s, "hex");
}

function bufferToHex(buf: Buffer): string {
  return "0x" + buf.toString("hex");
}

function isAddr(s: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(s);
}

function isSelector(s: string): boolean {
  return /^0x[0-9a-f]{8}$/i.test(s);
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─── 4byte directory client ───────────────────────────────────────

interface MethodCacheRow {
  signature: string | null;
  source: string | null;
  negative_until: Date | null;
}

async function readMethodCache(selectorBuf: Buffer): Promise<MethodCacheRow | null> {
  return queryOne<MethodCacheRow>(
    "SELECT signature, source, negative_until FROM method_signatures WHERE selector = $1",
    [selectorBuf],
  );
}

async function writeMethodCache(
  selectorBuf: Buffer,
  signature: string | null,
  source: string | null,
): Promise<void> {
  if (signature) {
    await query(
      `INSERT INTO method_signatures (selector, signature, source, negative_until, retrieved_at)
       VALUES ($1, $2, $3, NULL, NOW())
       ON CONFLICT (selector) DO UPDATE SET
         signature = EXCLUDED.signature,
         source = EXCLUDED.source,
         negative_until = NULL,
         retrieved_at = NOW()`,
      [selectorBuf, signature, source],
    );
  } else {
    // negative cache for 1 hour
    await query(
      `INSERT INTO method_signatures (selector, signature, source, negative_until, retrieved_at)
       VALUES ($1, NULL, NULL, NOW() + ($2 || ' hours')::interval, NOW())
       ON CONFLICT (selector) DO UPDATE SET
         negative_until = NOW() + ($2 || ' hours')::interval,
         retrieved_at = NOW()`,
      [selectorBuf, NEGATIVE_CACHE_HOURS],
    );
  }
}

interface FourByteHit {
  id: number;
  text_signature: string;
  hex_signature: string;
}

async function fetch4byte(selectorHex: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${FOURBYTE_API}/?hex_signature=${selectorHex}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: FourByteHit[] };
    if (!json.results || json.results.length === 0) return null;
    // 4byte returns most-recent first; the LOWEST id is the original
    // submission, usually the canonical one. Pick that.
    const canonical = json.results.reduce((a, b) => (a.id < b.id ? a : b));
    return canonical.text_signature ?? null;
  } catch {
    return null;
  }
}

interface OpenchainResponse {
  ok: boolean;
  result?: {
    function?: Record<string, Array<{ name: string; filtered?: boolean }> | null>;
  };
}

/**
 * openchain.xyz fallback. Often resolves selectors 4byte missed.
 * Same shape contract: returns the human signature or null.
 *
 * Response uses lowercase selector keys. `filtered: true` means the entry
 * was deemed a collision/spam; we prefer non-filtered entries when both
 * exist, but fall back to any match because filtered-but-present is still
 * useful info compared to nothing.
 */
async function fetchOpenchain(selectorHex: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${OPENCHAIN_API}?function=${selectorHex.toLowerCase()}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as OpenchainResponse;
    if (!json.ok || !json.result?.function) return null;
    const hits = json.result.function[selectorHex.toLowerCase()];
    if (!hits || hits.length === 0) return null;
    const valid = hits.find((h) => !h.filtered) ?? hits[0];
    return valid?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a selector using both providers, 4byte first then openchain.
 * Returns the signature plus the source name so we record provenance
 * in the cache (useful later if we want to debug "why is this label
 * weird, where did it come from").
 */
async function fetchSignature(
  selectorHex: string,
): Promise<{ sig: string | null; source: string | null }> {
  const fourByte = await fetch4byte(selectorHex);
  if (fourByte) return { sig: fourByte, source: "4byte" };
  const openchain = await fetchOpenchain(selectorHex);
  if (openchain) return { sig: openchain, source: "openchain" };
  return { sig: null, source: null };
}

/** Resolve a single 4-byte function selector (`0xa9059cbb`) → `"transfer(address,uint256)"`. */
export async function resolveMethod(selectorHex: string): Promise<string | null> {
  const lower = selectorHex.toLowerCase();
  if (!isSelector(lower)) return null;
  const buf = hexToBuffer(lower);

  const cached = await readMethodCache(buf);
  if (cached) {
    if (cached.signature) return cached.signature;
    if (cached.negative_until && cached.negative_until.getTime() > Date.now()) {
      return null; // still in negative-cache window
    }
    // negative cache expired, refetch below
  }

  const { sig, source } = await fetchSignature(lower);
  await writeMethodCache(buf, sig, source);
  return sig;
}

/**
 * Bulk-resolve N selectors in one call. Returns a Map<selector, signature|null>.
 * Hits the cache once for all selectors; only fetches missing/expired ones.
 */
export async function resolveManyMethods(
  selectorsHex: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const valid = [...new Set(selectorsHex.map((s) => s.toLowerCase()))].filter(isSelector);
  if (valid.length === 0) return out;

  const bufs = valid.map(hexToBuffer);
  // Bulk cache read
  const cached = await queryRows<{
    selector: Buffer;
    signature: string | null;
    negative_until: Date | null;
  }>(
    `SELECT selector, signature, negative_until
       FROM method_signatures
      WHERE selector = ANY($1)`,
    [bufs],
  );
  const cacheMap = new Map<string, MethodCacheRow>();
  for (const row of cached) {
    cacheMap.set(bufferToHex(row.selector), {
      signature: row.signature,
      source: null,
      negative_until: row.negative_until,
    });
  }

  // Decide which need fetching
  const toFetch: string[] = [];
  for (const sel of valid) {
    const c = cacheMap.get(sel);
    if (!c) {
      toFetch.push(sel);
    } else if (c.signature) {
      out.set(sel, c.signature);
    } else if (c.negative_until && c.negative_until.getTime() > Date.now()) {
      out.set(sel, null);
    } else {
      toFetch.push(sel);
    }
  }

  // Parallel fetch the misses. Each selector chains 4byte then openchain.
  await Promise.all(
    toFetch.map(async (sel) => {
      const { sig, source } = await fetchSignature(sel);
      out.set(sel, sig);
      await writeMethodCache(hexToBuffer(sel), sig, source);
    }),
  );

  return out;
}

// ─── Sourcify client ──────────────────────────────────────────────

interface ContractCacheRow {
  name: string | null;
  source: string | null;
  metadata_uri: string | null;
  negative_until: Date | null;
}

async function readContractCache(addrBuf: Buffer): Promise<ContractCacheRow | null> {
  return queryOne<ContractCacheRow>(
    "SELECT name, source, metadata_uri, negative_until FROM contract_labels WHERE address = $1",
    [addrBuf],
  );
}

async function writeContractCache(
  addrBuf: Buffer,
  name: string | null,
  source: string | null,
  metadataUri: string | null,
): Promise<void> {
  if (name) {
    await query(
      `INSERT INTO contract_labels (address, name, source, metadata_uri, negative_until, retrieved_at)
       VALUES ($1, $2, $3, $4, NULL, NOW())
       ON CONFLICT (address) DO UPDATE SET
         name = EXCLUDED.name,
         source = EXCLUDED.source,
         metadata_uri = EXCLUDED.metadata_uri,
         negative_until = NULL,
         retrieved_at = NOW()`,
      [addrBuf, name, source, metadataUri],
    );
  } else {
    await query(
      `INSERT INTO contract_labels (address, name, source, negative_until, retrieved_at)
       VALUES ($1, NULL, NULL, NOW() + ($2 || ' hours')::interval, NOW())
       ON CONFLICT (address) DO UPDATE SET
         negative_until = NOW() + ($2 || ' hours')::interval,
         retrieved_at = NOW()`,
      [addrBuf, NEGATIVE_CACHE_HOURS],
    );
  }
}

interface SourcifyMetadata {
  output?: {
    devdoc?: { title?: string; details?: string };
    userdoc?: { notice?: string };
  };
  settings?: {
    compilationTarget?: Record<string, string>;
  };
}

/**
 * Fetch verified contract metadata from Sourcify, trying full_match first
 * then partial_match. Returns the contract's display name (taken from the
 * compilation target) or null.
 */
async function fetchSourcify(
  addrLower: string,
): Promise<{ name: string | null; metadataUri: string | null }> {
  // Sourcify expects lowercase addresses without 0x prefix? Actually with, its API accepts both
  for (const matchType of ["full_match", "partial_match"]) {
    try {
      const url = `${SOURCIFY_REPO}/${matchType}/${MONAD_CHAIN_ID}/${addrLower}/metadata.json`;
      const res = await fetchWithTimeout(url, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) continue;
      const meta = (await res.json()) as SourcifyMetadata;
      // The compilation target is a map from filename to contract name.
      // Take the first contract name (typically the deployed one).
      const target = meta.settings?.compilationTarget;
      if (target) {
        const names = Object.values(target);
        if (names.length > 0 && names[0]) {
          return { name: names[0], metadataUri: url };
        }
      }
    } catch {
      // fall through to next match type
    }
  }
  return { name: null, metadataUri: null };
}

/** Resolve a single contract address → display name (via Sourcify). */
export async function resolveContract(addressHex: string): Promise<string | null> {
  const lower = addressHex.toLowerCase();
  if (!isAddr(lower)) return null;
  const buf = hexToBuffer(lower);

  const cached = await readContractCache(buf);
  if (cached) {
    if (cached.name) return cached.name;
    if (cached.negative_until && cached.negative_until.getTime() > Date.now()) {
      return null;
    }
  }

  const { name, metadataUri } = await fetchSourcify(lower);
  await writeContractCache(buf, name, name ? "sourcify" : null, metadataUri);
  return name;
}

/**
 * Bulk-resolve N addresses. Returns a Map<address, name|null>.
 * Hits the cache once; fetches missing entries in parallel (capped at 8
 * concurrent, Sourcify is friendly but not a CDN).
 */
export async function resolveManyContracts(
  addressesHex: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const valid = [...new Set(addressesHex.map((s) => s.toLowerCase()))].filter(isAddr);
  if (valid.length === 0) return out;

  const bufs = valid.map(hexToBuffer);
  const cached = await queryRows<{
    address: Buffer;
    name: string | null;
    negative_until: Date | null;
  }>(
    `SELECT address, name, negative_until
       FROM contract_labels
      WHERE address = ANY($1)`,
    [bufs],
  );
  const cacheMap = new Map<string, { name: string | null; negative_until: Date | null }>();
  for (const row of cached) {
    cacheMap.set(bufferToHex(row.address), {
      name: row.name,
      negative_until: row.negative_until,
    });
  }

  const toFetch: string[] = [];
  for (const addr of valid) {
    const c = cacheMap.get(addr);
    if (!c) {
      toFetch.push(addr);
    } else if (c.name) {
      out.set(addr, c.name);
    } else if (c.negative_until && c.negative_until.getTime() > Date.now()) {
      out.set(addr, null);
    } else {
      toFetch.push(addr);
    }
  }

  // Concurrency limit: 8 parallel fetches max
  const CONCURRENCY = 8;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (addr) => {
        const { name, metadataUri } = await fetchSourcify(addr);
        out.set(addr, name);
        await writeContractCache(
          hexToBuffer(addr),
          name,
          name ? "sourcify" : null,
          metadataUri,
        );
      }),
    );
  }

  return out;
}

/** Best-effort label: returns the resolved name OR a short-hex fallback. */
export function labelFor(name: string | null | undefined, hex: string, headChars = 6, tailChars = 4): string {
  if (name && name.length > 0) return name;
  if (hex.length <= 2 + headChars + tailChars) return hex;
  return hex.slice(0, 2 + headChars) + "…" + hex.slice(-tailChars);
}
