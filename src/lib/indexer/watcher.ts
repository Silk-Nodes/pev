/**
 * indexer/watcher.ts, block head detection.
 *
 * Two modes, chosen at startup based on env:
 *   • WebSocket  (preferred), eth_subscribe newHeads. Push-based, sub-second
 *     latency from a new block existing to us knowing about it. Used when
 *     MONAD_WS_URL is set (e.g. ws://your-monad-node:8081).
 *   • Polling   (fallback)  , eth_blockNumber every 1s. Higher latency, more
 *     RPC traffic, but works against any HTTP RPC. Used when MONAD_WS_URL
 *     is not set.
 *
 * Public API: `startWatcher(opts)`, returns an async iterator that yields
 * block numbers. Caller owns the lifecycle (call .return() to stop).
 *
 * Resilience:
 *   • WS connection drop → automatic exponential reconnect (1s, 2s, 4s, …
 *     capped at 30s)
 *   • Skipped block numbers detected (e.g. WS missed one) → catch-up emit
 *   • Polling never sleeps less than 250ms even if blocks are flying
 *
 * The watcher itself does NOT trace or write blocks. It only emits numbers.
 * The indexer entry script subscribes the WebSocket-aware queue producer to
 * this stream.
 */

import WebSocket from "ws";

interface WatcherOptions {
  rpcUrl: string;
  wsUrl?: string | undefined;
  /** seconds between polls when in polling mode */
  pollIntervalMs?: number;
  /** how far behind head to wait before emitting (finality lag) */
  finalityLag?: number;
  /** abort signal to stop the watcher */
  signal?: AbortSignal;
}

export interface BlockHead {
  /** block number to index (already adjusted for finality lag) */
  blockNumber: number;
  /** the chain head that triggered this emit */
  chainHead: number;
  /** "ws" or "poll", useful for ops/logging */
  source: "ws" | "poll";
}

/**
 * Start watching for new block heads. Returns an AsyncIterable<BlockHead>.
 *
 * Usage:
 *   const watcher = startWatcher({ rpcUrl, wsUrl, finalityLag: 2 });
 *   for await (const head of watcher) {
 *     await queue.send('trace-block', { blockNumber: head.blockNumber });
 *   }
 */
export function startWatcher(opts: WatcherOptions): AsyncIterable<BlockHead> {
  const finalityLag = opts.finalityLag ?? 2;
  const pollMs = opts.pollIntervalMs ?? 1000;

  if (opts.wsUrl) {
    return wsWatcher(opts.wsUrl, opts.rpcUrl, finalityLag, opts.signal);
  }
  return pollWatcher(opts.rpcUrl, pollMs, finalityLag, opts.signal);
}

// ─── WebSocket implementation ────────────────────────────────────

async function* wsWatcher(
  wsUrl: string,
  rpcUrl: string,
  finalityLag: number,
  signal?: AbortSignal,
): AsyncIterable<BlockHead> {
  // Backlog buffer: heads arrive faster than the consumer can process.
  // We push into this and the consumer pulls. A simple async queue.
  const queue: BlockHead[] = [];
  let waiter: ((v: BlockHead | null) => void) | null = null;
  let closed = false;
  let lastEmittedBlock = 0;

  const close = () => {
    if (closed) return;
    closed = true;
    if (waiter) {
      waiter(null);
      waiter = null;
    }
  };
  signal?.addEventListener("abort", close);

  // Connection management with exponential reconnect
  let backoffMs = 1000;
  const maxBackoff = 30_000;

  let currentWs: WebSocket | null = null;

  const enqueue = (chainHead: number, source: "ws" | "poll") => {
    const target = chainHead - finalityLag;
    if (target <= 0) return;
    // Catch-up: if we somehow skipped numbers, emit each missed one.
    // This protects against a brief WS disconnect during which a few blocks
    // arrived that we didn't see.
    const startFrom = lastEmittedBlock === 0 ? target : lastEmittedBlock + 1;
    for (let n = startFrom; n <= target; n++) {
      const head: BlockHead = { blockNumber: n, chainHead, source };
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(head);
      } else {
        queue.push(head);
      }
      lastEmittedBlock = n;
    }
  };

  const connect = () => {
    if (closed) return;
    const ws = new WebSocket(wsUrl);
    currentWs = ws;

    ws.on("open", () => {
      backoffMs = 1000; // reset on successful connect
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: ["newHeads"],
        }),
      );
      console.log(`[watcher] ws connected to ${wsUrl}`);
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Either { id: 1, result: "0x..." } (subscription confirmation)
        // or    { method: "eth_subscription", params: { result: { number: "0x..." } } }
        if (msg.method === "eth_subscription" && msg.params?.result?.number) {
          const n = parseInt(msg.params.result.number, 16);
          enqueue(n, "ws");
        }
      } catch (e) {
        console.warn("[watcher] failed to parse ws message:", e);
      }
    });

    ws.on("close", (code) => {
      currentWs = null;
      if (closed) return;
      console.warn(
        `[watcher] ws closed (code=${code}); reconnecting in ${backoffMs}ms`,
      );
      setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, maxBackoff);
        connect();
      }, backoffMs);
    });

    ws.on("error", (err) => {
      console.warn("[watcher] ws error:", err.message);
      // 'close' will fire after error and trigger the reconnect.
    });
  };

  // Bootstrap: also do an initial HTTP poll to learn the current head
  // (so the consumer doesn't have to wait for the next block to arrive).
  try {
    const head = await getCurrentHead(rpcUrl);
    enqueue(head, "ws"); // mark source as ws, we're about to subscribe
  } catch (e) {
    console.warn("[watcher] initial head fetch failed:", (e as Error).message);
  }

  connect();

  try {
    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      const next = await new Promise<BlockHead | null>((resolve) => {
        waiter = resolve;
      });
      if (next === null) break;
      yield next;
    }
  } finally {
    close();
    if (currentWs) (currentWs as WebSocket).close();
  }
}

// ─── Polling fallback ───────────────────────────────────────────

async function* pollWatcher(
  rpcUrl: string,
  pollMs: number,
  finalityLag: number,
  signal?: AbortSignal,
): AsyncIterable<BlockHead> {
  let lastEmittedBlock = 0;
  while (!signal?.aborted) {
    try {
      const chainHead = await getCurrentHead(rpcUrl);
      const target = chainHead - finalityLag;
      const startFrom = lastEmittedBlock === 0 ? target : lastEmittedBlock + 1;
      for (let n = startFrom; n <= target; n++) {
        if (signal?.aborted) return;
        yield { blockNumber: n, chainHead, source: "poll" };
        lastEmittedBlock = n;
      }
    } catch (e) {
      console.warn("[watcher] poll failed:", (e as Error).message);
    }
    await sleep(pollMs, signal);
  }
}

// ─── shared helpers ──────────────────────────────────────────────

async function getCurrentHead(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  if (!json.result) throw new Error("eth_blockNumber returned no result");
  return parseInt(json.result, 16);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
