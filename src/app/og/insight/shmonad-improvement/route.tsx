/**
 * GET /og/insight/shmonad-improvement
 *
 * Delta insight card: "ShMonad took on 18% more workload this week and
 * got MORE parallel-efficient, not less. cpb 7.1 to 6.9 while total
 * conflicts handled grew 4.44M to 5.26M."
 *
 * Snapshot data from a week-over-week query against block_hot_slots
 * comparing two FULL completed weeks (offset=7, no partial-week skew):
 * week of May 13-20 vs week of May 20-27, 2026. See
 * scripts/weekly-improvers.ts for the query.
 *
 * Default response: 1200x630 JPEG. Pass ?w=4800 (or any width 800-6000)
 * for retina/print-quality downloads. Pass &format=png for lossless.
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
  const variant = pickVariant(3);

  const cardData: DeltaCardData = {
    eyebrow: "FINDING · MONAD MAINNET · WEEK 21",
    headline: "+18%",
    subline:
      "ShMonad took on 18% more workload and got MORE efficient, not less.",
    before: {
      label: "WEEK OF MAY 13",
      stats: ["4.44M conflicts", "7.1 per block"],
    },
    after: {
      label: "WEEK OF MAY 20",
      stats: ["5.26M conflicts", "6.9 per block"],
    },
    caption:
      "More volume, lower contention per block. Scaling up without degrading. That's parallel execution actually working.",
    footer: { host, path: "/contract/0x1b68626dca36c7fe922fd2d55e4f631d962de19c" },
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
        "content-disposition": `inline; filename="pev-shmonad-improvement-${w}.png"`,
      },
    });
  }

  return imageResponseAsJpeg(png, {
    headers: {
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "content-disposition": `inline; filename="pev-shmonad-improvement-${w}.jpg"`,
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
