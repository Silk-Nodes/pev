import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/middleware";
import { aggregateCache, CACHE_HEADERS_AGGREGATE } from "@/lib/api/cache";
import { queryRows } from "@/lib/db";

/**
 * GET /api/v1/leaderboard/:kind?window=24h&limit=20
 *
 * kinds:
 *   • parallel   , most parallel-friendly blocks (highest parallelism_score)
 *   • blocked    , most-bottlenecked blocks (highest blocked_pct)
 *   • busy       , biggest blocks by tx count
 *   • hotspots   , most-contended storage slots across the indexed window
 *
 * window: 1h | 24h | 7d | all  (default 24h)
 * limit:  1..100 (default 20)
 */

export const dynamic = "force-dynamic";

const WINDOW_INTERVALS: Record<string, string | null> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  all: null,
};

function timeFilter(windowKey: string): string {
  const interval = WINDOW_INTERVALS[windowKey];
  return interval ? `WHERE timestamp > NOW() - INTERVAL '${interval}'` : "";
}

export const GET = withApi(
  async (req, ctx) => {
    const params = await ctx.params;
    const kind = params.kind ?? "";
    const url = new URL(req.url);
    const windowKey = url.searchParams.get("window") ?? "24h";
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
    );

    if (!(windowKey in WINDOW_INTERVALS)) {
      return NextResponse.json(
        { error: "invalid window (use 1h | 24h | 7d | all)" },
        { status: 400 },
      );
    }

    const cacheKey = `v1:leaderboard:${kind}:${windowKey}:${limit}`;
    const hit = aggregateCache.get(cacheKey);
    if (hit) return NextResponse.json(hit);

    let body: unknown;
    switch (kind) {
      case "parallel":
        body = await topByColumn("parallelism_score DESC", windowKey, limit);
        break;
      case "blocked":
        body = await topByColumn("blocked_pct DESC", windowKey, limit);
        break;
      case "busy":
        body = await topByColumn("tx_count DESC", windowKey, limit);
        break;
      case "hotspots":
        body = await topHotspots(windowKey, limit);
        break;
      default:
        return NextResponse.json(
          { error: "invalid kind (use parallel | blocked | busy | hotspots)" },
          { status: 400 },
        );
    }

    aggregateCache.set(cacheKey, body);
    return NextResponse.json(body);
  },
  { cacheHeaders: CACHE_HEADERS_AGGREGATE },
);

interface BlockTopRow {
  number: string;
  hash: Buffer;
  timestamp: Date;
  tx_count: number;
  parallelism_score: number;
  blocked_pct: number;
  conflict_count: number;
  execution_depth: number;
}

async function topByColumn(orderBy: string, windowKey: string, limit: number) {
  const filter = timeFilter(windowKey);
  const rows = await queryRows<BlockTopRow>(
    `SELECT number::text, hash, timestamp, tx_count, parallelism_score,
            blocked_pct, conflict_count, execution_depth
       FROM blocks
       ${filter}
       ORDER BY ${orderBy}, number DESC
       LIMIT $1`,
    [limit],
  );
  return {
    window: windowKey,
    limit,
    blocks: rows.map((r) => ({
      number: parseInt(r.number, 10),
      hash: "0x" + r.hash.toString("hex"),
      timestamp: r.timestamp,
      txCount: r.tx_count,
      parallelismScore: r.parallelism_score,
      blockedPct: r.blocked_pct,
      conflictCount: r.conflict_count,
      executionDepth: r.execution_depth,
    })),
  };
}

interface HotspotRow {
  contract: Buffer;
  slot: Buffer;
  appearances: string;
  total_touches: string;
  total_conflicts: string;
}

async function topHotspots(windowKey: string, limit: number) {
  // Join hot_slots to blocks for the time filter
  const interval = WINDOW_INTERVALS[windowKey];
  const filter = interval
    ? `WHERE b.timestamp > NOW() - INTERVAL '${interval}'`
    : "";
  const rows = await queryRows<HotspotRow>(
    `SELECT
       hs.contract,
       hs.slot,
       count(*)::text                        AS appearances,
       sum(hs.touches)::text                 AS total_touches,
       sum(hs.conflicts_caused)::text        AS total_conflicts
     FROM block_hot_slots hs
     JOIN blocks b ON hs.block_number = b.number
     ${filter}
     GROUP BY hs.contract, hs.slot
     ORDER BY total_conflicts DESC, total_touches DESC
     LIMIT $1`,
    [limit],
  );
  return {
    window: windowKey,
    limit,
    hotspots: rows.map((r) => ({
      contract: "0x" + r.contract.toString("hex"),
      slot: "0x" + r.slot.toString("hex"),
      appearances: parseInt(r.appearances, 10),
      totalTouches: parseInt(r.total_touches, 10),
      totalConflicts: parseInt(r.total_conflicts, 10),
    })),
  };
}
