/**
 * api/cache.ts, tiny in-process LRU cache with TTL.
 *
 * Single-process Next.js app, so an in-memory Map is the right choice for
 * v1 (no Redis, no external deps). When/if we go multi-instance, swap
 * this for Redis with the same API.
 *
 * Used by route handlers to memoize:
 *   • Per-block JSONB blobs (immutable once finalized; 1h TTL)
 *   • Leaderboard rollups (60s TTL)
 *   • Network stats (60s TTL)
 *
 * The cache is process-scoped and automatically pruned on each set when
 * over capacity (true LRU via Map insertion-order).
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TTLCache<K, V> {
  private store = new Map<K, Entry<V>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxSize: number,
    private readonly defaultTtlMs: number,
  ) {}

  get(key: K): V | undefined {
    const e = this.store.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // refresh LRU order
    this.store.delete(key);
    this.store.set(key, e);
    this.hits++;
    return e.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.store.has(key)) this.store.delete(key);
    else if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value as K | undefined;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}

// ─── shared cache instances ──────────────────────────────────────

/** Per-block PEVData blobs. Immutable once a block is finalized → 1 hour. */
export const blockCache = new TTLCache<number, unknown>(2_000, 60 * 60_000);

/** Aggregate / leaderboard responses. Stale-tolerable → 60s. */
export const aggregateCache = new TTLCache<string, unknown>(200, 60_000);

// ─── Cache-Control helpers ───────────────────────────────────────

/**
 * Standard public, immutable response (e.g. finalized block data).
 * Browsers + CDNs cache for a year. We never invalidate because the
 * underlying chain data is immutable.
 */
export const CACHE_HEADERS_IMMUTABLE = {
  "cache-control": "public, max-age=31536000, immutable",
};

/** Stale-while-revalidate for aggregates that change slowly. */
export const CACHE_HEADERS_AGGREGATE = {
  "cache-control": "public, max-age=60, stale-while-revalidate=300",
};

/** Never cache. Used for /live and /stats. */
export const CACHE_HEADERS_NONE = {
  "cache-control": "no-store",
};
