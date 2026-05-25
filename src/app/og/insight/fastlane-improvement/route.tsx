/**
 * GET /og/insight/fastlane-improvement
 *
 * Delta insight card: "FastLane's AuctionHandler dropped 14% conflicts
 * per block week-over-week, comparing two FULL completed weeks (May 4-11
 * vs May 11-18). 290K fewer conflicts in 7 days."
 *
 * Snapshot data, taken from a week-over-week query against block_hot_slots
 * comparing two complete 7-day windows. We use OFFSET=7 (not the rolling
 * current week) so neither window is partial. See scripts/weekly-improvers.ts.
 *
 * Default response: 1200x630 JPEG. Pass ?w=4800 (or any width 800-6000) for
 * retina/print-quality downloads. Pass &format=png for lossless.
 */

import { ImageResponse } from "next/og";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderDeltaCard, type DeltaCardData } from "@/lib/og/render";
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
  const variant = pickVariant(2);

  const cardData: DeltaCardData = {
    eyebrow: "FINDING · MONAD MAINNET · WEEK 20",
    headline: "−14.0%",
    subline:
      "FastLane's AuctionHandler is doing more with less contention.",
    before: {
      label: "WEEK OF MAY 4",
      stats: ["1.15M conflicts", "6.6 per block"],
    },
    after: {
      label: "WEEK OF MAY 11",
      stats: ["860K conflicts", "5.7 per block"],
    },
    caption:
      "290,687 fewer conflicts in 7 days. Comparing two full weeks, no partial-week noise. Real engineering, not statistical drift.",
    footer: { host, path: "/contract/0xd32edf6642d917dbbe7b8bf8e5d6f5df6a9fff58" },
  };

  const png = new ImageResponse(renderDeltaCard(cardData, variant, scale), {
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
        "content-disposition": `inline; filename="pev-fastlane-improvement-${w}.png"`,
      },
    });
  }

  return imageResponseAsJpeg(png, {
    headers: {
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "content-disposition": `inline; filename="pev-fastlane-improvement-${w}.jpg"`,
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
