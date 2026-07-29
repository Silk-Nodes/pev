/**
 * GET /og/scale
 *
 * Share card for /scale, chain growth at the execution layer. Reads the
 * precomputed growth cache (single-row lookup, no aggregation) so the
 * unfurl carries live measured numbers: transactions traced, the current
 * parallelism score, and how conflicts per block moved over the window.
 *
 * Variant alternates dark/cream per UTC day, like the other cards.
 * 1200x630. Falls back to zeros if the cache is empty.
 */

import { ImageResponse } from "next/og";
import { getCachedGrowth } from "@/lib/indexer/store";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderScaleCard, type ScaleCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";

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
  const variant = pickVariant(dayOfYear);
  const host = publicHostFrom(req);

  const [got, fonts] = await Promise.all([
    getCachedGrowth().catch(() => null),
    loadCardFonts(),
  ]);

  const data = got?.data;
  // Mirror the page: drop partial edge days before deriving headline
  // numbers, so the card can never disagree with what /scale shows.
  const src = data?.daily ?? [];
  const days = (() => {
    if (src.length < 3) return src;
    const med = [...src.map((x) => x.blocks)].sort((a, b) => a - b)[Math.floor(src.length / 2)];
    const floor = med * 0.7;
    let lo = 0;
    let hi = src.length - 1;
    if (src[lo].blocks < floor) lo += 1;
    if (src[hi].blocks < floor) hi -= 1;
    return src.slice(lo, hi + 1);
  })();

  const half = Math.floor(days.length / 2);
  const cpbPct = (() => {
    if (half < 2) return null;
    const sum = (xs: typeof days, k: "blocks" | "conflicts") =>
      xs.reduce((a, x) => a + x[k], 0);
    const a = days.slice(0, half);
    const b = days.slice(-half);
    const cpbA = sum(a, "conflicts") / Math.max(sum(a, "blocks"), 1);
    const cpbB = sum(b, "conflicts") / Math.max(sum(b, "blocks"), 1);
    return cpbA > 0 ? ((cpbB - cpbA) / cpbA) * 100 : null;
  })();

  // Score from the most recent complete week, the "where it is now" read.
  const recent = days.slice(-7);
  const score = recent.length
    ? Math.round(recent.reduce((a, x) => a + x.avgScore, 0) / recent.length)
    : 0;

  const cardData: ScaleCardData = {
    txs: days.reduce((a, x) => a + x.txs, 0),
    days: days.length,
    score,
    cpbPct,
    footer: { host, path: "/scale" },
  };

  return new ImageResponse(renderScaleCard(cardData, variant), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=600",
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
