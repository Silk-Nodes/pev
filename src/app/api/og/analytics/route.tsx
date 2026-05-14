/**
 * GET /api/og/analytics
 *
 * Unfurl for the /analytics page. Pulls the same precomputed payload
 * from analytics_cache (refreshed every 5 min by the systemd timer)
 * and renders the headline + #1 killer + 7-day stats.
 *
 * Variant rotates by day-of-year so the chain analytics card alternates
 * dark/cream daily. Cached at edge 5 min, matches the underlying cache
 * refresh cadence.
 */

import { ImageResponse } from "next/og";
import { getCachedAnalyticsData } from "@/lib/indexer/store";
import { resolveContract } from "@/lib/enrichment";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderAnalyticsCard, type AnalyticsCardData } from "@/lib/og/render";
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
  // +1 offset from the landing card's seed so the two cards alternate
  // independently (a feed with both shared shows two different variants).
  const variant = pickVariant(dayOfYear + 1);

  const host = publicHostFrom(req);

  const [cached, fonts] = await Promise.all([
    getCachedAnalyticsData().catch(() => null),
    loadCardFonts(),
  ]);

  // Resolve a human label for the #1 killer (Sourcify cache, ~5ms when warm)
  let topKiller: AnalyticsCardData["topKiller"] = null;
  if (cached && cached.data.killers.length > 0) {
    const top = cached.data.killers[0];
    const name = await resolveContract(top.address).catch(() => null);
    topKiller = {
      label: name ?? shortHexLocal(top.address, 6, 4),
      conflicts: top.totalConflicts,
    };
  }

  const cardData: AnalyticsCardData = {
    totalBlocks: cached?.data.totals.blocks ?? 0,
    totalTransactions: cached?.data.totals.txs ?? 0,
    totalConflicts: cached?.data.totals.conflicts ?? 0,
    avgScore: cached?.data.totals.avgScore ?? 0,
    topKiller,
    footer: { host, path: "/analytics" },
  };

  return new ImageResponse(renderAnalyticsCard(cardData, variant), {
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

function shortHexLocal(h: string, headChars = 6, tailChars = 4): string {
  if (h.length <= 2 + headChars + tailChars) return h;
  return h.slice(0, 2 + headChars) + "…" + h.slice(-tailChars);
}
