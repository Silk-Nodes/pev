#!/usr/bin/env tsx
/**
 * refresh-cooccurrence-graph.ts, build the relationship-graph payload
 * and upsert it into cooccurrence_cache.
 *
 * Reads ONLY the pre-aggregated contract_pair_daily rollup (light), not
 * the source tables, so it is safe to run on a timer. The /graph page
 * reads the cache row (~5ms); this does the work in the background.
 *
 * Schedule it OFFSET from the analytics refresh so two heavy-ish jobs
 * never collide (e.g. analytics on the hour, this at :30).
 *
 * Usage:
 *   npm run cooccurrence:graph                 # default window/topN
 *   npm run cooccurrence:graph -- --top=60 --window=7
 *
 * Exit codes:
 *   0  cache updated
 *   1  failure
 *   2  empty (no pairs in window; cache left untouched)
 */

import { closePool } from "../src/lib/db";
import {
  getCooccurrenceGraph,
  writeCooccurrenceCache,
} from "../src/lib/indexer/store";

function intArg(name: string, fallback: number): number {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  if (!a) return fallback;
  const n = parseInt(a.split("=")[1], 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<number> {
  const windowDays = intArg("window", 7);
  const topNodes = intArg("top", 50);
  const minEdge = intArg("min-edge", 20);
  const maxEdges = intArg("max-edges", 400);

  const startedAt = Date.now();
  console.log(
    `[cooccurrence-graph] starting at ${new Date().toISOString()} ` +
      `window=${windowDays}d top=${topNodes} minEdge=${minEdge}`,
  );

  const graph = await getCooccurrenceGraph(windowDays, topNodes, minEdge, maxEdges);
  const elapsedMs = Date.now() - startedAt;

  if (graph.edges.length === 0) {
    console.warn(
      `[cooccurrence-graph] no edges in window (rollup empty / backfill not done?), leaving cache untouched`,
    );
    return 2;
  }

  await writeCooccurrenceCache(graph, elapsedMs);
  console.log(
    `[cooccurrence-graph] cache updated in ${elapsedMs}ms · ` +
      `${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
      `${graph.totalPairs.toLocaleString()} total pairs in window`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[cooccurrence-graph] fatal: ${(err as Error).message}`);
    console.error((err as Error).stack);
    await closePool();
    process.exit(1);
  });
