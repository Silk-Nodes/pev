/**
 * scripts/sync-contract-labels.ts
 *
 * Read data/contract-labels.yaml and upsert each entry into the
 * `contract_labels` table. Idempotent: safe to re-run after editing
 * the YAML. Entries with empty `name` are skipped (those are still
 * TODOs awaiting research).
 *
 * The analytics page, contract pages, and OG card renderer all read
 * from `contract_labels` via lib/enrichment/index.ts → resolveManyContracts.
 * So once a label lands in this table, every UI surface that resolves
 * the address picks it up on the next request. No code changes needed.
 *
 * Usage (from the laptop, against the production DB):
 *
 *   DATABASE_URL='postgresql://...' npx tsx scripts/sync-contract-labels.ts
 *
 * Or from the VM, where DATABASE_URL is already in .env.production.local:
 *
 *   cd /home/zoltan/pev
 *   source <(grep -E '^DATABASE_URL=' .env.production.local)
 *   npx tsx scripts/sync-contract-labels.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

interface LabelEntry {
  address: string;
  name: string;
  source?: string;
  symbol?: string;
  notes?: string;
}

/**
 * Minimal YAML parser for our specific schema. We avoid pulling in a
 * full YAML dep just for this script. The format is fixed by the
 * generator (scripts/probe-contract-labels.ts) so we only need to
 * handle the exact structure we emit:
 *
 *   contracts:
 *     - address: 0x...
 *       name: "..."
 *       source: erc20 | sourcify | manual
 *       symbol: "..."     (optional, ERC-20 only)
 *       notes: "..."      (optional, free-form)
 *
 * Returns only entries with a non-empty name (the rest are TODOs we
 * intentionally skip).
 */
function parseLabelsYaml(yaml: string): LabelEntry[] {
  const entries: LabelEntry[] = [];
  let current: Partial<LabelEntry> | null = null;

  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/\r$/, "");
    // Comment or blank
    if (line.trim().startsWith("#") || line.trim() === "") continue;

    // New entry begins with "  - address:"
    const addrMatch = line.match(/^\s*-\s+address:\s*(\S+)/);
    if (addrMatch) {
      if (current && current.address && current.name) {
        entries.push(current as LabelEntry);
      }
      current = { address: addrMatch[1].trim().toLowerCase() };
      continue;
    }

    if (!current) continue;

    const fieldMatch = line.match(/^\s+(\w+):\s*(.*)$/);
    if (!fieldMatch) continue;
    const [, field, valueRaw] = fieldMatch;
    // Strip surrounding double quotes if present, unescape \" and \\.
    const value = valueRaw
      .replace(/^"(.*)"$/, "$1")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");

    if (field === "name") current.name = value;
    else if (field === "source") current.source = value;
    else if (field === "symbol") current.symbol = value;
    else if (field === "notes") current.notes = value;
  }

  // Flush the final entry
  if (current && current.address && current.name) {
    entries.push(current as LabelEntry);
  }

  // Filter out empty names (TODOs not yet researched).
  return entries.filter((e) => e.name.trim() !== "");
}

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(addr);
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/i, ""), "hex");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      "DATABASE_URL is not set. Source your .env.production.local or pass it inline.",
    );
    process.exit(2);
  }

  const yamlPath = resolve(__dirname, "..", "data", "contract-labels.yaml");
  const yaml = readFileSync(yamlPath, "utf8");
  const entries = parseLabelsYaml(yaml);

  console.log(`Found ${entries.length} labels to sync.`);
  const bySource: Record<string, number> = {};
  for (const e of entries) {
    bySource[e.source ?? "(none)"] = (bySource[e.source ?? "(none)"] ?? 0) + 1;
  }
  console.log("  by source:", bySource);

  // Validate addresses BEFORE opening the DB connection so a bad YAML
  // doesn't waste a connection slot.
  const invalid = entries.filter((e) => !isValidAddress(e.address));
  if (invalid.length > 0) {
    console.error("Invalid addresses (won't sync):");
    for (const e of invalid) console.error("  ", e.address);
    process.exit(3);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  let upserted = 0;
  let unchanged = 0;
  let updated = 0;

  for (const entry of entries) {
    const addr = hexToBuffer(entry.address);
    // Compose the display name. For ERC-20s we have a symbol available
    // and "Name (SYMBOL)" reads better in the leaderboard than just the
    // long name. For manual/sourcify entries the name is already
    // editorial-quality, no symbol decoration.
    const displayName =
      entry.source === "erc20" && entry.symbol
        ? `${entry.name} (${entry.symbol})`
        : entry.name;

    // Upsert with ON CONFLICT. We always set source so we can tell
    // YAML-sourced labels apart from Sourcify's automatic fetches.
    // We clear negative_until so previously-failed Sourcify lookups
    // don't shadow our manual entry.
    const result = await pool.query(
      `INSERT INTO contract_labels
         (address, name, source, negative_until, retrieved_at)
       VALUES ($1, $2, $3, NULL, now())
       ON CONFLICT (address) DO UPDATE
         SET name = EXCLUDED.name,
             source = EXCLUDED.source,
             negative_until = NULL,
             retrieved_at = now()
         WHERE
           contract_labels.name IS DISTINCT FROM EXCLUDED.name
           OR contract_labels.source IS DISTINCT FROM EXCLUDED.source
       RETURNING (xmax = 0) AS inserted`,
      [addr, displayName, entry.source ?? "manual"],
    );

    if (result.rowCount === 0) {
      unchanged++;
    } else if (result.rows[0].inserted) {
      upserted++;
    } else {
      updated++;
    }
  }

  await pool.end();

  console.log("");
  console.log(`Sync complete:`);
  console.log(`  ${upserted} new labels inserted`);
  console.log(`  ${updated} existing labels updated`);
  console.log(`  ${unchanged} unchanged (already current)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
