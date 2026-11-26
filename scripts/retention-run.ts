#!/usr/bin/env tsx
/**
 * retention-run.ts, one retention pass by hand. The indexer runs the same
 * pass every 15 minutes; this is for checking what it does.
 */
import { closePool } from "../src/lib/db";
import { runRetention } from "../src/lib/indexer/retention";

runRetention()
  .then((r) => {
    if (!r.active) console.log("[retention] INACTIVE: the big tables are not partitioned yet (run retention:cutover)");
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((err) => { console.error("[retention] FAILED:", (err as Error).message); process.exitCode = 1; })
  .finally(() => closePool());
