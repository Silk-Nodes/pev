/**
 * GET /og/block/[number]
 *
 * Returns a 1200×630 PNG OG card for a block, dynamically rendered with
 * the block's actual data (verdict, parallelism, conflicts, mini wave
 * timeline). Two visual variants (dark + cream) selected by deterministic
 * hash of the block number, so:
 *
 *   • Same block always renders the same variant (cache-friendly)
 *   • A feed of shared cards alternates dark/cream (breaks visual sameness)
 *
 * Cached forever (immutable) at the CDN edge, finalized blocks don't
 * change, so once rendered the PNG is correct for all time.
 *
 * Used by:
 *   • src/app/block/[number]/page.tsx via openGraph.images / twitter.images
 *
 * Fallback behavior:
 *   • If the block isn't in our DB (predates indexer or hasn't caught up
 *     yet), we return a minimal "Block #N" card with no per-block data.
 *     Better than a 404 OG card, which would just show the URL in the
 *     preview unfurl.
 */

import { ImageResponse } from "next/og";
import { getBlockPEV } from "@/lib/indexer/store";
import { resolveContract } from "@/lib/enrichment";
import { shortHex } from "@/lib/probe-to-pev";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderBlockCard, type BlockCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";
import type { PEVStatus } from "@/lib/probe-to-pev";
import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";

// 1200×630 is the universal social-card aspect. Matches Twitter
// summary_large_image, Discord, Slack, LinkedIn, all use this shape.
const WIDTH = 1200;
const HEIGHT = 630;

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ number: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { number } = await ctx.params;
  const blockNumber = parseBlockNumber(number);
  if (blockNumber === null) {
    return new Response("invalid block number", { status: 400 });
  }

  const variant = pickVariant(blockNumber);

  // Footer host comes from the SITE_URL env var (set in .env.production.local
  // on the VM, default to the public domain). Stripped of protocol +
  // trailing slash so it reads cleanly in the card: "pev.silknodes.io".
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://pev.silknodes.io";
  const host = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Fetch block + fonts in parallel. Fonts are cached after the first
  // call, so this only matters for cold starts.
  const [pev, fonts] = await Promise.all([
    getBlockPEV(blockNumber).catch((err) => {
      console.warn(
        `[og/block] DB read failed for #${blockNumber}:`,
        (err as Error).message,
      );
      return null;
    }),
    loadCardFonts(),
  ]);

  // Resolve the bottleneck contract name (may upgrade hex → human label
  // when Sourcify has it). Best-effort, never block on it.
  let bottleneckLabel: string | null = null;
  let bottleneckSeverity: "throughput-killer" | "bottleneck" | null = null;
  if (pev?.hotSlots[0] && pev.hotSlots[0].conflictsCaused > 0) {
    const top = pev.hotSlots[0];
    bottleneckSeverity =
      pev.summary.conflictCount >= 3 ? "throughput-killer" : "bottleneck";
    try {
      const name = await resolveContract(top.contract);
      bottleneckLabel = name ?? shortHex(top.contract, 8, 6);
    } catch {
      bottleneckLabel = shortHex(top.contract, 8, 6);
    }
  }

  const footer = { host, path: `/block/${blockNumber}` };

  const cardData: BlockCardData = pev
    ? {
        block: blockNumber,
        txCount: pev.summary.txCount,
        timestamp: pev.summary.timestamp,
        parallelismScore: pev.summary.parallelismScore,
        conflictCount: pev.summary.conflictCount,
        executionDepth: pev.summary.waves,
        bottleneck:
          bottleneckLabel && bottleneckSeverity
            ? { label: bottleneckLabel, severity: bottleneckSeverity }
            : null,
        waves: pev.waveTxs.map((w) => w.map((t) => t.status as PEVStatus)),
        footer,
      }
    : {
        // Block not indexed yet, render a minimal card so the unfurl
        // still looks branded, just without the per-block data.
        block: blockNumber,
        txCount: 0,
        timestamp: Math.floor(Date.now() / 1000),
        parallelismScore: 0,
        conflictCount: 0,
        executionDepth: 0,
        bottleneck: null,
        waves: [],
        footer,
      };

  // PNG → JPEG so X renders the preview (see lib/og/jpeg-response.ts).
  const png = new ImageResponse(renderBlockCard(cardData, variant), {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });
  return imageResponseAsJpeg(png, {
    headers: {
      // Finalized blocks are immutable. Tell every CDN + the social-media
      // bot caches to keep this JPEG forever. If we ever change the design,
      // we bump the `?v=N` query param in the page metadata to force re-fetch.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

function parseBlockNumber(raw: string): number | null {
  const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
