/**
 * GET /og/insight/weekly-movers
 *
 * Insight card: scoreboard of Monad's three heaviest contracts,
 * week over week. Two improved (ShMonad, FastLane: more volume,
 * lower cpb), one regressed (Perpl: cpb up on lower volume).
 *
 * The deliberately honest 2-up-1-down framing is the point: pev
 * reports what the data says, not just good news. That credibility
 * is the product.
 *
 * Snapshot data from scripts/weekly-improvers.ts comparing two FULL
 * completed weeks (May 13-20 vs May 20-27, 2026, offset=7 so no
 * partial-week skew):
 *
 *   ShMonad   4.44M -> 5.26M conflicts (+18% load), cpb 7.1 -> 6.9
 *   FastLane  1.32M -> 1.48M conflicts (+12% load), cpb 4.5 -> 4.2
 *   Perpl     3.49M -> 3.13M conflicts (-10% load), cpb 4.6 -> 5.7
 *
 * Default response: 1200x630 JPEG. Pass ?w=4800 (or any width 800-6000)
 * for retina/print-quality downloads. Pass &format=png for lossless.
 */

import { ImageResponse } from "next/og";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderInsightCard, type InsightCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";
import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";

const BASE_WIDTH = 1200;
const BASE_HEIGHT = 630;
const MIN_WIDTH = 800;
const MAX_WIDTH = 6000;

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedW = parseInt(url.searchParams.get("w") || String(BASE_WIDTH), 10);
  const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number.isFinite(requestedW) ? requestedW : BASE_WIDTH));
  const h = Math.round((w * BASE_HEIGHT) / BASE_WIDTH);
  const scale = w / BASE_WIDTH;
  const wantsPng = url.searchParams.get("format") === "png";

  const host = publicHostFrom(req);
  const fonts = await loadCardFonts();
  const variant = pickVariant(4);

  const cardData: InsightCardData = {
    eyebrow: "FINDING · MONAD MAINNET · WEEK 21",
    headline: "2/3",
    subline:
      "of Monad's heaviest contracts cut per-block contention while doing MORE work.",
    rows: [
      {
        rank: 1,
        name: "ShMonad · +18% load",
        pct: -3.6,
        metric: "cpb 7.1 → 6.9",
      },
      {
        rank: 2,
        name: "FastLane: AuctionHandler · +12% load",
        pct: -7.3,
        metric: "cpb 4.5 → 4.2",
      },
      {
        rank: 3,
        name: "Perpl · −10% load",
        pct: 23.9,
        metric: "cpb 4.6 → 5.7",
      },
    ],
    caption:
      "Two full weeks compared: May 13-20 vs May 20-27. ShMonad and FastLane scaled up AND got cleaner. Perpl moved the other way. We publish both directions.",
    footer: { host, path: "/analytics" },
  };

  const png = new ImageResponse(renderInsightCard(cardData, variant, scale), {
    width: w,
    height: h,
    fonts,
  });

  if (wantsPng) {
    const buf = await png.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-disposition": `inline; filename="pev-weekly-movers-${w}.png"`,
      },
    });
  }

  return imageResponseAsJpeg(png, {
    headers: {
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "content-disposition": `inline; filename="pev-weekly-movers-${w}.jpg"`,
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
