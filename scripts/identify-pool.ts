/**
 * scripts/identify-pool.ts
 *
 * One-shot helper for labeling Uniswap V3-style pool contracts on
 * Monad. Given a pool address, probe the chain for token0/token1/fee,
 * cross-reference our existing labels, then print ready-to-paste YAML
 * for any new tokens + the pool itself.
 *
 * Saves the 2-3 minutes of manual RPC probing each time a maintainer
 * surfaces a new pool. Pattern is generic enough to work for any V3
 * AMM (Capricorn, PancakeSwap V3, Uniswap V3 itself, future protocols).
 *
 * Usage:
 *   npx tsx scripts/identify-pool.ts <pool-address> [--project Name]
 *
 * Examples:
 *   npx tsx scripts/identify-pool.ts 0x139aabfa1caab845c3333bf22dc3054a6e5e382b
 *   npx tsx scripts/identify-pool.ts 0x... --project "PancakeSwap V3"
 *
 * Prints YAML entries that you can copy into data/contract-labels.yaml,
 * then commit + deploy + sync as usual.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC_URL = process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";

// Uniswap V3 pool function selectors (also matches Capricorn CL, PancakeSwap V3, etc.)
const SEL_TOKEN0 = "0x0dfe1681"; // token0()
const SEL_TOKEN1 = "0xd21220a7"; // token1()
const SEL_FEE = "0xddca3f43"; // fee()

// ERC-20 selectors for token identification
const SEL_NAME = "0x06fdde03"; // name()
const SEL_SYMBOL = "0x95d89b41"; // symbol()

interface CliArgs {
  pool: string;
  project: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let pool = "";
  let project = "Capricorn"; // default since most of our pool labels are Capricorn

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project" && i + 1 < args.length) {
      project = args[++i];
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!pool && a.startsWith("0x")) {
      pool = a;
    } else if (!pool && /^[0-9a-fA-F]{40}$/.test(a)) {
      pool = `0x${a}`;
    }
  }

  if (!pool) {
    console.error("Error: pool address required.\n");
    printHelp();
    process.exit(2);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool)) {
    console.error(`Error: '${pool}' is not a valid 0x-prefixed 40-hex address.`);
    process.exit(2);
  }
  return { pool: pool.toLowerCase(), project };
}

function printHelp() {
  console.error("Usage: npx tsx scripts/identify-pool.ts <pool-address> [--project Name]");
  console.error("");
  console.error("Probes a Uniswap V3-style pool for its tokens and fee tier,");
  console.error("then prints ready-to-paste YAML for data/contract-labels.yaml.");
  console.error("");
  console.error("Options:");
  console.error("  --project Name    Project prefix in the label (default: 'Capricorn')");
  console.error("  --help            Show this help");
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
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string; error?: unknown };
    return typeof json.result === "string" ? json.result : null;
  } catch {
    return null;
  }
}

/**
 * Decode an ABI-encoded single string return.
 * Layout: [32B offset=0x20][32B length][length bytes padded to 32B mult]
 */
function decodeAbiString(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length < 128) return null;
  try {
    const len = parseInt(h.slice(64, 128), 16);
    if (!Number.isFinite(len) || len <= 0 || len > 256) return null;
    const dataHex = h.slice(128, 128 + len * 2);
    if (dataHex.length < len * 2) return null;
    const decoded = Buffer.from(dataHex, "hex").toString("utf8").trim();
    if (!/^[\x20-\x7e -￿]+$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Decode a 32-byte address return value. Last 20 bytes of the
 * 32-byte word are the address.
 */
function decodeAddress(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length < 64) return null;
  const addr = "0x" + h.slice(-40).toLowerCase();
  if (addr === "0x" + "0".repeat(40)) return null;
  return addr;
}

/**
 * Decode a uint return (e.g. fee in bps).
 */
function decodeUint(hex: string | null): number | null {
  if (!hex || hex === "0x") return null;
  try {
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

interface TokenInfo {
  address: string;
  /** Existing label from YAML, if any */
  yamlLabel: string | null;
  /** On-chain name() */
  onChainName: string | null;
  /** On-chain symbol() */
  onChainSymbol: string | null;
}

async function fetchTokenInfo(address: string, yaml: string): Promise<TokenInfo> {
  // Search YAML for existing label. We look for the address (case
  // insensitive) followed by a name: line within a few lines.
  let yamlLabel: string | null = null;
  const lower = address.toLowerCase();
  const idx = yaml.toLowerCase().indexOf(lower);
  if (idx >= 0) {
    // Find the name: field in the next ~5 lines after the address
    const after = yaml.slice(idx, idx + 400);
    const nameMatch = after.match(/name:\s*"([^"]+)"/);
    if (nameMatch) yamlLabel = nameMatch[1];
  }

  const [nameHex, symbolHex] = await Promise.all([
    rpcCall(address, SEL_NAME),
    rpcCall(address, SEL_SYMBOL),
  ]);

  return {
    address: lower,
    yamlLabel,
    onChainName: decodeAbiString(nameHex),
    onChainSymbol: decodeAbiString(symbolHex),
  };
}

function feeToPct(bps: number): string {
  // Uniswap V3 fee tiers are in hundredths of a bp:
  //   100 → 0.01%, 500 → 0.05%, 3000 → 0.3%, 10000 → 1%
  const pct = bps / 10000;
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(2)}%`;
}

/**
 * Pick the display label for a token in a pool name. We prefer the
 * on-chain SYMBOL ("WMON") over the full name ("Wrapped MON") because
 * pool labels read cleaner as "WMON/SHARKIE" than "Wrapped MON/SHARKIE".
 * The convention in our existing YAML uses symbols for pool names.
 *
 * Fallback order:
 *   1. On-chain symbol() ← preferred (cleanest, universal ticker form)
 *   2. Symbol parenthesized inside YAML label, e.g. "Wrapped MON (WMON)"
 *   3. Raw YAML label, e.g. "Perpl"
 *   4. On-chain name() if no YAML or symbol
 *   5. Short hex (last resort)
 */
function tokenDisplayLabel(info: TokenInfo): string {
  if (info.onChainSymbol) return info.onChainSymbol;
  if (info.yamlLabel) {
    const m = info.yamlLabel.match(/\(([^)]+)\)$/);
    if (m) return m[1];
    return info.yamlLabel;
  }
  return info.onChainName ?? `${info.address.slice(0, 6)}…${info.address.slice(-4)}`;
}

async function main() {
  const { pool, project } = parseArgs();

  // Load YAML once for label lookups.
  const yamlPath = resolve(__dirname, "..", "data", "contract-labels.yaml");
  let yaml = "";
  try {
    yaml = readFileSync(yamlPath, "utf8");
  } catch {
    console.error(`Warning: couldn't read ${yamlPath}. Token-label lookups will all return null.`);
  }

  // Check if the pool itself is already labeled.
  const poolAlready = yaml.toLowerCase().includes(pool);

  process.stderr.write(`Probing ${pool}...\n`);

  const [token0Hex, token1Hex, feeHex] = await Promise.all([
    rpcCall(pool, SEL_TOKEN0),
    rpcCall(pool, SEL_TOKEN1),
    rpcCall(pool, SEL_FEE),
  ]);

  const token0 = decodeAddress(token0Hex);
  const token1 = decodeAddress(token1Hex);
  const fee = decodeUint(feeHex);

  if (!token0 || !token1 || fee === null) {
    console.error("\nError: this doesn't look like a Uniswap V3-style pool.");
    console.error("       (token0(), token1(), and/or fee() didn't return valid data)");
    console.error("");
    console.error(`  token0 raw: ${token0Hex}`);
    console.error(`  token1 raw: ${token1Hex}`);
    console.error(`  fee raw:    ${feeHex}`);
    process.exit(3);
  }

  process.stderr.write(`  token0 = ${token0}\n`);
  process.stderr.write(`  token1 = ${token1}\n`);
  process.stderr.write(`  fee    = ${fee} bps (${feeToPct(fee)})\n`);
  process.stderr.write("  fetching token names...\n");

  const [info0, info1] = await Promise.all([
    fetchTokenInfo(token0, yaml),
    fetchTokenInfo(token1, yaml),
  ]);

  for (const [label, info] of [["token0", info0], ["token1", info1]] as const) {
    process.stderr.write(`  ${label}: yaml=${info.yamlLabel ?? "(none)"} on-chain=${info.onChainName ?? "?"} / ${info.onChainSymbol ?? "?"}\n`);
  }

  const t0Display = tokenDisplayLabel(info0);
  const t1Display = tokenDisplayLabel(info1);
  const poolLabel = `${project}: ${t0Display}/${t1Display} Pool (${feeToPct(fee)})`;

  console.log("");
  console.log("# ─────────────────────────────────────────────────────────────");
  console.log(`# Ready to paste into data/contract-labels.yaml`);
  console.log("# ─────────────────────────────────────────────────────────────");
  console.log("");

  // Token entries first (only if not already labeled)
  const newTokenEntries: TokenInfo[] = [];
  if (!info0.yamlLabel && info0.onChainName) newTokenEntries.push(info0);
  if (!info1.yamlLabel && info1.onChainName) newTokenEntries.push(info1);

  if (newTokenEntries.length > 0) {
    console.log(`  # New ERC-20 token${newTokenEntries.length === 1 ? "" : "s"} (paired in the pool below)`);
  }
  for (const t of newTokenEntries) {
    console.log(`  - address: ${t.address}`);
    console.log(`    name: "${t.onChainName}"`);
    console.log(`    source: erc20`);
    if (t.onChainSymbol) {
      console.log(`    symbol: "${t.onChainSymbol}"`);
    }
    console.log(`    notes: "ERC20 token, on-chain name()='${t.onChainName}'${t.onChainSymbol ? ` symbol()='${t.onChainSymbol}'` : ""}. Paired in ${project} pool ${pool}."`);
  }

  if (poolAlready) {
    console.log("");
    console.log(`# Pool ${pool} is ALREADY in YAML, here's what it would look like:`);
  }
  console.log(`  - address: ${pool}`);
  console.log(`    name: "${poolLabel}"`);
  console.log(`    source: manual`);
  console.log(`    notes: "${project} pool. token0=${t0Display} (${token0}), token1=${t1Display} (${token1}), fee=${fee} bps (${feeToPct(fee)})."`);
  console.log("");

  // Summary footer for quick scanning
  process.stderr.write("\n");
  process.stderr.write(`Summary: ${poolLabel}\n`);
  if (newTokenEntries.length > 0) {
    process.stderr.write(`         Plus ${newTokenEntries.length} new token entr${newTokenEntries.length === 1 ? "y" : "ies"} above.\n`);
  } else {
    process.stderr.write(`         Both tokens already labeled.\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
