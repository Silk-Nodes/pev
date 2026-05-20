import { NextRequest, NextResponse } from "next/server";
import { getLatestSafeBlockNumber } from "@/lib/parallel-probe";

/**
 * Smart search router. Auto-detects what the user pasted and routes
 * to the right page.
 *
 * GET /go?q=<input>  (or ?block=<input> for back-compat with the old form)
 *
 * Detection rules (case-insensitive, leading 0x optional):
 *   • "latest" / "head" / "tip"      → /block/<chain head>
 *   • 0x + 64 hex chars              → ASK CHAIN: tx hash OR block hash
 *                                       → /tx/<hash> or /block/<number>
 *   • 0x + 40 hex chars              → contract     → /contract/<addr>
 *   • bare 64 hex chars (no 0x)      → same as above with 0x prepended
 *   • bare 40 hex chars (no 0x)      → contract     → /contract/0x<addr>
 *   • integer (or 0x-prefixed)       → /block/<n>
 *   • anything else                  → /?q_error=1&q=<input>
 *
 * The 64-hex disambiguation is important: block hashes and tx hashes
 * have the identical format (32 bytes, 64 hex chars), and there's no
 * way to tell them apart by looking at the string. Without asking the
 * chain, we used to always assume "tx hash", which meant pasting a
 * block hash (the kind block explorers show in their URLs) would
 * route to a non-existent tx page. We now query both in parallel and
 * route based on which one the chain actually has.
 *
 * Input is normalized to accept commas (UI displays block #s with
 * thousands separators), underscores, leading #, and "block " prefix.
 */
export async function GET(req: NextRequest) {
  const raw = (
    req.nextUrl.searchParams.get("q") ??
    req.nextUrl.searchParams.get("block") ??
    ""
  ).trim();

  // Build the public-facing base URL once and reuse for every redirect.
  // Behind a Cloudflare tunnel `req.url` is the *internal* hostname the
  // Next.js server sees (`http://0.0.0.0:3003/...`), so building redirects
  // against it sends users to a non-routable address. See the publicBase()
  // helper below for the header chain we trust instead.
  const base = publicBase(req);

  if (!raw) {
    return NextResponse.redirect(new URL("/", base));
  }

  // Normalize before parsing. Common inputs we want to accept:
  //   "70,443,192"   (copy-pasted from the UI which uses toLocaleString)
  //   "70_443_192"   (numeric separator some users type)
  //   "#70443192"    (people prefix block numbers with #)
  //   "block 70443192" or "Block #70,443,192" (typed it out)
  //   " 0x abc... "  (stray whitespace from clipboard)
  // The regex tests below stay strict; this just sanitizes friendly input.
  const q = raw
    .replace(/^block\s+/i, "")
    .replace(/^#/, "")
    .replace(/[,_\s]/g, "");

  // "latest" / "head" / "tip", power-user shortcut, resolves the chain head
  if (/^(latest|head|tip)$/i.test(q)) {
    try {
      const latest = await getLatestSafeBlockNumber();
      return NextResponse.redirect(new URL(`/block/${latest}`, base));
    } catch {
      // Fall through to the error redirect below if the RPC is down
    }
  }

  // 64-hex hash with 0x prefix. Could be a tx hash OR a block hash;
  // disambiguate by asking the chain. See header doc for the why.
  if (/^0x[0-9a-f]{64}$/i.test(q)) {
    const normalized = q.toLowerCase();
    const dest = await routeHash(normalized);
    return NextResponse.redirect(new URL(dest, base));
  }

  // contract / EOA address, 20 bytes hex with 0x prefix
  if (/^0x[0-9a-f]{40}$/i.test(q)) {
    return NextResponse.redirect(new URL(`/contract/${q.toLowerCase()}`, base));
  }

  // 64-hex hash, bare (no 0x prefix). Same disambiguation path.
  if (/^[0-9a-f]{64}$/i.test(q)) {
    const normalized = `0x${q.toLowerCase()}`;
    const dest = await routeHash(normalized);
    return NextResponse.redirect(new URL(dest, base));
  }

  // address, bare 40 hex chars (no 0x prefix). Same reasoning.
  if (/^[0-9a-f]{40}$/i.test(q)) {
    return NextResponse.redirect(new URL(`/contract/0x${q.toLowerCase()}`, base));
  }

  // block number, decimal or 0x-prefixed integer
  const n = q.startsWith("0x") || q.startsWith("0X")
    ? parseInt(q, 16)
    : parseInt(q, 10);
  if (Number.isFinite(n) && n >= 0 && /^(0x[0-9a-f]+|\d+)$/i.test(q)) {
    return NextResponse.redirect(new URL(`/block/${n}`, base));
  }

  // Couldn't parse, bounce back to landing with the original input echoed
  // so the landing can show "couldn't parse 'foo'" instead of a silent reset.
  const errUrl = new URL("/", base);
  errUrl.searchParams.set("q_error", "1");
  errUrl.searchParams.set("q", raw.slice(0, 80));
  return NextResponse.redirect(errUrl);
}

/**
 * Build the public-facing base URL the user actually visited, from the
 * proxy headers Cloudflare tunnel sets on every forwarded request.
 *
 * Header chain (most specific → least):
 *   1. x-forwarded-host  + x-forwarded-proto  ← Cloudflare tunnel default
 *   2. host              + (proto inferred from x-forwarded-proto or https)
 *   3. NEXT_PUBLIC_SITE_URL env var as last resort
 *   4. req.url's origin (the broken case, internal 0.0.0.0:3003)
 *
 * We trust the forwarded headers because Cloudflare strips client-supplied
 * versions and sets its own. If pev ever runs without a proxy in front, the
 * `host` header from the browser is correct on its own.
 */
/**
 * Disambiguate a 64-hex hash into a real route by asking the chain
 * whether the hash belongs to a transaction or a block. Both queries
 * fire in parallel so the worst case is one RPC roundtrip (~200ms),
 * not two.
 *
 * Priority when (somehow) both succeed: tx wins. In practice a hash
 * can only be one or the other for a given chain, so the priority is
 * just defensive.
 *
 * Fallback when neither succeeds: route to /tx/<hash>. That page's
 * NotIndexed branch re-checks the chain and renders a clean
 * "tx not found on Monad" message, so the user lands somewhere
 * sensible instead of a generic 404.
 *
 * Fallback when the RPC is unreachable: also route to /tx/<hash>.
 * Same NotIndexed branch handles the rpc-error case gracefully.
 */
async function routeHash(hash: string): Promise<string> {
  const rpcUrl = process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";

  const rpcCall = async (method: string, params: unknown[]) => {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { result?: unknown };
      return json.result ?? null;
    } catch {
      return null;
    }
  };

  const [tx, block] = await Promise.all([
    rpcCall("eth_getTransactionByHash", [hash]),
    // false = don't include full tx bodies, we just want the block
    // number for the redirect target.
    rpcCall("eth_getBlockByHash", [hash, false]),
  ]);

  if (tx) {
    return `/tx/${hash}`;
  }
  if (block && typeof (block as { number?: string }).number === "string") {
    const number = parseInt((block as { number: string }).number, 16);
    if (Number.isFinite(number) && number >= 0) {
      return `/block/${number}`;
    }
  }
  // Neither matched, or RPC error. Route to /tx/<hash> where the
  // NotIndexed branch has the appropriate "tx not found on Monad"
  // copy. Users who pasted a real block hash but hit an RPC error
  // here will see "tx not in index" which is technically wrong, but
  // also rare and recoverable (refresh the page once the RPC is back).
  return `/tx/${hash}`;
}

function publicBase(req: NextRequest): URL {
  const xfHost = req.headers.get("x-forwarded-host");
  const xfProto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("host");

  if (xfHost) {
    return new URL(`${xfProto ?? "https"}://${xfHost}`);
  }
  if (host) {
    // Local dev hits this branch. http for non-public hosts, https otherwise.
    const proto =
      xfProto ??
      (host.startsWith("localhost") || host.startsWith("0.0.0.0") || host.startsWith("127.")
        ? "http"
        : "https");
    return new URL(`${proto}://${host}`);
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL);
  }
  // Last resort. Will be wrong behind a proxy, but better than crashing.
  return new URL(req.url);
}
