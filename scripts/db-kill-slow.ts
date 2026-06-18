#!/usr/bin/env tsx
/**
 * db-kill-slow.ts, terminate long-running READ queries on the shared DB.
 *
 * Why: when a batch job (analytics / cooccurrence refresh) is stopped via
 * systemd, the Node client dies but Postgres keeps executing the in-flight
 * query until it finishes and tries to return rows. Those orphaned
 * multi-minute aggregations saturate disk IO and starve the live indexer.
 * pg_cancel_backend is ignored by IO-stuck queries, so we pg_terminate.
 *
 * SAFETY: only terminates backends whose query is a read (starts with
 * SELECT or WITH) and has been running longer than the threshold. Never
 * touches INSERT/UPDATE/DELETE/COPY (the indexer's writes) or DDL.
 *
 * Usage:
 *   npm run db:kill-slow              # kill read queries older than 60s
 *   npm run db:kill-slow -- 120       # custom threshold in seconds
 *   npm run db:kill-slow -- 60 dry    # show what would be killed, don't
 */

import { closePool, query } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const seconds = Number(args.find((a) => /^\d+$/.test(a))) || 60;
  const dry = args.includes("dry");

  // Candidates: active read queries older than the threshold. The regex
  // guard is belt-and-suspenders alongside the WHERE so a dry-run shows
  // exactly the same set that a real run would terminate.
  const found = await query<{
    pid: number;
    age: string;
    wait: string | null;
    q: string;
  }>(
    `SELECT pid,
            to_char(now() - query_start, 'HH24:MI:SS') AS age,
            coalesce(wait_event_type || ':' || wait_event, '') AS wait,
            left(regexp_replace(query, '\\s+', ' ', 'g'), 120) AS q
       FROM pg_stat_activity
      WHERE state = 'active'
        AND pid <> pg_backend_pid()
        AND now() - query_start > make_interval(secs => $1)
        AND query ~* '^\\s*(SELECT|WITH)\\y'
        AND query !~* '^\\s*(INSERT|UPDATE|DELETE|COPY|ANALYZE|VACUUM|CREATE|DROP|ALTER)\\y'
      ORDER BY query_start`,
    [seconds],
  );

  if (found.rows.length === 0) {
    console.log(`No active read queries older than ${seconds}s. Nothing to do.`);
    return;
  }

  console.log(`${dry ? "[DRY RUN] would terminate" : "Terminating"} ${found.rows.length} read quer${found.rows.length === 1 ? "y" : "ies"} older than ${seconds}s:\n`);
  for (const r of found.rows) {
    console.log(`  pid ${r.pid} age:${r.age} wait:${r.wait || "-"}\n    ${r.q}`);
  }
  if (dry) return;

  console.log("");
  for (const r of found.rows) {
    const res = await query<{ ok: boolean }>(
      `SELECT pg_terminate_backend($1) AS ok`,
      [r.pid],
    );
    console.log(`  pid ${r.pid}: ${res.rows[0].ok ? "terminated" : "could not terminate"}`);
  }
}

main()
  .catch((err) => {
    console.error("[db:kill-slow] error:", err);
    process.exit(1);
  })
  .finally(() => closePool());
