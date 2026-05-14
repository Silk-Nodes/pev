/**
 * /api/v1/visit, the public visit counter endpoint.
 *
 *   GET  → returns the current count, no side effect (cacheable for 30s)
 *   POST → increments the counter by 1, returns the new count
 *
 * The component <VisitorCount /> calls POST once per browser tab (deduped
 * via sessionStorage), and GET on subsequent renders to refresh the
 * displayed number.
 *
 * Privacy: this endpoint stores ONLY an aggregate count. No IPs, no IDs,
 * no timestamps per visit. Same disclosure as our consent banner:
 * aggregate counts only, no personal tracking. So it doesn't require
 * consent (no different from a server access log being read).
 *
 * Abuse: rate-limited to 60 req/min/IP via withApi. If someone scripts
 * a million POSTs from one IP, they're capped at ~86k/day, bad but
 * detectable in the logs and trivially walked back with a SQL UPDATE.
 *
 * Why a POST instead of a GET-with-side-effects:
 *   GET should be safe + idempotent per HTTP semantics. Increments fail
 *   that contract, caches, prefetchers, and accessibility tools all
 *   assume GET is safe and would re-fire it. POST is the right verb.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/middleware";
import { CACHE_HEADERS_NONE } from "@/lib/api/cache";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

interface CountRow {
  total_visits: string;
}

async function readCount(): Promise<number> {
  const row = await queryOne<CountRow>(
    "SELECT total_visits::text FROM site_stats WHERE id = 1",
  );
  return row ? parseInt(row.total_visits, 10) : 0;
}

async function incrementAndRead(): Promise<number> {
  // Single-statement increment + RETURNING is atomic, no race conditions
  // even under heavy concurrent POST load. Postgres handles the locking
  // for us at the row level.
  const res = await query<CountRow>(
    "UPDATE site_stats SET total_visits = total_visits + 1, updated_at = NOW() WHERE id = 1 RETURNING total_visits::text",
  );
  if (res.rows.length === 0) {
    // Row doesn't exist somehow, recreate (the migration normally inserts it)
    await query(
      "INSERT INTO site_stats (id, total_visits) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET total_visits = site_stats.total_visits + 1",
    );
    return readCount();
  }
  return parseInt(res.rows[0].total_visits, 10);
}

export const GET = withApi(
  async () => {
    try {
      const count = await readCount();
      return NextResponse.json({ count });
    } catch (err) {
      console.warn("[/api/v1/visit GET] db read failed:", (err as Error).message);
      return NextResponse.json({ count: null }, { status: 503 });
    }
  },
  // Don't cache, counter changes constantly, and 30s of staleness in the
  // displayed number isn't worth the CDN headache. Component fetches it
  // once on mount anyway.
  { cacheHeaders: CACHE_HEADERS_NONE },
);

export const POST = withApi(
  async () => {
    try {
      const count = await incrementAndRead();
      return NextResponse.json({ count });
    } catch (err) {
      console.warn(
        "[/api/v1/visit POST] increment failed:",
        (err as Error).message,
      );
      return NextResponse.json({ count: null }, { status: 503 });
    }
  },
  { cacheHeaders: CACHE_HEADERS_NONE },
);
