/**
 * GET /og/insight/pareto
 *
 * Pareto insight card: "6 contracts cause 81% of all storage conflicts on Monad".
 *
 * Default response: 1200x630 JPEG. Suitable for og:image embedding and X tweet
 * cards (X re-encodes anyway, no point sending HD by default).
 *
 * Query params for high-res / lossless downloads:
 *   ?w=N        Width in pixels, height auto-derived at 1200:630 aspect ratio.
 *               Min 800, max 6000. Default 1200. Scales every element
 *               proportionally so text stays crisp at any resolution.
 *   ?format=png Override to PNG output. Default JPEG.
 *
 * Examples for sharing:
 *   /og/insight/pareto                 (1200x630 JPEG, ~50KB, OG embed)
 *   /og/insight/pareto?w=2400          (2x retina JPEG)
 *   /og/insight/pareto?w=4800          (4K-ish JPEG, ~600KB)
 *   /og/insight/pareto?w=4800&format=png  (4K-ish lossless PNG, ~1-2MB)
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
  const variant = pickVariant(0); // dark, the more dramatic of the two variants

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

  const png = new ImageResponse(renderInsightCard(cardData, variant, scale), {
    width: w,
    height: h,
    fonts,
  });

  // PNG passthrough: return the ImageResponse PNG directly. Used for HD
  // downloads where lossless quality matters more than X-image-fetcher
  // compatibility (RGBA is fine when the user is just saving the file).
  if (wantsPng) {
    const buf = await png.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-disposition": `inline; filename="pev-pareto-${w}.png"`,
      },
    });
  }

  // JPEG path (default): runs through sharp for RGB conversion + JPEG
  // compression. Slightly smaller files, broadly compatible.
  return imageResponseAsJpeg(png, {
    headers: {
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "content-disposition": `inline; filename="pev-pareto-${w}.jpg"`,
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
