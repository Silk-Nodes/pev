/**
 * GET /og/docs
 *
 * Unfurl for the /docs page. Editorial card with the same lockup,
 * footer band, and dark/cream variant rotation as the other pev OG
 * cards, but with no live data; /docs is reference content, not a
 * data view. The card design surfaces "The manual." as the headline
 * and the seven section labels along the bottom so the unfurl previews
 * the actual table of contents.
 *
 * Variant rotates by day-of-year + 2 so the docs card alternates
 * dark/cream independently of the landing card (+0) and the analytics
 * card (+1). A timeline that shows all three at once gets three
 * different variants instead of an obviously-templated row.
 *
 * Edge-cached for 1 day since the page content rarely changes day to
 * day. Long cache amortizes the Satori render cost (~80ms) across
 * every share.
 */

import { ImageResponse } from "next/og";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderDocsCard, type DocsCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";
import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";

const WIDTH = 1200;
const HEIGHT = 630;

export const runtime = "nodejs";

export async function GET(req: Request) {
  const now = new Date();
  const dayOfYear = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );
  // +2 offset so the docs card variant doesn't collide with the landing
  // card (+0) or analytics card (+1) on a feed that shares all three.
  const variant = pickVariant(dayOfYear + 2);

  const host = publicHostFrom(req);

  const fonts = await loadCardFonts();

  const cardData: DocsCardData = {
    footer: { host, path: "/docs" },
  };

  // PNG → JPEG so X renders the preview (see lib/og/jpeg-response.ts).
  const png = new ImageResponse(renderDocsCard(cardData, variant), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });
  return imageResponseAsJpeg(png, {
    headers: {
      // /docs is rarely re-edited; 1-day cache with longer stale-while-
      // revalidate gives crawlers a fast first hit and absorbs any
      // intermittent design tweaks without forcing re-render storms.
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
