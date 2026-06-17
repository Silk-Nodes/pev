import { withApi } from "@/lib/api/middleware";
import { CACHE_HEADERS_NONE } from "@/lib/api/cache";
import { subscribe } from "@/lib/api/pubsub";
import { queryOne } from "@/lib/db";

/**
 * GET /api/v1/graph-live
 *
 * Server-Sent Events stream for the /graph real-time light-up. For each
 * newly indexed block it emits the set of contracts that block touched,
 * so the relationship graph can flash the matching nodes as activity
 * happens:
 *
 *   event: block
 *   data: { "number": 81664933, "contracts": ["0x..", "0x.."] }
 *
 * Mirrors /api/v1/live (Postgres LISTEN/NOTIFY fan-out) but carries the
 * touched-contract set instead of the block summary. The contracts query
 * is a single indexed range scan on tx_executions (PK leads with
 * block_number), so it's cheap per block. The client filters the list to
 * its ~50 graph nodes and pings those.
 *
 * Scaling note: like /api/v1/live, each connection runs its own per-block
 * query. Fine at current viewer counts; if /graph ever gets heavy
 * concurrent traffic, compute the contract set once per block in the
 * pubsub fan-out and share it across listeners.
 */

export const dynamic = "force-dynamic";

async function fetchContracts(blockNumber: number): Promise<string[]> {
  const row = await queryOne<{ contracts: string[] | null }>(
    `SELECT array_agg(DISTINCT '0x' || encode(c, 'hex')) AS contracts
       FROM tx_executions te, unnest(te.contracts) AS c
      WHERE te.block_number = $1 AND c IS NOT NULL`,
    [blockNumber],
  );
  return row?.contracts ?? [];
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
        controller.enqueue(
          formatEvent("hello", {
            version: "v1",
            channel: "graph-block",
            serverTime: new Date().toISOString(),
          }),
        );

        unsubscribe = await subscribe(async (blockNumber) => {
          try {
            const contracts = await fetchContracts(blockNumber);
            if (contracts.length === 0) return;
            controller.enqueue(formatEvent("block", { number: blockNumber, contracts }));
          } catch (err) {
            console.warn("[graph-live] push failed", blockNumber, ":", (err as Error).message);
          }
        });

        keepaliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            /* closed */
          }
        }, 25_000);

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
        "access-control-allow-origin": "*",
        "x-accel-buffering": "no",
      },
    });
  },
  { skipRateLimit: true, cacheHeaders: CACHE_HEADERS_NONE },
);
