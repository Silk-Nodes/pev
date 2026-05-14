import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCursor } from "@/lib/indexer/store";
import { getLastHead, subscribe as subscribePump } from "@/lib/api/chain-head-pump";

/**
 * GET /api/health
 *
 * Operational health endpoint. Reports:
 *   • Indexer cursor (last indexed block, when)
 *   • Chain head (live, from RPC)
 *   • Lag (chain head − cursor)
 *   • Row counts in the main tables
 *
 * Convention: HTTP 200 always; the `ok` boolean tells you whether things
 * look healthy. This is so monitoring tools can scrape the JSON without
 * needing to handle non-200 responses.
 *
 * Lag thresholds:
 *   • lagBlocks ≤ 10  → ok = true   (caught up)
 *   • lagBlocks > 10  → ok = false  (falling behind)
 *
 * Always set `Cache-Control: no-store` so monitors get fresh data.
 */

export const dynamic = "force-dynamic";

interface RpcRes<T> {
  result?: T;
  error?: { message: string };
}

async function fetchHead(): Promise<number | null> {
  // Fast path: read from the in-process WS pump that already maintains a
  // live newHeads subscription to Monad. ~0ms vs ~1-2s for a fresh RPC
  // call. Crucially, this is what was causing the LiveStatus pill to
  // flash "offline" on every page load: the pill polled /api/health,
  // each poll did its own eth_blockNumber, the response trailed by 2s,
  // and the pill rendered the null state in the meantime.
  //
  // The pump might not have a head yet on a cold process (just booted).
  // In that case ageMs is -1, which means "never seen one"; we then
  // touch the pump (subscribe + immediately unsubscribe) to bootstrap
  // it and fall through to a one-shot RPC call so the very first call
  // after process restart still returns a real number.
  const cached = getLastHead();
  if (cached.head > 0 && cached.ageMs >= 0 && cached.ageMs < 5000) {
    return cached.head;
  }
  // Cold start: kick the pump so future calls are warm, then fetch once.
  if (cached.head === 0) {
    const off = subscribePump(() => {});
    setTimeout(off, 100); // release immediately; the WS connect is in flight
  }
  try {
    const url = process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as RpcRes<string>;
    if (!json.result) return null;
    return parseInt(json.result, 16);
  } catch {
    return null;
  }
}

async function fetchCounts(): Promise<{
  blocks: number;
  txExecutions: number;
  conflicts: number;
}> {
  // Use estimated row counts when possible (much faster on big tables);
  // fall back to exact COUNT(*) when the planner has no estimate.
  // Use Postgres's row-count *estimate* from pg_class.reltuples instead
  // of a real count(*). The exact count requires a full table scan,
  // which on tx_executions (17M rows / 6.6 GB) was taking ~5 seconds and
  // pushing the whole /api/health response past 6 s. The estimate is
  // updated by autovacuum / ANALYZE and is accurate to within a few %,
  // more than enough for a health endpoint.
  //
  // This brought the endpoint from ~6 s → <50 ms. The real cost of the
  // slow version was the LiveStatus pill flashing "offline" on every
  // fresh page load because the first poll hadn't returned yet.
  interface Row {
    relname: string;
    estimated_rows: string;
  }
  const rows = await query<Row>(`
    SELECT relname, reltuples::bigint::text AS estimated_rows
      FROM pg_class
     WHERE relname IN ('blocks', 'tx_executions', 'conflicts')
       AND relkind = 'r'
  `);
  const byName = new Map<string, number>();
  for (const r of rows.rows) {
    byName.set(r.relname, parseInt(r.estimated_rows, 10));
  }
  return {
    blocks: byName.get("blocks") ?? 0,
    txExecutions: byName.get("tx_executions") ?? 0,
    conflicts: byName.get("conflicts") ?? 0,
  };
}

export async function GET() {
  const t0 = performance.now();
  let dbReachable = true;
  let cursor: Awaited<ReturnType<typeof getCursor>> = null;
  let counts = { blocks: 0, txExecutions: 0, conflicts: 0 };

  try {
    cursor = await getCursor();
    counts = await fetchCounts();
  } catch (err) {
    dbReachable = false;
    console.error("[health] db error:", (err as Error).message);
  }

  const chainHead = await fetchHead();
  const lastIndexed = cursor?.lastIndexedBlock ?? 0;
  const lagBlocks = chainHead !== null ? chainHead - lastIndexed : null;
  const secondsSinceLastIndex =
    cursor?.lastIndexedAt
      ? Math.round((Date.now() - cursor.lastIndexedAt.getTime()) / 1000)
      : null;

  const ok =
    dbReachable &&
    chainHead !== null &&
    lagBlocks !== null &&
    lagBlocks <= 10 &&
    (secondsSinceLastIndex === null || secondsSinceLastIndex < 60);

  return NextResponse.json(
    {
      ok,
      checkedAtMs: Math.round(performance.now() - t0),
      indexer: {
        lastIndexedBlock: lastIndexed,
        lastIndexedAt: cursor?.lastIndexedAt ?? null,
        secondsSinceLastIndex,
      },
      chain: {
        currentHead: chainHead,
        lagBlocks,
      },
      database: {
        reachable: dbReachable,
        ...counts,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
