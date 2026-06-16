/**
 * GET /og/graph
 *
 * Share card for the /graph relationship map. Data-driven: reads the
 * precomputed cooccurrence cache, takes the top contracts + their
 * strongest links, and draws a simplified chord on the right with a
 * headline + live stats on the left.
 *
 * The chord is built here as a standalone SVG string and embedded as a
 * base64 <img> in the card (the OG cards are flexbox-only via Satori;
 * real SVG graphics have to come in as an image).
 *
 * Default: 1200x630 JPEG. ?w=2400 for retina; &format=png for lossless.
 */

import { ImageResponse } from "next/og";
import { loadCardFonts } from "@/lib/og/fonts";
import { renderGraphCard, type GraphCardData } from "@/lib/og/render";
import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";
import {
  getCachedCooccurrenceGraph,
  getCooccurrenceGraph,
  type CooccurrenceGraph,
} from "@/lib/indexer/store";

const BASE_WIDTH = 1200;
const BASE_HEIGHT = 630;
const MIN_WIDTH = 800;
const MAX_WIDTH = 6000;

export const runtime = "nodejs";

// Brand palette (dark variant).
const EMBER = "#e28c52";
const BONE = "#efe7d4";
const STONE = "#8a8577";

/**
 * Build a simplified chord SVG (string) from the graph: top-N contracts
 * on a circle, strongest edges between them, a few biggest named.
 */
function buildChordSvg(graph: CooccurrenceGraph): string {
  const S = 440;
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.36;

  // Top contracts by weight; cap for legibility at card size.
  const topN = 22;
  const nodes = [...graph.nodes].sort((a, b) => b.weight - a.weight).slice(0, topN);
  const keep = new Set(nodes.map((n) => n.address));
  // Edges among the kept nodes, strongest first, capped.
  const edges = graph.edges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .sort((a, b) => b.cooccur - a.cooccur)
    .slice(0, 70);

  const pos = new Map<string, { x: number; y: number; ang: number }>();
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    pos.set(n.address, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), ang: a });
  });
  const maxC = Math.max(...edges.map((e) => e.cooccur), 1);
  const maxW = Math.max(...nodes.map((n) => n.weight), 1);
  const ew = (c: number) => (0.4 + 3 * Math.sqrt(c / maxC)).toFixed(2);
  const nr = (w: number) => (3 + 8 * Math.sqrt(w / maxW)).toFixed(1);

  let edgePaths = "";
  for (const e of edges) {
    const a = pos.get(e.source)!;
    const b = pos.get(e.target)!;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const qx = mx + (cx - mx) * 0.45;
    const qy = my + (cy - my) * 0.45;
    const contended = e.conflicts > 0;
    const stroke = contended ? EMBER : BONE;
    const op = contended ? 0.55 : 0.16;
    edgePaths += `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-opacity="${op}" stroke-width="${ew(e.cooccur)}" stroke-linecap="round"/>`;
  }

  let nodeCircles = "";
  for (const n of nodes) {
    const p = pos.get(n.address)!;
    const named = n.label != null;
    nodeCircles += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${nr(n.weight)}" fill="${named ? EMBER : STONE}" fill-opacity="${named ? 0.95 : 0.55}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><g>${edgePaths}</g><g>${nodeCircles}</g></svg>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedW = parseInt(url.searchParams.get("w") || String(BASE_WIDTH), 10);
  const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number.isFinite(requestedW) ? requestedW : BASE_WIDTH));
  const h = Math.round((w * BASE_HEIGHT) / BASE_WIDTH);
  const scale = w / BASE_WIDTH;
  const wantsPng = url.searchParams.get("format") === "png";

  const host = publicHostFrom(req);
  const fonts = await loadCardFonts();

  // Live data: cache first, fall back to a one-off build.
  const cached = await getCachedCooccurrenceGraph();
  const graph = cached?.data ?? (await getCooccurrenceGraph(7));

  const connections = graph.edges.length;
  const contended = graph.edges.filter((e) => e.conflicts > 0).length;
  const chordSvg = buildChordSvg(graph);
  const chordDataUri = `data:image/svg+xml;base64,${Buffer.from(chordSvg).toString("base64")}`;

  const cardData: GraphCardData = {
    eyebrow: "MAP · MONAD MAINNET · 7-DAY WINDOW",
    headline: "Which contracts move together.",
    subline: "How Monad's protocols actually compose at runtime.",
    stats: [
      `${graph.nodes.length} contracts`,
      `${connections.toLocaleString()} connections`,
      contended > 0 ? `${contended} contend on storage` : "live execution-trace data",
    ],
    chordDataUri,
    footer: { host, path: "/graph" },
  };

  const png = new ImageResponse(renderGraphCard(cardData, scale), { width: w, height: h, fonts });

  if (wantsPng) {
    const buf = await png.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "content-disposition": `inline; filename="pev-graph-${w}.png"`,
      },
    });
  }

  return imageResponseAsJpeg(png, {
    headers: {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-disposition": `inline; filename="pev-graph-${w}.jpg"`,
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
