/**
 * indexer/worker.ts, per-block job handler.
 *
 * One job = "trace block N and write the result to Postgres."
 * This module exports the handler function that pg-boss invokes for each
 * trace-block job. It also exports a small helper to enqueue a job.
 *
 * Idempotent: re-running for the same block overwrites cleanly (see
 * store.writeBlock, it DELETEs and re-INSERTs per-block-scoped rows).
 *
 * The handler retries ARE handled by pg-boss (configured in scripts/indexer.ts)
 * with exponential backoff; we just throw on failure and let the queue
 * decide whether to retry or dead-letter.
 */

import { probeBlock } from "@/lib/parallel-probe";
import { probeToPEV } from "@/lib/probe-to-pev";
import { writeBlock } from "./store";

export const TRACE_BLOCK_QUEUE = "trace-block";
export const ENGINE_VERSION = 1;

export interface TraceBlockJob {
  blockNumber: number;
  /** "live" = forward indexer just saw this block.
   *  "backfill" = walking backwards through history. */
  mode: "live" | "backfill";
}

export interface TraceBlockResult {
  blockNumber: number;
  txCount: number;
  conflictCount: number;
  parallelismScore: number;
  totalMs: number;
}

/**
 * Trace one block and persist it. Throws on RPC or DB failure, the queue
 * will retry. Logs a one-line summary on success.
 */
export async function traceBlockJob(
  job: TraceBlockJob,
): Promise<TraceBlockResult> {
  const t0 = performance.now();
  const probe = await probeBlock(job.blockNumber);
  const pev = probeToPEV(probe);
  await writeBlock(probe, pev, ENGINE_VERSION);
  const elapsed = Math.round(performance.now() - t0);

  console.log(
    `[indexer] ${job.mode.padEnd(8)} #${job.blockNumber.toLocaleString().padStart(11)}  ` +
      `${String(probe.txCount).padStart(3)} tx · ` +
      `${String(probe.conflictCount).padStart(3)} conflicts · ` +
      `score ${String(pev.summary.parallelismScore).padStart(3)} · ` +
      `${String(elapsed).padStart(4)}ms`,
  );

  return {
    blockNumber: job.blockNumber,
    txCount: probe.txCount,
    conflictCount: probe.conflictCount,
    parallelismScore: pev.summary.parallelismScore,
    totalMs: elapsed,
  };
}
