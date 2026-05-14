import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/middleware";
import { blockCache, CACHE_HEADERS_IMMUTABLE } from "@/lib/api/cache";
import { getBlockPEV } from "@/lib/indexer/store";

/**
 * GET /api/v1/block/:number
 *
 * Returns the full PEVData for an indexed block. Decimal or 0x hex.
 *
 *   200 → { block, indexed: true, data: <PEVData> }
 *   404 → { block, indexed: false } when not in our index
 *
 * Cached for a year (immutable). LRU in-process for hot keys.
 */

export const dynamic = "force-dynamic";

export const GET = withApi(
  async (_req, ctx) => {
    const params = await ctx.params;
    const raw = params.number ?? "";
    const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: "invalid block number" },
        { status: 400 },
      );
    }

    // Try LRU first (microseconds)
    const cached = blockCache.get(n);
    if (cached) {
      return NextResponse.json({ block: n, indexed: true, data: cached });
    }

    // Then Postgres (~10-50ms)
    const data = await getBlockPEV(n);
    if (!data) {
      return NextResponse.json(
        { block: n, indexed: false },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    blockCache.set(n, data);
    return NextResponse.json({ block: n, indexed: true, data });
  },
  { cacheHeaders: CACHE_HEADERS_IMMUTABLE },
);
