/**
 * GET /api/og/landing
 *
 * The unfurl that lands when someone shares pev.silknodes.io itself.
 * Highest-volume share path, every Twitter/Discord post about pev that
 * doesn't link to a specific block/contract uses this card.
 *
 * Pulls live numbers from the analytics_cache so the card stays fresh
 * without extra DB load (cache is refreshed every 5 min by the systemd
 * timer pev-analytics-refresh). Falls back to placeholder zeros if the
 * cache is empty (immediately post-deploy).
 *
 * Variant choice: deterministic per-day (so the card is stable for any
 * given day's shares but alternates dark/cream across days). Block-card
 * variants use block_number as the seed; here the seed is the day-of-year
 * so the same card unfurls all day.
 */

import { ImageResponse } from "next/og";
import { getCachedAnalyticsData, getCursor } from "@/lib/indexer/store";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderLandingCard, type LandingCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";

const WIDTH = 1200;
const HEIGHT = 630;

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Day-of-year seed → same variant for all visits within a UTC day,
  // alternates between dark and cream day-to-day in a feed of pev shares.
  const now = new Date();
  const dayOfYear = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );
  const variant = pickVariant(dayOfYear);

  // Public hostname for the footer band, derived from request headers
  // (Cloudflare forwards X-Forwarded-Host; falls back to env or static).
  const host = publicHostFrom(req);

  // Pull live numbers in parallel with font loading so cold-start is fast.
  const [cached, cursor, fonts] = await Promise.all([
    getCachedAnalyticsData().catch(() => null),
    getCursor().catch(() => null),
    loadCardFonts(),
  ]);

  const cardData: LandingCardData = {
    totalBlocks: cached?.data.totals.blocks ?? 0,
    avgScore: cached?.data.totals.avgScore ?? 0,
    totalConflicts: cached?.data.totals.conflicts ?? 0,
    chainHead: cursor?.lastIndexedBlock ?? 0,
    footer: { host, path: "/" },
  };

  return new ImageResponse(renderLandingCard(cardData, variant), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
    headers: {
      // The numbers do change slowly. Cache for 5 min at the edge so
      // social-bot fetches don't hammer us.
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
