/**
 * api/pubsub.ts, Postgres LISTEN/NOTIFY pub/sub for live block events.
 *
 * Why this design:
 *   • The indexer process writes a block, then runs `NOTIFY pev_block_indexed,
 *     '<block_number>'`.
 *   • The Next.js process holds ONE long-lived Postgres listener and fans
 *     each notification out to all connected SSE clients.
 *   • No Redis. No polling. Uses what we already have.
 *
 * Channel: 'pev_block_indexed'
 * Payload: stringified block number (e.g. '70381127')
 */

import type { Notification, PoolClient } from "pg";
import { getPool } from "@/lib/db";

export const CHANNEL = "pev_block_indexed";

type Listener = (blockNumber: number) => void;

const listeners = new Set<Listener>();
let dedicatedClient: PoolClient | null = null;
let dedicatedClientStarting: Promise<void> | null = null;

/**
 * Lazily acquire a long-lived Postgres connection bound to LISTEN
 * pev_block_indexed. Subsequent calls reuse the same connection.
 *
 * Uses pool.connect() but never releases the client back to the pool -
 * the pool's max should be sized with this in mind (default 10, fine).
 */
async function ensureListening(): Promise<void> {
  if (dedicatedClient) return;
  if (dedicatedClientStarting) return dedicatedClientStarting;

  dedicatedClientStarting = (async () => {
    const client = await getPool().connect();
    client.on("notification", (msg: Notification) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      const n = parseInt(msg.payload, 10);
      if (!Number.isFinite(n)) return;
      for (const l of listeners) {
        try {
          l(n);
        } catch (err) {
          console.warn("[pubsub] listener error:", (err as Error).message);
        }
      }
    });
    client.on("error", (err) => {
      console.error("[pubsub] dedicated client error:", err.message);
      // Drop the client so the next subscribe re-establishes
      try {
        client.release(true);
      } catch {
        /* ignore */
      }
      dedicatedClient = null;
    });
    await client.query(`LISTEN ${CHANNEL}`);
    dedicatedClient = client;
    console.log(`[pubsub] listening on ${CHANNEL}`);
  })();

  try {
    await dedicatedClientStarting;
  } finally {
    dedicatedClientStarting = null;
  }
}

/**
 * Subscribe to new-block events. Returns an unsubscribe function.
 * Call this once per SSE client; call the returned fn on disconnect.
 */
export async function subscribe(listener: Listener): Promise<() => void> {
  await ensureListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish a block-indexed event. Called by the indexer after a successful
 * writeBlock().
 *
 * Uses NOTIFY (not the listener client, any client in the pool works).
 * Notifications fire on transaction commit, so this is safe to call mid-tx.
 */
export async function publishBlockIndexed(blockNumber: number): Promise<void> {
  await getPool().query(`SELECT pg_notify($1, $2)`, [
    CHANNEL,
    String(blockNumber),
  ]);
}

/** Current subscriber count, useful for /api/health and ops. */
export function subscriberCount(): number {
  return listeners.size;
}
