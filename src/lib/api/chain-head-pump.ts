/**
 * api/chain-head-pump.ts, singleton WebSocket subscription to Monad
 * `eth_subscribe newHeads`, fans out to in-process listeners.
 *
 * Why this exists:
 *   The indexer maintains its own WS subscription, but it lives in a
 *   separate process (pev-indexer). The Next.js process has no way to
 *   know about new chain heads in real time, `/api/health` is a 1-shot
 *   `eth_blockNumber` per request, so the LiveStatus pill could only
 *   tick on its own poll interval.
 *
 *   To make the chain head feel "alive" (ticking on every Monad block),
 *   we need a push-based source inside the Next.js process. This module
 *   opens ONE WebSocket to MONAD_WS_URL, parses `newHeads` events, and
 *   broadcasts the head number to every subscribed listener in-process.
 *
 *   Then `/api/v1/chain-head` (SSE) subscribes once per browser tab,
 *   pushing each head down. So:
 *
 *      Monad WS ─┐                                ┌──► browser tab 1
 *                │   (1 connection, this module)  │
 *                ├──► chain-head-pump ────────────┼──► browser tab 2
 *                │                                │
 *                │                                └──► browser tab N
 *
 *   N browsers = 1 upstream WS, not N. The pump is lazy (no listeners =
 *   no upstream connection) and self-heals on disconnect.
 *
 *   Note: this is for the *unindexed* chain head, i.e. what Monad just
 *   produced, not what we've finished tracing. That distinction is
 *   important for the LiveStatus pill: the head ticks even when the
 *   indexer is lagging, which is the point. (See LiveStatus.tsx for
 *   how it composes head + indexed cursor for the lag display.)
 */

import WebSocket from "ws";

type ChainHeadListener = (head: number) => void;

// ─── module-scoped singleton state ───────────────────────────────
const listeners = new Set<ChainHeadListener>();
let lastHead = 0;
let lastHeadAt = 0; // ms timestamp; useful for "stale" detection
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let backoffMs = 1000;
const MAX_BACKOFF_MS = 30_000;

function getWsUrl(): string | null {
  // We deliberately don't throw, if MONAD_WS_URL isn't set we just
  // skip the pump and the SSE endpoint will never push (the LiveStatus
  // pill falls back to the /api/health poll). Easier ops than crashing.
  return process.env.MONAD_WS_URL ?? null;
}

function broadcast(head: number): void {
  // Skip backwards/duplicate heads (shouldn't happen but be safe)
  if (head <= lastHead) return;
  lastHead = head;
  lastHeadAt = Date.now();
  for (const l of listeners) {
    try {
      l(head);
    } catch (err) {
      console.warn("[chain-head-pump] listener threw:", (err as Error).message);
    }
  }
}

function connect(): void {
  if (ws) return; // already connected or connecting
  const url = getWsUrl();
  if (!url) {
    console.warn("[chain-head-pump] MONAD_WS_URL not set, pump disabled");
    return;
  }

  console.log(`[chain-head-pump] connecting to ${url}`);
  const conn = new WebSocket(url);
  ws = conn;

  conn.on("open", () => {
    backoffMs = 1000; // reset on successful connect
    conn.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: ["newHeads"],
      }),
    );
  });

  conn.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      // newHeads event: { method: 'eth_subscription', params: { result: { number: '0x...' } } }
      if (msg.method === "eth_subscription" && msg.params?.result?.number) {
        const head = parseInt(msg.params.result.number, 16);
        if (Number.isFinite(head)) broadcast(head);
      }
    } catch {
      // Best-effort parsing, silently drop garbage
    }
  });

  conn.on("close", () => {
    ws = null;
    if (listeners.size === 0) {
      // No one listening, don't bother reconnecting until someone subscribes
      return;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    console.warn(
      `[chain-head-pump] disconnected; reconnecting in ${backoffMs}ms`,
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      connect();
    }, backoffMs);
  });

  conn.on("error", (err) => {
    console.warn("[chain-head-pump] ws error:", err.message);
    // 'close' will fire next and trigger the reconnect
  });
}

function disconnectIfIdle(): void {
  // Optional cleanup: if no listeners remain, close the WS to free the
  // upstream connection. We give it a 5s grace period in case a new
  // subscriber is about to arrive (page navigations, refreshes).
  if (listeners.size > 0 || !ws) return;
  setTimeout(() => {
    if (listeners.size > 0) return;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }, 5_000);
}

/**
 * Subscribe to chain head updates. Returns an unsubscribe function.
 *
 * The listener fires:
 *   • Once immediately (next tick) with `lastHead` if we already know it
 *    , so a freshly-loaded page doesn't have to wait for the next block.
 *   • Then on every newHead from Monad, in order, deduped (no rewinds).
 *
 * Auto-connects on first subscriber. Auto-disconnects after the last
 * unsubscribes (with a 5s debounce).
 */
export function subscribe(listener: ChainHeadListener): () => void {
  listeners.add(listener);
  if (!ws) connect();
  if (lastHead > 0) {
    // Replay last known head so the new subscriber gets immediate value
    setImmediate(() => {
      // Defensive: only fire if still subscribed
      if (listeners.has(listener)) listener(lastHead);
    });
  }
  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
}

/** Return the most recently observed head, or 0 if we haven't seen one yet. */
export function getLastHead(): { head: number; ageMs: number } {
  return {
    head: lastHead,
    ageMs: lastHeadAt > 0 ? Date.now() - lastHeadAt : -1,
  };
}
