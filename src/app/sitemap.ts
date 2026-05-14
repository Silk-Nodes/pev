/**
 * Dynamic sitemap for pev.
 *
 * Next.js App Router auto-publishes /sitemap.xml from this file's
 * default export, served with the correct XML content type. We don't
 * enumerate every block/contract/tx URL (millions of those), just the
 * top-level entry points that humans and crawlers actually browse to.
 *
 * Per-route entries:
 *   • /             , landing page, daily-changing aggregate (top
 *                     contracts, killer leaderboard). lastModified = now,
 *                     priority 1.0
 *   • /analytics    , network-wide aggregates, refreshed every 5 min by
 *                     analytics_cache. lastModified = now, priority 0.9
 *
 * Per-block / per-contract / per-tx URLs are deliberately omitted: they
 * exist for direct access (when a user pastes a hash) and via internal
 * links from the listed pages, which is enough for crawlers to discover
 * them. Listing all of them would bloat the sitemap with millions of
 * URLs that mostly aren't worth indexing.
 */

import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pev.silknodes.io";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/analytics`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/feedback`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
    },
  ];
}
