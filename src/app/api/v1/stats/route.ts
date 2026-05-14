import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/middleware";
import { aggregateCache, CACHE_HEADERS_AGGREGATE } from "@/lib/api/cache";
import { queryOne } from "@/lib/db";
import { getCursor } from "@/lib/indexer/store";
import { subscriberCount } from "@/lib/api/pubsub";

/**
 * GET /api/v1/stats
 *
 * Network-level rollup. Cheap aggregate over the indexed `blocks` table
 * plus indexer cursor + chain head. Cached 60s.
 */

export const dynamic = "force-dynamic";

interface StatsRow {
  blocks: string;
  txs: string;
  conflicts: string;
  avg_score: string | null;
  min_block: string | null;
  max_block: string | null;
}

const CACHE_KEY = "v1:stats";

async function fetchChainHead(): Promise<number | null> {
  try {
    const url = process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const json = (await res.json()) as { result?: string };
    return json.result ? parseInt(json.result, 16) : null;
  } catch {
    return null;
  }
}

export const GET = withApi(
  async () => {
    const hit = aggregateCache.get(CACHE_KEY);
    if (hit) return NextResponse.json(hit);

    const [statsRow, cursor, chainHead] = await Promise.all([
      queryOne<StatsRow>(`
        SELECT
          (SELECT count(*) FROM blocks)::text         AS blocks,
          (SELECT count(*) FROM tx_executions)::text  AS txs,
          (SELECT count(*) FROM conflicts)::text      AS conflicts,
          (SELECT avg(parallelism_score) FROM blocks)::text AS avg_score,
          (SELECT min(number) FROM blocks)::text      AS min_block,
          (SELECT max(number) FROM blocks)::text      AS max_block
      `),
      getCursor(),
      fetchChainHead(),
    ]);

    const body = {
      indexed: {
        blocks: statsRow ? parseInt(statsRow.blocks, 10) : 0,
        transactions: statsRow ? parseInt(statsRow.txs, 10) : 0,
        conflicts: statsRow ? parseInt(statsRow.conflicts, 10) : 0,
        minBlock: statsRow?.min_block ? parseInt(statsRow.min_block, 10) : null,
        maxBlock: statsRow?.max_block ? parseInt(statsRow.max_block, 10) : null,
        avgParallelismScore: statsRow?.avg_score
          ? Math.round(parseFloat(statsRow.avg_score) * 10) / 10
          : null,
      },
      indexer: {
        lastIndexedBlock: cursor?.lastIndexedBlock ?? 0,
        lastIndexedAt: cursor?.lastIndexedAt ?? null,
      },
      chain: {
        currentHead: chainHead,
        lagBlocks: chainHead && cursor ? chainHead - cursor.lastIndexedBlock : null,
      },
      live: {
        sseSubscribers: subscriberCount(),
      },
    };
    aggregateCache.set(CACHE_KEY, body);
    return NextResponse.json(body);
  },
  { cacheHeaders: CACHE_HEADERS_AGGREGATE },
);
