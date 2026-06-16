"use client";

/**
 * CooccurrenceGraph, an interactive force-directed map of the contract
 * relationship graph + a one-click branded PNG export.
 *
 * Layout: a DETERMINISTIC force simulation (seeded initial placement on a
 * circle, then repulsion + weighted springs + centering for a fixed
 * number of iterations, then normalised to fill the canvas). Because it
 * is deterministic and runs in useMemo, the server and client compute
 * identical positions — no hydration flash, no animation jank — while the
 * result fills the whole frame and clusters connected contracts together.
 *
 * Encoding:
 *   - edge thickness = co-occurrence weight
 *   - edge colour    = ember when the pair collides on storage
 *                      (contention), faint bone when they coexist cleanly
 *   - node size      = total connection weight
 *   - node colour    = ember if labelled, grey if unknown
 *
 * Interaction:
 *   - hover  → transient highlight of a node + its neighbours
 *   - drag   → reposition a node (grab and move)
 *   - click  → PIN a node's highlight (stays after the mouse leaves), so
 *              you can lock a contract's connections and screenshot them
 *   - click empty space → unpin
 *   - "open contract ↗" in the readout navigates to the contract page
 *   - "save image" → branded PNG (pev.silknodes.io/graph baked in)
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { themeA, palette } from "@/components/parallel/theme";
import type {
  CooccurrenceGraph as GraphData,
  CooccurrenceGraphNode,
} from "@/lib/indexer/store";

function shortAddr(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
function nodeDisplay(n: CooccurrenceGraphNode): string {
  const s = n.label ?? shortAddr(n.address);
  return s.length > 22 ? s.slice(0, 21) + "…" : s;
}
function fullName(n: CooccurrenceGraphNode): string {
  return n.label ?? shortAddr(n.address);
}

const SIZE = 1000;
const CX = SIZE / 2;
const CY = SIZE / 2;
const PAD = 120; // margin so labels don't clip after normalisation

type Pt = { x: number; y: number };

/**
 * Deterministic force-directed layout. No Math.random (seeded circle
 * start) so SSR and client agree. ~350 iterations is plenty for 50 nodes.
 */
function computeLayout(data: GraphData): Map<string, Pt> {
  const nodes = data.nodes;
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.address, i]));
  const P = nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: CX + 260 * Math.cos(a), y: CY + 260 * Math.sin(a), vx: 0, vy: 0 };
  });
  const maxW = Math.max(...data.edges.map((e) => e.cooccur), 1);
  const E = data.edges
    .map((e) => ({ a: idx.get(e.source)!, b: idx.get(e.target)!, w: e.cooccur }))
    .filter((e) => e.a != null && e.b != null);

  // Tuned for a dense, hub-heavy graph: strong repulsion + weak springs
  // so the mega-hubs don't collapse everything into a central blob.
  const REPEL = 32000;
  const SPRING = 0.014;
  const REST = 110;
  const CENTER = 0.008;
  const DAMP = 0.86;
  const ITERS = 450;

  for (let it = 0; it < ITERS; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = P[i].x - P[j].x;
        const dy = P[i].y - P[j].y;
        const d2 = dx * dx + dy * dy + 0.01;
        const d = Math.sqrt(d2);
        const f = REPEL / d2;
        const fx = (f * dx) / d;
        const fy = (f * dy) / d;
        P[i].vx += fx; P[i].vy += fy;
        P[j].vx -= fx; P[j].vy -= fy;
      }
    }
    for (const e of E) {
      const A = P[e.a];
      const B = P[e.b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const strength = SPRING * (0.3 + 0.7 * (e.w / maxW));
      const f = strength * (d - REST);
      const fx = (f * dx) / d;
      const fy = (f * dy) / d;
      A.vx += fx; A.vy += fy;
      B.vx -= fx; B.vy -= fy;
    }
    for (let i = 0; i < n; i++) {
      P[i].vx += (CX - P[i].x) * CENTER;
      P[i].vy += (CY - P[i].y) * CENTER;
      P[i].vx *= DAMP; P[i].vy *= DAMP;
      P[i].x += P[i].vx; P[i].y += P[i].vy;
    }
  }

  // Normalise to fill [PAD, SIZE-PAD] uniformly (keeps aspect, centres).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of P) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((SIZE - 2 * PAD) / spanX, (SIZE - 2 * PAD) / spanY);
  const offX = (SIZE - spanX * scale) / 2;
  const offY = (SIZE - spanY * scale) / 2;
  const out = new Map<string, Pt>();
  nodes.forEach((nd, i) => {
    out.set(nd.address, {
      x: offX + (P[i].x - minX) * scale,
      y: offY + (P[i].y - minY) * scale,
    });
  });
  return out;
}

export function CooccurrenceGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ addr: string; moved: boolean } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // Drag overrides on top of the computed layout.
  const [overrides, setOverrides] = useState<Map<string, Pt>>(new Map());
  const active = pinned ?? hovered;

  // Thin the graph to its strongest connections before laying it out. The
  // full 400 edges among 50 nodes is a near-complete graph that no layout
  // can declutter; the top ~150 by co-occurrence keep the real structure
  // while letting the force layout actually spread. Isolated nodes (whose
  // edges all got cut) are dropped.
  const EDGE_CAP = 150;
  const { nodes, edges } = useMemo(() => {
    const sorted = [...data.edges].sort((a, b) => b.cooccur - a.cooccur).slice(0, EDGE_CAP);
    const keep = new Set<string>();
    for (const e of sorted) { keep.add(e.source); keep.add(e.target); }
    return { nodes: data.nodes.filter((n) => keep.has(n.address)), edges: sorted };
  }, [data]);

  const base = useMemo(
    () => computeLayout({ nodes, edges, windowDays: data.windowDays, totalPairs: data.totalPairs }),
    [nodes, edges, data.windowDays, data.totalPairs],
  );
  const posOf = (addr: string): Pt => overrides.get(addr) ?? base.get(addr)!;

  const scales = useMemo(() => {
    const maxCooccur = Math.max(...edges.map((e) => e.cooccur), 1);
    const maxWeight = Math.max(...nodes.map((n) => n.weight), 1);
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
      (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return {
      adj,
      edgeWidth: (c: number) => 0.4 + 4.6 * Math.sqrt(c / maxCooccur),
      nodeRadius: (w: number) => 4 + 11 * Math.sqrt(w / maxWeight),
    };
  }, [nodes, edges]);

  // Convert a pointer event to SVG viewBox coordinates.
  function toSvg(e: React.PointerEvent): Pt {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIZE,
      y: ((e.clientY - rect.top) / rect.height) * SIZE,
    };
  }

  async function saveImage() {
    const svg = svgRef.current;
    if (!svg) return;
    setSaveState("saving");
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(SIZE));
      clone.setAttribute("height", String(SIZE));
      clone.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
      clone.style.width = `${SIZE}px`;
      clone.style.height = `${SIZE}px`;
      clone.style.maxWidth = "none";
      const svgStr = new XMLSerializer().serializeToString(clone);
      const svgUrl = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));

      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("rasterise failed"));
        img.src = svgUrl;
      });

      const scale = 2;
      const headerH = 96;
      const footerH = 60;
      const W = SIZE;
      const H = SIZE + headerH + footerH;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.fillStyle = "#0e0d0b";
      ctx.fillRect(0, 0, W, H);

      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = palette.bone;
      ctx.font = "italic 34px Georgia, 'Times New Roman', serif";
      const pinnedNode = pinned ? nodes.find((nd) => nd.address === pinned) : null;
      ctx.fillText(
        pinnedNode ? `${fullName(pinnedNode)} — connections` : "Which contracts move together.",
        40, 56,
      );
      ctx.fillStyle = themeA.muted;
      ctx.font = "15px ui-monospace, Menlo, monospace";
      ctx.fillText(
        `Monad mainnet · ${nodes.length} contracts · ${edges.length} connections · 7-day window`,
        40, 80,
      );

      ctx.drawImage(img, 0, headerH, SIZE, SIZE);

      const fy = headerH + SIZE + 38;
      ctx.textAlign = "left";
      ctx.fillStyle = palette.ember;
      ctx.font = "italic 26px Georgia, serif";
      ctx.fillText("pev.", 40, fy);
      ctx.textAlign = "right";
      ctx.fillStyle = themeA.muted;
      ctx.font = "16px ui-monospace, Menlo, monospace";
      ctx.fillText("pev.silknodes.io/graph", W - 40, fy);

      URL.revokeObjectURL(svgUrl);
      await new Promise<void>((res) => {
        canvas.toBlob((blob) => {
          if (blob) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "pev-relationship-graph.png";
            a.click();
            URL.revokeObjectURL(a.href);
          }
          res();
        }, "image/png");
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("idle");
    }
  }

  if (nodes.length === 0) {
    return <div style={{ color: themeA.muted, fontSize: 14, padding: 24 }}>No relationship data yet.</div>;
  }

  const neighbours = active ? scales.adj.get(active) ?? new Set<string>() : null;
  const isFocusNode = (addr: string) => !active || addr === active || (neighbours?.has(addr) ?? false);
  const isFocusEdge = (s: string, t: string) => !active || s === active || t === active;
  const activeNode = active ? nodes.find((n) => n.address === active) ?? null : null;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, marginBottom: 8, fontFamily: themeA.mono, fontSize: 12,
          color: themeA.muted, minHeight: 28, flexWrap: "wrap",
        }}
      >
        <span>
          {activeNode ? (
            <>
              <span style={{ color: palette.ember }}>{fullName(activeNode)}</span>
              {" · "}
              {activeNode.degree} connection{activeNode.degree === 1 ? "" : "s"}
              {" · "}
              <a
                href={`/contract/${active}`}
                className="pev-link"
                onClick={(e) => { e.stopPropagation(); router.push(`/contract/${active}`); }}
                style={{ color: themeA.text }}
              >
                open contract ↗
              </a>
              {" · "}
              <span style={{ color: themeA.subtle }}>
                {pinned ? "pinned — drag nodes, or save image" : "click to pin"}
              </span>
            </>
          ) : (
            <span>hover to trace · drag to rearrange · click to pin</span>
          )}
        </span>
        <button
          type="button" onClick={saveImage} disabled={saveState === "saving"}
          className="pev-graph-save"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px",
            background: themeA.btnBg, border: `1px solid ${themeA.border}`,
            borderRadius: themeA.radius, color: saveState === "saved" ? palette.sage : themeA.text,
            fontFamily: themeA.mono, fontSize: 12,
            cursor: saveState === "saving" ? "default" : "pointer", whiteSpace: "nowrap",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {saveState === "saved" ? "saved to downloads" : saveState === "saving" ? "rendering…" : "save image"}
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{
          width: "auto", height: "min(84vh, 880px)", maxWidth: "100%",
          display: "block", margin: "0 auto", background: themeA.graphBg,
          borderRadius: themeA.radius, touchAction: "none",
        }}
        role="img"
        aria-label="Force-directed contract relationship graph for Monad mainnet"
      >
        {/* Background: click empty space to unpin */}
        <rect x={0} y={0} width={SIZE} height={SIZE} fill="transparent" onClick={() => setPinned(null)} />

        {/* Edges (straight lines for the force layout) */}
        <g>
          {edges.map((e, i) => {
            const a = posOf(e.source);
            const b = posOf(e.target);
            if (!a || !b) return null;
            const contended = e.conflicts > 0;
            const focus = isFocusEdge(e.source, e.target);
            let opacity = contended ? 0.5 : 0.13;
            if (active) opacity = focus ? (contended ? 0.85 : 0.5) : 0.03;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={contended ? palette.ember : palette.bone}
                strokeOpacity={opacity}
                strokeWidth={scales.edgeWidth(e.cooccur) * (active && focus ? 1.5 : 1)}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Nodes + labels */}
        <g>
          {nodes.map((n) => {
            const p = posOf(n.address);
            const r = scales.nodeRadius(n.weight);
            const named = n.label != null;
            const focus = isFocusNode(n.address);
            const isActive = n.address === active;
            // Label sits on whichever side keeps it inside the frame.
            const leftSide = p.x > SIZE * 0.62;
            const lx = leftSide ? p.x - r - 5 : p.x + r + 5;
            const anchor = leftSide ? "end" : "start";
            return (
              <g
                key={n.address}
                style={{ cursor: "grab" }}
                opacity={focus ? 1 : 0.16}
                onMouseEnter={() => setHovered(n.address)}
                onMouseLeave={() => setHovered(null)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture(e.pointerId);
                  dragRef.current = { addr: n.address, moved: false };
                }}
                onPointerMove={(e) => {
                  if (dragRef.current?.addr === n.address) {
                    dragRef.current.moved = true;
                    const pt = toSvg(e);
                    setOverrides((prev) => new Map(prev).set(n.address, pt));
                  }
                }}
                onPointerUp={(e) => {
                  if (dragRef.current?.addr === n.address) {
                    if (!dragRef.current.moved) {
                      setPinned((cur) => (cur === n.address ? null : n.address));
                    }
                    dragRef.current = null;
                    (e.target as Element).releasePointerCapture?.(e.pointerId);
                  }
                }}
              >
                <circle
                  cx={p.x} cy={p.y} r={isActive ? r * 1.4 : r}
                  fill={named ? palette.ember : palette.stone}
                  fillOpacity={named ? 0.95 : 0.6}
                  stroke={isActive ? palette.bone : themeA.graphBg}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {(named || isActive) && (
                  <text
                    x={lx} y={p.y}
                    fontSize={isActive ? 13 : 10}
                    fontFamily={named ? "var(--font-sans, sans-serif)" : "var(--font-mono, monospace)"}
                    fill={isActive ? palette.bone : named ? themeA.text : themeA.muted}
                    fontWeight={isActive ? 600 : 400}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    style={{ pointerEvents: "none" }}
                  >
                    {nodeDisplay(n)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
