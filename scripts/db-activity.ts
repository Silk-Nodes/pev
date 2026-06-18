#!/usr/bin/env tsx
/**
 * db-activity.ts, a single cheap snapshot of what the shared Postgres is
 * doing right now. Used to diagnose "pev is lagging" incidents where the
 * indexer slows down: surfaces long-running queries, lock waits, and
 * idle-in-transaction sessions (e.g. a batch job that was SIGTERM'd
 * mid-query and left a transaction open holding locks).
 *
 * Reads only pg_stat_activity / pg_locks (catalog views, negligible
 * cost). Safe to run against a struggling DB.
 *
 * Usage:
 *   npm run db:activity
 */

import { closePool, query } from "../src/lib/db";

async function main() {
  // 1. Sessions that are NOT idle, ordered by how long the current
  //    query/transaction has been running. xact_start catches
  //    idle-in-transaction holders too.
  const act = await query<{
    pid: number;
    state: string;
    wait: string | null;
    xact_age: string | null;
    query_age: string | null;
    appname: string;
    q: string;
  }>(`
    SELECT pid,
           state,
           coalesce(wait_event_type || ':' || wait_event, '') AS wait,
           to_char(now() - xact_start, 'HH24:MI:SS')  AS xact_age,
           to_char(now() - query_start, 'HH24:MI:SS') AS query_age,
           coalesce(application_name, '')             AS appname,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS q
      FROM pg_stat_activity
     WHERE pid <> pg_backend_pid()
       AND (state <> 'idle' OR state IS NULL)
     ORDER BY xact_start NULLS LAST
  `);

  console.log(`\n== non-idle sessions (${act.rows.length}) ==`);
  for (const r of act.rows) {
    console.log(
      `pid ${r.pid} [${r.state}] xact:${r.xact_age ?? "-"} query:${r.query_age ?? "-"} ` +
        `wait:${r.wait || "-"} app:${r.appname}\n    ${r.q}`,
    );
  }

  // 2. Anyone blocked on a lock, and who's blocking them.
  const blocked = await query<{ blocked: number; blocker: number; q: string }>(`
    SELECT w.pid AS blocked,
           l.pid AS blocker,
           left(regexp_replace(b.query, '\\s+', ' ', 'g'), 100) AS q
      FROM pg_locks w
      JOIN pg_locks l
        ON w.locktype = l.locktype
       AND w.database IS NOT DISTINCT FROM l.database
       AND w.relation IS NOT DISTINCT FROM l.relation
       AND w.pid <> l.pid
      JOIN pg_stat_activity b ON b.pid = l.pid
     WHERE NOT w.granted AND l.granted
  `);
  console.log(`\n== lock waits (${blocked.rows.length}) ==`);
  for (const r of blocked.rows) {
    console.log(`pid ${r.blocked} blocked by ${r.blocker}: ${r.q}`);
  }

  // 3. Idle-in-transaction count (leaked transactions hold locks + bloat).
  const iit = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_stat_activity WHERE state = 'idle in transaction'`,
  );
  console.log(`\n== idle-in-transaction sessions: ${iit.rows[0].n} ==\n`);
}

main()
  .catch((err) => {
    console.error("[db:activity] error:", err);
    process.exit(1);
  })
  .finally(() => closePool());
