/**
 * scripts/probe-contract-labels.ts
 *
 * One-shot script for the pev launch: take a list of "important" Monad
 * contract addresses, try to discover their human-readable name from
 * two ethical sources, and output a YAML file we can hand-edit before
 * loading into the contract_labels table.
 *
 * Source 1: on-chain ERC-20 name() and symbol(). For token contracts,
 *           LP tokens, vault shares, staking derivatives. Free and
 *           authoritative (the chain is the source of truth).
 *
 * Source 2: Sourcify metadata. For any verified contract, the compiled
 *           metadata.json carries the contract class name. Useful for
 *           DEX routers, lending pools, NFT contracts, anything the
 *           project bothered to verify.
 *
 * What this script will NOT do: scrape monadvision.com or any other
 * peer tool's website. Those names belong in our YAML as manual entries
 * after the maintainer (you) does the research in a browser. See the
 * `# TODO` comments in the output.
 *
 * Usage:
 *   npx tsx scripts/probe-contract-labels.ts \
 *     /tmp/pev-top-contracts.csv \
 *     > data/contract-labels.yaml
 *
 * Input format (CSV, pipe-delimited):
 *   0x<address>|<conflicts>|<touches>|<tx_count>
 *
 * Output format (YAML):
 *   - address: 0x...
 *     name: "Discovered Name"
 *     source: erc20 | sourcify | TODO
 *     notes: optional context
 */

import { readFileSync } from "node:fs";

const RPC_URL = process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";
const MONAD_CHAIN_ID = 143;
const SOURCIFY_REPO = "https://repo.sourcify.dev/contracts";

const NAME_SELECTOR = "0x06fdde03"; // name()
const SYMBOL_SELECTOR = "0x95d89b41"; // symbol()

// Pause between probes so we don't hammer the RPC or Sourcify. Sourcify
// in particular has been known to throttle aggressive clients. 100ms
// between addresses keeps us under any reasonable rate limit while
// finishing all 100 in well under a minute.
const DELAY_MS = 100;

interface InputRow {
  address: string;
  conflicts: number;
  touches: number;
  txCount: number;
}

interface ProbeResult {
  address: string;
  // What we'd write to the YAML.
  name: string | null;
  symbol: string | null;
  source: "erc20" | "sourcify" | "none";
  sourcifyContractName: string | null;
  // For sorting + notes
  conflicts: number;
  txCount: number;
}

async function rpcCall(to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (typeof json.result === "string") return json.result;
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode an ABI-encoded single string return.
 * Layout: [32B offset=0x20][32B length][length bytes padded to 32B mult]
 * Returns null if the data looks malformed or empty.
 */
function decodeAbiString(hex: string | null): string | null {
  if (!hex) return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  // Need at least offset(64) + length(64) hex chars to be a valid string.
  if (h.length < 128) return null;
  const lenHex = h.slice(64, 128);
  const len = parseInt(lenHex, 16);
  if (!Number.isFinite(len) || len <= 0 || len > 256) return null; // 256 is generous
  const dataHex = h.slice(128, 128 + len * 2);
  if (dataHex.length < len * 2) return null;
  try {
    const bytes = Buffer.from(dataHex, "hex");
    const decoded = bytes.toString("utf8");
    // Filter unprintable junk that some non-ERC20 contracts return.
    if (!/^[\x20-\x7e -￿]+$/.test(decoded)) return null;
    return decoded.trim();
  } catch {
    return null;
  }
}

async function probeErc20(
  address: string,
): Promise<{ name: string | null; symbol: string | null }> {
  const [nameRes, symbolRes] = await Promise.all([
    rpcCall(address, NAME_SELECTOR),
    rpcCall(address, SYMBOL_SELECTOR),
  ]);
  return {
    name: decodeAbiString(nameRes),
    symbol: decodeAbiString(symbolRes),
  };
}

/**
 * Pull the contract class name from Sourcify's metadata.json. Sourcify
 * supports both "full_match" (exact bytecode match) and "partial_match"
 * (metadata-only match). We try full first; partial as fallback.
 */
async function probeSourcify(address: string): Promise<string | null> {
  const addrLower = address.toLowerCase();
  for (const matchType of ["full_match", "partial_match"]) {
    const url = `${SOURCIFY_REPO}/${matchType}/${MONAD_CHAIN_ID}/${addrLower}/metadata.json`;
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) continue;
      const meta = (await res.json()) as {
        settings?: { compilationTarget?: Record<string, string> };
      };
      // compilationTarget maps source file path → contract class name.
      // Usually exactly one entry, the entry's value is what we want.
      const target = meta.settings?.compilationTarget;
      if (!target) continue;
      const names = Object.values(target).filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      if (names.length > 0) return names[0];
    } catch {
      // Network error, try next match type.
    }
  }
  return null;
}

function parseInput(csv: string): InputRow[] {
  return csv
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [address, conflicts, touches, txCount] = line.split("|");
      return {
        address: address.trim(),
        conflicts: parseInt(conflicts, 10) || 0,
        touches: parseInt(touches, 10) || 0,
        txCount: parseInt(txCount, 10) || 0,
      };
    });
}

function yamlEscape(s: string): string {
  // YAML strings with colons, quotes, or leading symbols need quoting.
  // Simplest safe approach: always wrap in double quotes and escape
  // any embedded double quotes / backslashes.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "usage: tsx scripts/probe-contract-labels.ts <input-csv> > <output.yaml>",
    );
    process.exit(2);
  }

  const csv = readFileSync(inputPath, "utf8");
  const rows = parseInput(csv);
  process.stderr.write(`Probing ${rows.length} contracts...\n`);

  const results: ProbeResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stderr.write(`  [${i + 1}/${rows.length}] ${row.address}... `);

    // Try ERC-20 first. If we get a name, we don't need Sourcify (the
    // on-chain name is more authoritative for tokens).
    const erc20 = await probeErc20(row.address);
    let sourcifyName: string | null = null;
    let source: ProbeResult["source"] = "none";
    let name: string | null = null;

    if (erc20.name) {
      name = erc20.name;
      source = "erc20";
      process.stderr.write(`ERC20: ${erc20.name} (${erc20.symbol ?? "?"})\n`);
    } else {
      sourcifyName = await probeSourcify(row.address);
      if (sourcifyName) {
        name = sourcifyName;
        source = "sourcify";
        process.stderr.write(`Sourcify: ${sourcifyName}\n`);
      } else {
        process.stderr.write(`(no auto-label)\n`);
      }
    }

    results.push({
      address: row.address,
      name,
      symbol: erc20.symbol,
      source,
      sourcifyContractName: sourcifyName,
      conflicts: row.conflicts,
      txCount: row.txCount,
    });

    await sleep(DELAY_MS);
  }

  // Summary to stderr.
  const labeled = results.filter((r) => r.name).length;
  const erc20Count = results.filter((r) => r.source === "erc20").length;
  const sourcifyCount = results.filter((r) => r.source === "sourcify").length;
  const todoCount = results.filter((r) => r.source === "none").length;
  process.stderr.write(
    `\nSummary: ${labeled}/${rows.length} auto-labeled ` +
      `(${erc20Count} ERC20, ${sourcifyCount} Sourcify, ${todoCount} TODO)\n`,
  );

  // Emit YAML to stdout.
  const today = new Date().toISOString().slice(0, 10);
  console.log("# pev contract labels");
  console.log(
    "# Generated by scripts/probe-contract-labels.ts on " + today + ".",
  );
  console.log(
    "# Auto-labels come from on-chain ERC-20 calls and Sourcify metadata.",
  );
  console.log(
    "# Entries marked `source: TODO` need a human to research the name",
  );
  console.log(
    '# (open the address in a Monad explorer or check the project\'s docs/X).',
  );
  console.log("#");
  console.log("# After editing, run: npx tsx scripts/sync-contract-labels.ts");
  console.log("");
  console.log("contracts:");

  // Sort by source first (ERC20, Sourcify, then TODO) so the TODOs are
  // grouped at the bottom for easier hand-editing. Within each group,
  // sort by conflicts (most-shareable contracts first).
  const sourceOrder: Record<ProbeResult["source"], number> = {
    erc20: 0,
    sourcify: 1,
    none: 2,
  };
  results.sort((a, b) => {
    if (sourceOrder[a.source] !== sourceOrder[b.source]) {
      return sourceOrder[a.source] - sourceOrder[b.source];
    }
    return b.conflicts - a.conflicts;
  });

  for (const r of results) {
    console.log(`  - address: ${r.address}`);
    if (r.source === "none") {
      console.log(`    # TODO: research this address`);
      console.log(`    name: ""`);
      console.log(`    source: manual`);
    } else {
      console.log(`    name: ${yamlEscape(r.name!)}`);
      console.log(`    source: ${r.source}`);
    }
    if (r.symbol && r.source === "erc20") {
      console.log(`    symbol: ${yamlEscape(r.symbol)}`);
    }
    if (r.sourcifyContractName && r.source !== "sourcify") {
      console.log(`    sourcify_name: ${yamlEscape(r.sourcifyContractName)}`);
    }
    console.log(
      `    notes: "conflicts=${r.conflicts.toLocaleString()} txs=${r.txCount.toLocaleString()}"`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
