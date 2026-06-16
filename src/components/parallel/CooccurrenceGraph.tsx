"use client";

/**
 * CooccurrenceGraph, an interactive SVG of the contract relationship
 * graph + a one-click branded PNG export.
 *
 * Static encoding:
 *   - edge thickness = co-occurrence weight
 *   - edge color     = ember when the pair collides on storage
 *                      (contention), faint bone when they coexist cleanly
 *   - node size      = total connection weight
 *   - node color     = ember if labelled, grey if unknown
 *
 * Interaction:
 *   - hover a node  → transient highlight of it + its neighbours
 *   - click a node  → PIN that highlight (stays after the mouse leaves),
 *                     so you can lock a contract's connections and then
 *                     screenshot them. Click again (or the node) to unpin.
 *   - "open contract ↗" in the readout navigates to the contract page.
 *   - "save image"  → branded PNG (title + pev.silknodes.io/graph baked
 *                     in). Captures the current view, including a pin.
 *
 * Circular layout is deterministic, so the SSR render matches hydration.
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
  return s.length > 18 ? s.slice(0, 17) + "…" : s;
}
function fullName(n: CooccurrenceGraphNode): string {
  return n.label ?? shortAddr(n.address);
}

// Square viewBox; the circle fills most of it, with just enough margin
// for the (truncated) radial labels to sit outside the ring un-clipped.
const SIZE = 1000;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = SIZE * 0.35;
const LABEL_RADIUS = RADIUS + 14;

export function CooccurrenceGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const { nodes, edges } = data;

  // The node whose connections are currently highlighted: a pin wins over
  // a transient hover.
  const active = pinned ?? hovered;

  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; angle: number }>();
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos.set(n.address, { x: CX + RADIUS * Math.cos(a), y: CY + RADIUS * Math.sin(a), angle: a });
    });
    const maxCooccur = Math.max(...edges.map((e) => e.cooccur), 1);
    const maxWeight = Math.max(...nodes.map((n) => n.weight), 1);
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
      (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return {
      pos,
      adj,
      edgeWidth: (c: number) => 0.4 + 4.6 * Math.sqrt(c / maxCooccur),
      nodeRadius: (w: number) => 3 + 10 * Math.sqrt(w / maxWeight),
    };
  }, [nodes, edges]);

  async function saveImage() {
    const svg = svgRef.current;
    if (!svg) return;
    setSaveState("saving");
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(SIZE));
      clone.setAttribute("height", String(SIZE));
      clone.style.width = `${SIZE}px`;
      clone.style.height = `${SIZE}px`;
      clone.style.maxWidth = "none";
      const svgStr = new XMLSerializer().serializeToString(clone);
      const svgUrl = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));

      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("svg rasterise failed"));
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
      const pinnedNode = pinned ? nodes.find((n) => n.address === pinned) : null;
      ctx.fillText(
        pinnedNode ? `${fullName(pinnedNode)} — connections` : "Which contracts move together.",
        40,
        56,
      );
      ctx.fillStyle = themeA.muted;
      ctx.font = "15px ui-monospace, Menlo, monospace";
      ctx.fillText(
        `Monad mainnet · ${nodes.length} contracts · ${edges.length} connections · 7-day window`,
        40,
        80,
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

  const neighbours = active ? layout.adj.get(active) ?? new Set<string>() : null;
  const isFocusNode = (addr: string) => !active || addr === active || (neighbours?.has(addr) ?? false);
  const isFocusEdge = (s: string, t: string) => !active || s === active || t === active;
  const activeNode = active ? nodes.find((n) => n.address === active) ?? null : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Top bar: readout (left) + save button (right) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
          fontFamily: themeA.mono,
          fontSize: 12,
          color: themeA.muted,
          minHeight: 28,
          flexWrap: "wrap",
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
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/contract/${active}`);
                }}
                style={{ color: themeA.text }}
              >
                open contract ↗
              </a>
              {" · "}
              <span style={{ color: themeA.subtle }}>
                {pinned ? "pinned — save image captures this" : "click to pin"}
              </span>
            </>
          ) : (
            <span>hover a contract to trace its connections · click to pin one</span>
          )}
        </span>
        <button
          type="button"
          onClick={saveImage}
          disabled={saveState === "saving"}
          className="pev-graph-save"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 12px",
            background: themeA.btnBg,
            border: `1px solid ${themeA.border}`,
            borderRadius: themeA.radius,
            color: saveState === "saved" ? palette.sage : themeA.text,
            fontFamily: themeA.mono,
            fontSize: 12,
            cursor: saveState === "saving" ? "default" : "pointer",
            whiteSpace: "nowrap",
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
          width: "auto",
          height: "min(84vh, 880px)",
          maxWidth: "100%",
          display: "block",
          margin: "0 auto",
          background: themeA.graphBg,
          borderRadius: themeA.radius,
        }}
        role="img"
        aria-label="Contract relationship graph: which Monad contracts co-occur in the same transactions"
      >
        {/* Edges */}
        <g>
          {edges.map((e, i) => {
            const a = layout.pos.get(e.source);
            const b = layout.pos.get(e.target);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const pull = 0.45;
            const qx = mx + (CX - mx) * pull;
            const qy = my + (CY - my) * pull;
            const contended = e.conflicts > 0;
            const focus = isFocusEdge(e.source, e.target);
            let opacity = contended ? 0.5 : 0.14;
            if (active) opacity = focus ? (contended ? 0.85 : 0.5) : 0.04;
            return (
              <path
                key={i}
                d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`}
                fill="none"
                stroke={contended ? palette.ember : palette.bone}
                strokeOpacity={opacity}
                strokeWidth={layout.edgeWidth(e.cooccur) * (active && focus ? 1.5 : 1)}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Nodes + labels */}
        <g>
          {nodes.map((n) => {
            const p = layout.pos.get(n.address)!;
            const r = layout.nodeRadius(n.weight);
            const onRight = Math.cos(p.angle) >= 0;
            const lx = CX + LABEL_RADIUS * Math.cos(p.angle);
            const ly = CY + LABEL_RADIUS * Math.sin(p.angle);
            const named = n.label != null;
            const focus = isFocusNode(n.address);
            const isActive = n.address === active;
            const angleDeg = (p.angle * 180) / Math.PI;
            const labelRot = onRight ? angleDeg : angleDeg + 180;
            const labelAnchor = onRight ? "start" : "end";
            return (
              <g
                key={n.address}
                style={{ cursor: "pointer" }}
                opacity={focus ? 1 : 0.18}
                onMouseEnter={() => setHovered(n.address)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setPinned((cur) => (cur === n.address ? null : n.address))}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isActive ? r * 1.4 : r}
                  fill={named ? palette.ember : palette.stone}
                  fillOpacity={named ? 0.95 : 0.6}
                  stroke={isActive ? palette.bone : themeA.graphBg}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {(named || isActive) && (
                  <text
                    x={lx}
                    y={ly}
                    fontSize={isActive ? 12 : 10}
                    fontFamily={named ? "var(--font-sans, sans-serif)" : "var(--font-mono, monospace)"}
                    fill={isActive ? palette.bone : named ? themeA.text : themeA.muted}
                    fontWeight={isActive ? 600 : 400}
                    textAnchor={labelAnchor}
                    dominantBaseline="middle"
                    transform={`rotate(${labelRot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`}
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
