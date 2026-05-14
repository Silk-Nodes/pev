import { withApi } from "@/lib/api/middleware";
import { CACHE_HEADERS_NONE } from "@/lib/api/cache";
import { subscribe, getLastHead } from "@/lib/api/chain-head-pump";

/**
 * GET /api/v1/chain-head
 *
 * SSE stream of Monad chain heads, in real time. Each event:
 *
 *   event: head
 *   data: { "head": 70451611, "at": 1735... }
 *
 * Plus a `: keepalive` comment every 25 s so proxies don't kill idle
 * connections.
 *
 * Driven by `lib/api/chain-head-pump` which holds ONE upstream WebSocket
 * to MONAD_WS_URL and fans new heads out to all SSE subscribers. So N
 * browser tabs = 1 upstream connection, not N. See chain-head-pump.ts
 * for the full architecture rationale.
 *
 * This is the chain HEAD as Monad just produced, NOT what we've finished
 * indexing. Use `/api/health` for the indexed cursor + lag. The two
 * together give the LiveStatus pill its honest "live · chain #X · indexed
 * #Y" shape, where the chain # ticks every ~0.5s on its own pipe.
 *
 * Client usage:
 *
 *   const es = new EventSource('/api/v1/chain-head');
 *   es.addEventListener('head', (e) => {
 *     const { head } = JSON.parse(e.data);
 *     setChainHead(head);  // ticks live
 *   });
 *
 * Rate-limit-exempt: a single SSE connection is one long subscription,
 * not a per-second request.
 */

export const dynamic = "force-dynamic";

export const GET = withApi(
  async (req) => {
    const encoder = new TextEncoder();
    const formatEvent = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let unsubscribe: (() => void) | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        // 1. Hello frame, confirms the connection is open
        controller.enqueue(
          formatEvent("hello", {
            version: "v1",
            channel: "chain-head",
            serverTime: new Date().toISOString(),
          }),
        );

        // 2. If we already know the latest head, push it immediately so
        //    the client doesn't have to wait for the next Monad block
        //    (~0.5s typical, but could be longer if the WS just connected).
        const cached = getLastHead();
        if (cached.head > 0) {
          controller.enqueue(
            formatEvent("head", { head: cached.head, at: Date.now() }),
          );
        }

        // 3. Subscribe to the in-process pump for future heads
        unsubscribe = subscribe((head) => {
          try {
            controller.enqueue(
              formatEvent("head", { head, at: Date.now() }),
            );
          } catch {
            // controller may have closed, listener will be removed via
            // the abort handler below
          }
        });

        // 4. Keepalive comment every 25s (under the typical 30s proxy
        //    idle timeout). SSE comments are lines starting with ":" -
        //    clients silently ignore them but the bytes keep the
        //    connection warm through nginx/cloudflare/etc.
        keepaliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            /* controller closed */
          }
        }, 25_000);

        // 5. Cleanup on client disconnect
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
        // Disable nginx buffering on the off chance it's in front of us
        "x-accel-buffering": "no",
      },
    });
  },
  { skipRateLimit: true, cacheHeaders: CACHE_HEADERS_NONE },
);
