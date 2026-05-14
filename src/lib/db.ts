/**
 * db.ts, Postgres connection pool + small typed query helpers.
 *
 * Used by:
 *   • Server components (block page, landing), read indexed data
 *   • API route handlers (Phase 4), read indexed data
 *   • Indexer (`scripts/indexer.ts`), write traced blocks
 *   • Migration runner (`scripts/migrate.ts`), schema management
 *
 * Connection pool sizing:
 *   • Next.js: each Node process = one pool, max 10 connections is fine
 *     for our read-heavy workload (most reads hit the JSONB blob in 1
 *     query)
 *   • Indexer: separate process, separate pool, max 6 (one per worker
 *     plus headroom)
 *
 * Pool is created lazily so importing this module from a context
 * without DATABASE_URL set (e.g. a test) doesn't error at import time.
 */

import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

let _pool: Pool | null = null;

function buildPoolConfig(): PoolConfig {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Postgres connection string.",
    );
  }
  return {
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // Keep idle clients around, avoid handshake on every request
    idleTimeoutMillis: 30_000,
    // Fail fast if the server is unreachable rather than hanging
    connectionTimeoutMillis: 5_000,
    // Allow self-signed certs for local/private-network Postgres if
    // DATABASE_URL includes ?sslmode=require but no CA chain
    ssl: url.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

/**
 * Get the shared pg pool. Created on first call.
 * In long-running processes (indexer) keep it for the lifetime of the
 * process; in serverless contexts (Next.js route handlers) the pool is
 * scoped to the warm container's lifetime.
 */
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(buildPoolConfig());
    _pool.on("error", (err) => {
      // Pool-level error: a client died while idle. Pool will recover.
      // Log but don't crash; individual queries will throw if affected.
      console.error("[db] pool error:", err.message);
    });
  }
  return _pool;
}

/**
 * Run a parameterized query. Thin wrapper that infers the row type so
 * call sites don't have to type the generic at every call.
 *
 * Example:
 *   const { rows } = await query<{ number: string; tx_count: number }>(
 *     "SELECT number::text, tx_count FROM blocks WHERE number = $1",
 *     [blockNumber],
 *   );
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Convenience: run a query and return just the rows.
 */
export async function queryRows<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Convenience: run a query and return the first row, or null.
 * Useful for primary-key lookups.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction with a Postgres `statement_timeout`
 * set, so any query that exceeds the budget is canceled by the server
 * and surfaces to JS as `error.code === '57014'` (query_canceled).
 *
 * We use this for the contract page queries. Without a server-side
 * timeout, popular contracts in `?window=all` mode could chew through
 * 30+ seconds, eventually returning a Cloudflare 504 (gateway timeout)
 * to the user. With it, we fail fast inside our budget and the page
 * can auto-narrow to a smaller window with a notice.
 *
 * The timeout is `SET LOCAL`, so it auto-resets when the transaction
 * ends; the connection returns to the pool clean. Read-only by
 * convention, callers should not write inside.
 *
 * IMPORTANT: a single PoolClient serializes queries. If you run several
 * queries inside `fn` they execute back-to-back on the same connection,
 * NOT in parallel. Promise.all on the same client just queues them.
 * To actually parallelize, use `runWithStatementTimeout` (one query
 * per connection) and Promise.all those.
 */
export async function withStatementTimeout<T>(
  timeoutMs: number,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // Swallow; the original error is what we want to surface.
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a single SQL statement on its own connection with a per-statement
 * timeout. Designed to be Promise.all'd across multiple SQL strings so
 * the queries actually run in parallel on separate connections (rather
 * than queued on one client like withStatementTimeout would).
 *
 * Use case: the contract page issues 4 independent aggregates. Running
 * them serially on one client gave a worst-case time of 4 × budget,
 * which on `?window=all` for popular contracts pushed past Cloudflare's
 * 30s ceiling and yielded 504. With this helper, total time = max of
 * the 4 query times instead of the sum, and any single query's timeout
 * fires independently.
 */
export async function runWithStatementTimeout<T extends QueryResultRow = QueryResultRow>(
  timeoutMs: number,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await client.query<T>(text, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // Swallow; the original error is what we want to surface.
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Postgres SQLSTATE for `query_canceled`. Postgres raises this when a
 * statement is canceled either by `pg_cancel_backend` or, in our case,
 * because `statement_timeout` elapsed. Useful so callers can branch on
 * "timed out, try a smaller window" vs. other DB errors.
 */
export const PG_QUERY_CANCELED = "57014";

/**
 * Run a function inside a transaction. Commits on success, rolls back
 * on error. Used by the indexer to write a block + its txs + conflicts
 * + hot slots atomically.
 */
export async function withTransaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* swallow, primary error is more useful */
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cleanly shut down the pool. Used by long-running scripts on SIGTERM.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Returns true if the timescaledb extension is installed in the current
 * database. Used by the migration runner to decide whether to apply
 * 002_timescale.sql.
 */
export async function hasTimescaleDB(): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS exists",
  );
  return row?.exists ?? false;
}
