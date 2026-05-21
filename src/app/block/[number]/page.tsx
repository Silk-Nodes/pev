import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { probeBlock } from "@/lib/parallel-probe";
import { probeToPEV } from "@/lib/probe-to-pev";
import { enrichPEVData } from "@/lib/enrich-pev";
import { getBlockPEV } from "@/lib/indexer/store";
import { resolveContract } from "@/lib/enrichment";
import EditorialView from "@/components/parallel/EditorialView";
import { breadcrumbSchema } from "@/lib/seo/schema";
import { themeA } from "@/components/parallel/theme";
import type { PEVData } from "@/lib/probe-to-pev";
import type { Metadata } from "next";
import Link from "next/link";

interface PageParams {
  params: Promise<{ number: string }>;
}

function parseBlockNumber(raw: string): number | null {
  if (!raw) return null;
  const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { number } = await params;
  const n = parseBlockNumber(number);
  if (n === null) return { title: "Block not found" };

  // Per-block social card. Served from /og/* not /api/og/* because
  // Twitter's card validator flags ANY image URL with /api/ in the
  // path as "may be restricted by robots.txt" (heuristic check, not
  // actual robots.txt enforcement), which manifests as no image
  // preview in tweets. ?v=N is a cache-bust knob for X/Discord
  // (their preview caches are otherwise unbreakable). Bump when the
  // OG card design changes.
  //   v=2 added the editorial footer band (URL + BY SILK NODES).
  //   v=3 dropped em-dashes from the verdict copy.
  //   v=6 moved route from /api/og/ to /og/ + JPEG output.
  const ogImageUrl = `/og/block/${n}?v=6`;
  const title = `Monad block #${n.toLocaleString()} · pev`;
  const description =
    "Parallel-execution analysis: which transactions ran in parallel, which conflicted, and where the storage hotspots are.";

  const canonicalPath = `/block/${n}`;

  return {
    title: `Block #${n.toLocaleString()}`,
    description: `Parallel execution analysis for Monad block ${n}: wave depth, storage conflicts, hot slots.`,
    // Self-canonical: each block has its own URL, indexed independently
    // of every other block. Use the numeric block number, not whatever
    // formatting the user typed in.
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonicalPath,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `pev, block #${n.toLocaleString()} parallelism analysis`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

// Finalized blocks are immutable. The indexed JSONB blob is the source of
// truth once written. Cache hard at the route level for an hour either way.
export const revalidate = 3600;

/**
 * Social-preview crawlers we short-circuit. See contract page for the
 * full reasoning. Same regex pattern; consider extracting to a shared
 * lib helper if a fourth route needs it.
 */
const SOCIAL_CRAWLER_REGEX =
  /Twitterbot|TelegramBot|facebookexternalhit|Facebot|Slackbot|Discordbot|LinkedInBot|WhatsApp|Pinterestbot|redditbot|Skype|vkShare|W3C_Validator/i;

export default async function BlockPage({ params }: PageParams) {
  const { number } = await params;
  const n = parseBlockNumber(number);
  if (n === null) notFound();

  // Crawler short-circuit so social previews don't time out on the
  // heavy probe/trace. The og: meta tags from generateMetadata are
  // already in <head>; crawlers don't need the body to render preview
  // cards. See contract page for the full reasoning.
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (SOCIAL_CRAWLER_REGEX.test(userAgent)) {
    return (
      <main
        style={{
          padding: "48px clamp(20px, 4vw, 64px)",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h1
          className="pev-display-italic"
          style={{ fontSize: 32, color: themeA.text, margin: 0 }}
        >
          {`Monad block #${n.toLocaleString()}`}
        </h1>
        <p style={{ color: themeA.muted, marginTop: 16 }}>
          Parallel-execution analysis. Open this page in a browser to see
          the live execution graph and conflict breakdown.
        </p>
      </main>
    );
  }

  // BreadcrumbList JSON-LD for "pev > block > #N". Rendered alongside
  // every return path below via the BreadcrumbScript helper at the
  // bottom of this file. See src/lib/seo/schema.ts for the shape.
  const breadcrumb = (
    <BreadcrumbScript
      items={[
        { name: "pev", url: "/" },
        { name: "block", url: "/" },
        { name: `#${n.toLocaleString()}`, url: `/block/${n}` },
      ]}
    />
  );

  // ─── 1. Try Postgres first (fast path: ~10-50ms) ─────────────
  // The indexer writes a JSONB blob containing the full PEVData, so a
  // single SELECT gives us everything the UI needs, no joins, no
  // rebuild. If the block is in our DB, we're done.
  try {
    const cached = await getBlockPEV(n);
    if (cached) {
      // Resolve method (4byte) + primary-contract (Sourcify) names for
      // every tx. Cached aggressively in Postgres, so this is ~5ms when
      // warm and ~200ms-1s on cold misses. Mutates `cached` in place.
      await enrichPEVData(cached);
      const nextAction = await buildNextAction(cached);
      return (
        <>
          {breadcrumb}
          <EditorialView data={cached} nextAction={nextAction} />
        </>
      );
    }
  } catch (err) {
    // DB hiccup, fall through to live trace. Don't block the user on
    // a transient Postgres issue.
    console.warn(`[block-page] db read failed for #${n}:`, (err as Error).message);
  }

  // ─── 2. Fall back to live trace (slow path: 200ms-1.5s) ──────
  // Reasons we'd land here:
  //   • Block predates the indexer's history
  //   • Block is so new the indexer hasn't caught up yet
  //   • DB was down
  // We don't write the result back to Postgres, that's the indexer's
  // job. Keeps responsibilities clean.
  let probe;
  try {
    probe = await probeBlock(n);
  } catch (e) {
    return (
      <>
        {breadcrumb}
      <div
        style={{
          padding: "48px clamp(20px, 4vw, 64px)",
          maxWidth: 720,
          margin: "0 auto",
          fontFamily: "var(--pev-font-mono), ui-monospace, monospace",
          color: themeA.text,
          background: themeA.bg,
          minHeight: "100vh",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            marginBottom: 12,
            fontFamily: "var(--pev-font-serif), Georgia, serif",
            fontStyle: "italic",
            color: themeA.text,
          }}
        >
          Could not trace block #{n}
        </h1>
        <p style={{ color: themeA.muted }}>{(e as Error).message}</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/" className="pev-link">← back to recent blocks</Link>
        </p>
      </div>
      </>
    );
  }

  const data = probeToPEV(probe);
  await enrichPEVData(data);
  const nextAction = await buildNextAction(data);
  return (
    <>
      {breadcrumb}
      <EditorialView data={data} nextAction={nextAction} />
    </>
  );
}

/**
 * Small helper to keep the schema-injection inline JSX tidy.
 * Renders <script type="application/ld+json"> with a JSON-stringified
 * BreadcrumbList. See src/lib/seo/schema.ts for the builder.
 */
function BreadcrumbScript({
  items,
}: {
  items: Array<{ name: string; url: string }>;
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(breadcrumbSchema(items)),
      }}
    />
  );
}

/**
 * Resolve the bottleneck contract name for the next-action band shown at
 * the bottom of EditorialView. The address itself comes from
 * `data.hotSlots[0]` which is already on the client; we just need the
 * Sourcify name (cached aggressively, so ~5ms when warm) so the band can
 * render "Throughput-killer: VaultV2" instead of bare hex when possible.
 *
 * Best-effort: if resolution fails or there's no hot slot, the band falls
 * back to short-hex / no-bottleneck rendering. Never block the page on it.
 */
async function buildNextAction(
  data: PEVData,
): Promise<{ bottleneckContractName: string | null }> {
  const top = data.hotSlots[0];
  if (!top || top.conflictsCaused === 0) {
    return { bottleneckContractName: null };
  }
  try {
    const name = await resolveContract(top.contract);
    return { bottleneckContractName: name };
  } catch {
    return { bottleneckContractName: null };
  }
}
