import { withApi } from "@/lib/api/middleware";
import { CACHE_HEADERS_NONE } from "@/lib/api/cache";
import { subscribe } from "@/lib/api/pubsub";
import { queryOne } from "@/lib/db";

/**
 * GET /api/v1/live
 *
 * Server-Sent Events stream of newly indexed blocks. Each event:
 *
 *   event: block
 *   data: { "number": 70381127, "hash": "0x...", "timestamp": "...",
 *           "txCount": 14, "parallelismScore": 86, "conflictCount": 1 }
 *
 * Plus a `: keepalive` comment every 25 s so proxies don't kill idle
 * connections.
 *
 * Client usage:
 *
 *   const es = new EventSource('/api/v1/live');
 *   es.addEventListener('block', e => {
 *     const block = JSON.parse(e.data);
 *     console.log('new block', block.number);
 *   });
 *
 * Driven by Postgres LISTEN/NOTIFY (see lib/api/pubsub.ts), when the
 * indexer commits a block it fires NOTIFY, which fans out here.
 *
 * Rate-limit-exempt: a single SSE connection is one long subscription,
 * not a per-second request. The connect itself doesn't tax anything.
 */

export const dynamic = "force-dynamic";

interface BlockSummary {
  number: string;
  hash: Buffer;
  timestamp: Date;
  tx_count: number;
  parallelism_score: number;
  blocked_pct: number;
  conflict_count: number;
  execution_depth: number;
}

async function fetchSummary(blockNumber: number) {
  const row = await queryOne<BlockSummary>(
    `SELECT number::text, hash, timestamp, tx_count, parallelism_score,
            blocked_pct, conflict_count, execution_depth
       FROM blocks WHERE number = $1`,
    [blockNumber],
  );
  if (!row) return null;
  return {
    number: parseInt(row.number, 10),
    hash: "0x" + row.hash.toString("hex"),
    timestamp: row.timestamp,
    txCount: row.tx_count,
    parallelismScore: row.parallelism_score,
    blockedPct: row.blocked_pct,
    conflictCount: row.conflict_count,
    executionDepth: row.execution_depth,
  };
}

export const GET = withApi(
  async (req) => {
    const encoder = new TextEncoder();
    const formatEvent = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let unsubscribe: (() => void) | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        // 1. Send a hello so the client knows the connection is alive
        controller.enqueue(
          formatEvent("hello", {
            version: "v1",
            channel: "block",
            serverTime: new Date().toISOString(),
          }),
        );

        // 2. Subscribe to the Postgres notification channel
        unsubscribe = await subscribe(async (blockNumber) => {
          try {
            const summary = await fetchSummary(blockNumber);
            if (!summary) return;
            controller.enqueue(formatEvent("block", summary));
          } catch (err) {
            // Don't crash the stream, log and skip
            console.warn(
              "[live] failed to push block",
              blockNumber,
              ":",
              (err as Error).message,
            );
          }
        });

        // 3. Keepalive comment every 25s (under the typical 30s proxy idle
        //    timeout). SSE comments are lines starting with ":", clients
        //    silently ignore them but the bytes keep the connection warm.
        keepaliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // controller may have closed, stop
          }
        }, 25_000);

        // 4. Cleanup on client disconnect
        req.signal.addEventListener("abort", () => {
          unsubscribe?.();
          if (keepaliveTimer) clearInterval(keepaliveTimer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel() {
        unsubscribe?.();
        if (keepaliveTimer) clearInterval(keepaliveTimer);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        // CORS, public read endpoint
        "access-control-allow-origin": "*",
        // Disable nginx buffering on the off chance it's in front of us
        "x-accel-buffering": "no",
      },
    });
  },
  { skipRateLimit: true, cacheHeaders: CACHE_HEADERS_NONE },
);
