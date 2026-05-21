/**
 * GET /api/og/contract/[address]
 *
 * Per-contract unfurl. Same shape as the block card (dark/cream variants
 * picked by hashing the address bytes), but the content is the
 * contract's profile: name (or hex), avg parallelism over the recent
 * window, blocks appeared in, conflicts caused, top hot slot.
 *
 * Pulls from getContractDetail with a NARROW window (1h) and a hard
 * statement timeout (2.5s per query). Why narrow + timed-out: social
 * preview fetchers like Telegram, Twitter, and Discord give the OG URL
 * roughly 5 seconds to respond before they treat the share as "no
 * preview" and cache that failure for hours. A 7d window on a popular
 * contract can take 5-15 seconds; 1h reliably returns in under 1 second
 * because the GIN-bitmap+block-range filter is small.
 *
 * The trade is some data freshness, the OG card shows the last hour
 * instead of the last week, but it ALWAYS loads. If 1h returns no data
 * (the contract is in the index but quiet right now), we render the
 * "no data" stub card. Either way the share has a branded preview.
 *
 * Edge-cached aggressively once rendered (5 min max-age + 1 day
 * stale-while-revalidate) so subsequent shares of the same contract
 * skip our origin entirely.
 */

import { ImageResponse } from "next/og";
import { getContractDetail } from "@/lib/indexer/store";
import { resolveContract } from "@/lib/enrichment";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderContractCard, type ContractCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";
import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";

const WIDTH = 1200;
const HEIGHT = 630;

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ address: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const { address } = await ctx.params;
  const lower = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    return new Response("invalid contract address", { status: 400 });
  }

  // Hash the first 8 chars of the address (32-bit slice) for the variant
  // seed. Stable per address, well-distributed across dark/cream.
  const seed = parseInt(lower.slice(2, 10), 16);
  const variant = pickVariant(seed);

  const host = publicHostFrom(req);

  // Wall-clock timeouts on every async dependency, in addition to the
  // per-statement Postgres timeouts inside getContractDetail. Reason:
  // even a 2.5s statement_timeout can be exceeded if multiple queries
  // serialize on the connection pool, if Sourcify hangs, or if Satori
  // takes longer than expected on a cold start. We want a HARD ceiling
  // on the whole route so Telegram/Twitter/Discord (each with ~5s
  // crawl budgets) always get a response.
  //
  // Race pattern: each dependency races its own setTimeout that
  // resolves to null. Whichever finishes first wins; the slow one
  // continues in the background but its result is ignored.
  function withWallClockTimeout<T>(
    promise: Promise<T>,
    ms: number,
  ): Promise<T | null> {
    return Promise.race<T | null>([
      promise.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  }

  const [contract, name, fonts] = await Promise.all([
    withWallClockTimeout(getContractDetail(lower, "1h", 1800), 2300),
    withWallClockTimeout(resolveContract(lower), 1200),
    loadCardFonts(),
  ]);

  // Find the top hot slot for the bottleneck callout. getContractDetail
  // returns hotSlots already sorted by total_conflicts DESC.
  const top = contract?.hotSlots?.[0] ?? null;

  const cardData: ContractCardData = contract
    ? {
        address: lower,
        name,
        avgParallelismScore: contract.avgParallelismScore,
        blocksAppeared: contract.blocksAppeared,
        txsTouched: contract.txsTouched,
        conflictsCaused: contract.conflictsCaused,
        topSlot: top
          ? { slot: top.slot, conflicts: top.totalConflicts }
          : null,
        footer: { host, path: `/contract/${lower}` },
      }
    : {
        // Contract not seen yet, render a stub so the unfurl is still branded
        address: lower,
        name: null,
        avgParallelismScore: 0,
        blocksAppeared: 0,
        txsTouched: 0,
        conflictsCaused: 0,
        topSlot: null,
        footer: { host, path: `/contract/${lower}` },
      };

  // Pipe the ImageResponse PNG through sharp → JPEG so X (Twitter)
  // actually renders the preview. RGBA PNGs from Next.js's ImageResponse
  // get silently rejected by X's image fetcher; JPEG works on every
  // social platform we tested. See lib/og/jpeg-response.ts for details.
  const png = new ImageResponse(renderContractCard(cardData, variant), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });
  return imageResponseAsJpeg(png, {
    headers: {
      // Aggressive caching for social previews:
      //   • 5 min max-age: tells crawlers the card is fresh for 5 min
      //   • 1 day stale-while-revalidate: after 5 min, serve the stale
      //     card instantly and re-render in background. This means
      //     Telegram/Twitter/Discord always get an instant response on
      //     repeat shares of the same contract, even when our origin
      //     would otherwise be busy.
      "cache-control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

function publicHostFrom(req: Request): string {
  const xfHost = req.headers.get("x-forwarded-host");
  if (xfHost) return xfHost.split(",")[0].trim();
  const host = req.headers.get("host");
  if (host) return host;
  const env = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pev.silknodes.io";
  return env.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
