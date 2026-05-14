#!/usr/bin/env tsx
/**
 * indexer.ts, long-running entry point for the pev block indexer.
 *
 * Two modes:
 *   • forward (default) , subscribe to new heads, enqueue + trace each
 *                          block as it finalizes
 *   • backfill (--backfill [from] [to])
 *                       , walk backwards from `from` (default = current
 *                          head - finality_lag) down to `to` (default =
 *                          INDEXER_BACKFILL_FROM env or 100 below from),
 *                          enqueueing every block. Useful for filling
 *                          history without restarting the forward indexer.
 *
 * Architecture:
 *
 *     watcher (newHeads or polling)
 *           │ blockNumber
 *           ▼
 *     pg-boss queue (persistent, retries, dead-letter)
 *           │ job
 *           ▼
 *     N workers (configurable via INDEXER_WORKERS), call traceBlockJob()
 *           │ writes
 *           ▼
 *     Postgres (blocks, tx_executions, conflicts, block_hot_slots,
 *               indexer_cursor)
 *
 * Clean shutdown on SIGTERM/SIGINT:
 *   1. Stop the watcher (no new jobs queued)
 *   2. Wait for in-flight jobs to drain (with a timeout)
 *   3. Stop pg-boss
 *   4. Close Postgres pool
 */

import PgBoss from "pg-boss";
import { closePool, query } from "../src/lib/db";
import { startWatcher, type BlockHead } from "../src/lib/indexer/watcher";
import {
  traceBlockJob,
  TRACE_BLOCK_QUEUE,
  type TraceBlockJob,
} from "../src/lib/indexer/worker";

// ─── env helpers ──────────────────────────────────────────────────

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

function envStr(name: string): string {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set in .env.local`);
  return raw;
}

// ─── config ───────────────────────────────────────────────────────

const config = {
  databaseUrl: envStr("DATABASE_URL"),
  rpcUrl: envStr("MONAD_RPC_URL"),
  wsUrl: process.env.MONAD_WS_URL || undefined,
  // 8 workers + pollingIntervalSeconds=0.5 (pg-boss minimum) gives a
  // steady-state throughput of ~16 blocks/sec, ~8× chain rate. Leaves
  // plenty of headroom for bursts and ensures `live` priority jobs
  // always win the race against any backfill load.
  workers: envInt("INDEXER_WORKERS", 8),
  finalityLag: envInt("INDEXER_FINALITY_LAG", 2),
  backfillFromOverride: process.env.INDEXER_BACKFILL_FROM
    ? parseInt(process.env.INDEXER_BACKFILL_FROM, 10)
    : null,
};

// ─── pg-boss setup ────────────────────────────────────────────────

async function startBoss(): Promise<PgBoss> {
  // pg-boss creates its own schema (`pgboss`) on first start. Since
  // pev_app owns the database, it can do this.
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    // Conservative knobs, testnet is low-volume; we don't need aggressive
    // queue tuning. Bump these later if mainnet pushes us into multi-second
    // index lag.
    retentionDays: 7,
    deleteAfterDays: 7,
    maintenanceIntervalSeconds: 60,
  });

  boss.on("error", (err) => {
    console.error("[boss] error:", err.message);
  });

  await boss.start();
  // Idempotent, first start creates the queue, subsequent starts no-op.
  await boss.createQueue(TRACE_BLOCK_QUEUE);
  return boss;
}

// ─── job submission ──────────────────────────────────────────────

async function enqueue(
  boss: PgBoss,
  blockNumber: number,
  mode: "live" | "backfill",
): Promise<void> {
  const job: TraceBlockJob = { blockNumber, mode };
  // Singleton key prevents the same block being indexed twice
  // concurrently if both the live watcher and a backfill emit it.
  //
  // PRIORITY: live blocks always cut the line ahead of backfill jobs.
  // pg-boss orders the queue by `priority DESC, created_on ASC`, so
  // anything with priority > 0 gets dequeued first. This means a 60K-job
  // backfill no longer starves the live tail, workers keep up with the
  // chain head and only chew through backfill in the leftover capacity.
  // (Learned the hard way at ~5K-block lag during the first big backfill.)
  await boss.send(TRACE_BLOCK_QUEUE, job, {
    priority: mode === "live" ? 10 : 0,
    singletonKey: `block:${blockNumber}`,
    singletonHours: 1,
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: 5, // seconds; backoff doubles
    expireInHours: 1,
  });
}

// ─── modes ────────────────────────────────────────────────────────

async function runForward(boss: PgBoss, abort: AbortController): Promise<void> {
  console.log(
    `[indexer] forward mode · finality_lag=${config.finalityLag} · ` +
      `transport=${config.wsUrl ? "ws" : "poll"}`,
  );

  const watcher = startWatcher({
    rpcUrl: config.rpcUrl,
    wsUrl: config.wsUrl,
    finalityLag: config.finalityLag,
    signal: abort.signal,
  });

  for await (const head of watcher as AsyncIterable<BlockHead>) {
    if (abort.signal.aborted) break;
    await enqueue(boss, head.blockNumber, "live");
  }
}

async function runBackfill(
  boss: PgBoss,
  abort: AbortController,
): Promise<void> {
  // Determine [from, to] range
  const headRes = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    }),
  });
  const headJson = (await headRes.json()) as { result: string };
  const head = parseInt(headJson.result, 16);
  const safeHead = head - config.finalityLag;

  // CLI args: scripts/indexer.ts --backfill [from] [to]
  const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const from = cliArgs[0] ? parseInt(cliArgs[0], 10) : safeHead;
  const to =
    cliArgs[1] !== undefined
      ? parseInt(cliArgs[1], 10)
      : config.backfillFromOverride ?? Math.max(0, from - 100);

  if (!(from >= to && to >= 0)) {
    throw new Error(
      `backfill requires from >= to >= 0 (got from=${from}, to=${to})`,
    );
  }

  console.log(
    `[indexer] backfill mode · ${from.toLocaleString()} → ${to.toLocaleString()}  ` +
      `(${(from - to + 1).toLocaleString()} blocks)`,
  );

  // Walk newest → oldest. Each enqueue is fast (just a DB INSERT).
  // The actual tracing happens concurrently in the worker pool.
  for (let n = from; n >= to; n--) {
    if (abort.signal.aborted) break;
    await enqueue(boss, n, "backfill");
    if (n % 100 === 0) {
      console.log(`[indexer] enqueued backfill down to #${n.toLocaleString()}`);
    }
  }
  console.log("[indexer] backfill enqueueing complete; workers continue draining the queue");
}

// ─── worker registration ─────────────────────────────────────────

async function startWorkers(boss: PgBoss): Promise<void> {
  // pg-boss v10: handler receives a batch of up to `batchSize` jobs.
  // We process them concurrently via Promise.all, that's our worker pool.
  //
  // POLLING INTERVAL: was 1 second, which capped throughput at
  // batchSize / 1s = 4 blocks/sec regardless of how fast traces actually
  // ran (~80-110ms each). Workers were idle ~85% of the time waiting on
  // the polling tick. Dropping to 0.5s (pg-boss's hard minimum, anything
  // lower throws AssertionError) plus bumping batchSize to 8 lifts
  // steady-state throughput to ~16 blocks/sec. Combined with `priority`
  // on enqueue, live always cuts the line ahead of backfill, so a big
  // backfill no longer creates lag.
  await boss.work<TraceBlockJob>(
    TRACE_BLOCK_QUEUE,
    { batchSize: config.workers, pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      await Promise.all(
        jobs.map(async (j) => {
          try {
            await traceBlockJob(j.data);
          } catch (err) {
            console.error(
              `[indexer] block #${j.data.blockNumber} failed:`,
              (err as Error).message,
            );
            throw err; // let pg-boss retry
          }
        }),
      );
    },
  );
  console.log(
    `[indexer] worker pool started · concurrency=${config.workers} · queue=${TRACE_BLOCK_QUEUE}`,
  );
}

// ─── lifecycle ────────────────────────────────────────────────────

async function reportCursorOnStart(): Promise<void> {
  const row = await query<{ last_indexed_block: string; last_indexed_at: Date }>(
    "SELECT last_indexed_block::text, last_indexed_at FROM indexer_cursor WHERE id = 1",
  );
  const r = row.rows[0];
  if (r && parseInt(r.last_indexed_block, 10) > 0) {
    console.log(
      `[indexer] resuming · last_indexed_block=${parseInt(
        r.last_indexed_block,
        10,
      ).toLocaleString()} · at ${r.last_indexed_at.toISOString()}`,
    );
  } else {
    console.log("[indexer] fresh start · cursor at 0");
  }
}

async function main(): Promise<void> {
  const isBackfill = process.argv.includes("--backfill");

  console.log(`[indexer] starting in ${isBackfill ? "backfill" : "forward"} mode`);
  await reportCursorOnStart();

  const boss = await startBoss();
  await startWorkers(boss);

  const abort = new AbortController();
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[indexer] received ${signal}, shutting down…`);
    abort.abort();
    // Give in-flight jobs ~10s to finish before forcing stop
    try {
      await Promise.race([
        boss.stop({ graceful: true, timeout: 10_000 }),
        new Promise((resolve) => setTimeout(resolve, 12_000)),
      ]);
    } catch (e) {
      console.warn("[indexer] boss shutdown error:", (e as Error).message);
    }
    await closePool();
    console.log("[indexer] bye");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (isBackfill) {
    await runBackfill(boss, abort);
    // After enqueueing backfill jobs, hold the process open so workers
    // can drain the queue. User can Ctrl-C when done.
    console.log("[indexer] backfill enqueued. Workers running. Ctrl-C to stop.");
    await new Promise(() => {}); // park
  } else {
    await runForward(boss, abort);
  }
}

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
