/**
 * GET /og/insight/pareto
 *
 * Static-data Pareto insight card: "6 contracts cause 81% of all
 * storage conflicts on Monad". Renders as 1200x630 JPEG for sharing
 * on X / Discord / Telegram.
 *
 * Data is snapshot at the time of writing (post-launch week 1).
 * Designed to be a permanent shareable URL — the numbers don't need
 * to be live, the FINDING is what's shareable. If we want to refresh
 * later, regenerate the snapshot and update the constants below.
 */

import { ImageResponse } from "next/og";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderInsightCard, type InsightCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";
import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";

const WIDTH = 1200;
const HEIGHT = 630;

export const runtime = "nodejs";

export async function GET(req: Request) {
  const host = publicHostFrom(req);
  const fonts = await loadCardFonts();

  // Dark variant always for this card (the finding reads more dramatic
  // on dark; the cream variant is for editorial pages).
  const variant = pickVariant(0); // 0 → dark per pickVariant convention

  const cardData: InsightCardData = {
    eyebrow: "FINDING · MONAD MAINNET",
    headline: "81%",
    subline:
      "of all storage conflicts on Monad come from just 6 contracts.",
    rows: [
      { rank: 1, name: "Perpl", pct: 35.07, metric: "35.1%" },
      { rank: 2, name: "ShMonad", pct: 18.14, metric: "18.1%" },
      { rank: 3, name: "Kuru Exchange: MON/USDC", pct: 10.96, metric: "11.0%" },
      { rank: 4, name: "FastLane: AuctionHandler", pct: 8.68, metric: "8.7%" },
      { rank: 5, name: "Mock Token", pct: 5.14, metric: "5.1%" },
      { rank: 6, name: "Kuru Exchange: MarginAccount", pct: 3.28, metric: "3.3%" },
    ],
    caption:
      "44.3M conflicts indexed · 11,865 contracts · the other 11,859 contracts together = 19%",
    footer: { host, path: "/analytics" },
  };

  const png = new ImageResponse(renderInsightCard(cardData, variant), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });
  return imageResponseAsJpeg(png, {
    headers: {
      // Insight cards are evergreen, cache aggressively.
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
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
