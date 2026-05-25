/**
 * GET /og/insight/perpl-improvement
 *
 * Delta insight card: "Perpl, the #1 throughput-killer on Monad, just
 * got better. −12.5% conflicts per block week-over-week."
 *
 * Snapshot data, taken from a week-over-week query against block_hot_slots
 * comparing 0-7d vs 7-14d windows. Numbers are point-in-time, intentionally
 * — the FINDING is what's shareable, not minute-to-minute precision. If we
 * want to refresh, re-run the query and update the constants below.
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
  const variant = pickVariant(0);

  const cardData: DeltaCardData = {
    eyebrow: "FINDING · MONAD MAINNET · WEEK 22",
    headline: "−12.5%",
    subline:
      "Perpl, the #1 throughput-killer on Monad, just got better.",
    before: {
      label: "LAST WEEK",
      stats: ["4.26M conflicts", "12.4 per block"],
    },
    after: {
      label: "THIS WEEK",
      stats: ["3.28M conflicts", "10.8 per block"],
    },
    caption:
      "−980,600 conflicts in 7 days. Higher traffic, less contention per block. That's the engineering working.",
    footer: { host, path: "/contract/0x34b6552d57a35a1d042ccae1951bd1c370112a6f" },
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
        "content-disposition": `inline; filename="pev-perpl-improvement-${w}.png"`,
      },
    });
  }

  return imageResponseAsJpeg(png, {
    headers: {
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "content-disposition": `inline; filename="pev-perpl-improvement-${w}.jpg"`,
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
