import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/middleware";
import { CACHE_HEADERS_AGGREGATE } from "@/lib/api/cache";
import { resolveManyContracts, resolveManyMethods } from "@/lib/enrichment";

/**
 * POST /api/v1/enrich
 *
 * Bulk decode 4-byte selectors → method signatures (via 4byte) and
 * contract addresses → display names (via Sourcify). Cached in Postgres
 * forever for hits, 1h for misses.
 *
 * Request body:
 *   {
 *     "selectors":  ["0xa9059cbb", ...],   // optional
 *     "addresses":  ["0x754704bc...", ...] // optional
 *   }
 *
 * Response:
 *   {
 *     "methods":   { "0xa9059cbb": "transfer(address,uint256)", ... },
 *     "contracts": { "0x754704bc...": "wmonUSDC Pool", ... }
 *   }
 *
 * Unresolved entries are present with value `null`. Caps:
 *   - max 200 selectors per request
 *   - max 100 addresses per request
 *
 * GET variant accepts comma-separated query params for casual use:
 *   GET /api/v1/enrich?selectors=0xa9059cbb,0x70a08231&addresses=0x754704...
 */

export const dynamic = "force-dynamic";

interface EnrichBody {
  selectors?: string[];
  addresses?: string[];
}

const MAX_SELECTORS = 200;
const MAX_ADDRESSES = 100;

async function doEnrich(selectors: string[], addresses: string[]) {
  if (selectors.length > MAX_SELECTORS || addresses.length > MAX_ADDRESSES) {
    return NextResponse.json(
      {
        error: `too many items (max ${MAX_SELECTORS} selectors, ${MAX_ADDRESSES} addresses)`,
      },
      { status: 400 },
    );
  }
  const [methods, contracts] = await Promise.all([
    selectors.length > 0
      ? resolveManyMethods(selectors)
      : new Map<string, string | null>(),
    addresses.length > 0
      ? resolveManyContracts(addresses)
      : new Map<string, string | null>(),
  ]);
  return NextResponse.json({
    methods: Object.fromEntries(methods),
    contracts: Object.fromEntries(contracts),
  });
}

export const POST = withApi(
  async (req) => {
    let body: EnrichBody;
    try {
      body = (await req.json()) as EnrichBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const selectors = Array.isArray(body.selectors) ? body.selectors : [];
    const addresses = Array.isArray(body.addresses) ? body.addresses : [];
    return doEnrich(selectors, addresses);
  },
  { cacheHeaders: CACHE_HEADERS_AGGREGATE },
);

export const GET = withApi(
  async (req) => {
    const url = new URL(req.url);
    const selectors = (url.searchParams.get("selectors") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const addresses = (url.searchParams.get("addresses") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return doEnrich(selectors, addresses);
  },
  { cacheHeaders: CACHE_HEADERS_AGGREGATE },
);
