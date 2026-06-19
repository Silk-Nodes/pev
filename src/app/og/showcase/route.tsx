/**
 * GET /og/showcase
 *
 * Share card for /showcase, the protocol-audit use-case page. Pulls the
 * featured contract's live audit numbers from the precomputed cache (one
 * PK lookup, no heavy query) so the unfurl carries real measured figures:
 * re-executions forced, conflicts per transaction, transactions touched.
 *
 * Variant alternates dark/cream per UTC day, like the landing card.
 * 1200x630. Falls back to placeholder zeros if the audit cache is empty.
 */

import { ImageResponse } from "next/og";
import { getContractAudit } from "@/lib/indexer/store";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderShowcaseCard, type ShowcaseCardData } from "@/lib/og/render";
import { pickVariant } from "@/lib/og/variant";

const WIDTH = 1200;
const HEIGHT = 630;
const FEATURED = "0x34b6552d57a35a1d042ccae1951bd1c370112a6f"; // Perpl

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
    getContractAudit(FEATURED).catch(() => null),
    loadCardFonts(),
  ]);

  const audit = got?.audit;
  const cardData: ShowcaseCardData = {
    subject: audit?.label ?? "Perpl",
    reexecs: audit?.totals.conflicts ?? 0,
    conflictsPerTx: audit?.totals.conflictRate ?? 0,
    txs: audit?.totals.txs ?? 0,
    footer: { host, path: "/showcase" },
  };

  return new ImageResponse(renderShowcaseCard(cardData, variant), {
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
