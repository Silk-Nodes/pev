#!/usr/bin/env tsx
/**
 * migrate.ts — applies SQL migrations from db/migrations/ in lexicographic
 * order. Each file is applied at most once (tracked in schema_migrations).
 *
 * Usage:
 *   npm run db:migrate           # apply pending migrations
 *   npm run db:status            # show what's applied vs pending
 *
 * Each migration:
 *   1. Files in db/migrations/ are applied in lexicographic order.
 *   2. Each file runs in its own transaction (the file should BEGIN/COMMIT
 *      itself, but the runner doesn't require it).
 *   3. The runner records (filename, sha256) in schema_migrations on success.
 *   4. 002_timescale.sql is SKIPPED if the timescaledb extension is not
 *      available — the warning is logged.
 *
 * On a fresh database the runner creates the schema_migrations table
 * implicitly (it's created by 001_initial.sql).
 */

import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool, hasTimescaleDB, closePool, queryRows } from "../src/lib/db";

// Env: run with `tsx --env-file=.env.local scripts/migrate.ts` (via npm script).

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

interface Migration {
  filename: string;
  sql: string;
  checksum: string;
  /** Special files that have a runtime gate (e.g. only run if extension exists) */
  optional: boolean;
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic order — relies on numbered prefixes (001_, 002_, …)

  return files.map((filename) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
    const optional = filename.includes("timescale");
    return { filename, sql, checksum, optional };
  });
}

async function getApplied(): Promise<Map<string, string>> {
  // Bootstrap: if schema_migrations doesn't exist yet (first run), nothing
  // is applied. We catch the error rather than pre-checking — saves a query.
  try {
    const rows = await queryRows<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    return new Map(rows.map((r) => [r.filename, r.checksum]));
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      // undefined_table — normal on first run
      return new Map();
    }
    throw err;
  }
}

async function applyMigration(m: Migration): Promise<void> {
  const pool = getPool();
  // Each migration manages its own BEGIN/COMMIT (see SQL files). We
  // record the schema_migrations row in a separate query so it's
  // guaranteed to land even if the migration is not transactional.
  await pool.query(m.sql);
  await pool.query(
    "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()",
    [m.filename, m.checksum],
  );
}

function printRow(filename: string, status: string, note = "") {
  const pad = filename.padEnd(28);
  const statusPad = status.padEnd(12);
  console.log(`  ${pad}  ${statusPad}  ${note}`);
}

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes("--status");

  const migrations = loadMigrations();
  const applied = await getApplied();
  const hasTS = await hasTimescaleDB();

  console.log(
    `\npev migrations · ${migrations.length} files · timescaledb ${hasTS ? "ON" : "OFF"}\n`,
  );
  printRow("FILENAME", "STATUS", "NOTE");
  printRow("─".repeat(28), "─".repeat(12), "─".repeat(40));

  let appliedNow = 0;
  let skipped = 0;

  for (const m of migrations) {
    const prevChecksum = applied.get(m.filename);
    const isApplied = prevChecksum !== undefined;

    if (m.optional && m.filename.includes("timescale") && !hasTS) {
      printRow(m.filename, "SKIPPED", "(timescaledb not installed)");
      skipped++;
      continue;
    }

    if (isApplied) {
      const drift = prevChecksum !== m.checksum;
      printRow(
        m.filename,
        drift ? "DRIFT" : "applied",
        drift
          ? `⚠ checksum changed: ${prevChecksum} → ${m.checksum}`
          : "",
      );
      continue;
    }

    if (statusOnly) {
      printRow(m.filename, "PENDING", "(would apply)");
      continue;
    }

    process.stdout.write(`  ${m.filename.padEnd(28)}  applying…    `);
    try {
      await applyMigration(m);
      console.log("✓");
      appliedNow++;
    } catch (err) {
      console.log("✗");
      console.error(`\n  ERROR in ${m.filename}:\n  ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  console.log();
  if (statusOnly) {
    console.log(`Status only. ${migrations.length - applied.size - skipped} pending.\n`);
  } else {
    console.log(`Done. ${appliedNow} applied, ${skipped} skipped.\n`);
  }
}

main()
  .catch((err) => {
    console.error("\nFATAL:", err.message);
    process.exit(1);
  })
  .finally(() => closePool());
