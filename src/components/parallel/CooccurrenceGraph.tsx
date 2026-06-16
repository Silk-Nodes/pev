"use client";

/**
 * CooccurrenceGraph, an interactive circular (chord-style) map of the
 * contract relationship graph + a pin detail panel + branded PNG export.
 *
 * Layout: nodes on a circle, edges as curved chords bowing toward the
 * centre. Deterministic, so SSR and client agree. Radial "spoke" labels
 * read outward so they don't stack.
 *
 * Encoding:
 *   - edge thickness = co-occurrence weight
 *   - edge colour    = ember when the pair collides on storage
 *                      (contention), faint bone when they coexist cleanly
 *   - node size      = total connection weight
 *   - node colour    = ember if labelled, grey if unknown
 *
 * Interaction:
 *   - hover → transient highlight of a node + its neighbours
 *   - click → PIN it: locks the highlight AND opens a detail panel with
 *             its top connections; click a connection there to walk the
 *             graph; click empty space to unpin
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
function fullName(n: CooccurrenceGraphNode): string {
  return n.label ?? shortAddr(n.address);
}
function nodeDisplay(n: CooccurrenceGraphNode): string {
  const s = fullName(n);
  return s.length > 22 ? s.slice(0, 21) + "…" : s;
}
function fmt(n: number): string {
  return n.toLocaleString();
}

const SIZE = 1000;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = SIZE * 0.34;
const LABEL_RADIUS = RADIUS + 14;

export function CooccurrenceGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const { nodes, edges } = data;
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
    const nodeByAddr = new Map(nodes.map((n) => [n.address, n]));
    return {
      pos,
      adj,
      nodeByAddr,
      edgeWidth: (c: number) => 0.4 + 4.6 * Math.sqrt(c / maxCooccur),
      nodeRadius: (w: number) => 3 + 10 * Math.sqrt(w / maxWeight),
    };
  }, [nodes, edges]);

  // Detail for the pinned contract: its connections, ranked.
  const detail = useMemo(() => {
    if (!pinned) return null;
    const self = layout.nodeByAddr.get(pinned);
    if (!self) return null;
    const conns = edges
      .filter((e) => e.source === pinned || e.target === pinned)
      .map((e) => {
        const otherAddr = e.source === pinned ? e.target : e.source;
        return { node: layout.nodeByAddr.get(otherAddr), cooccur: e.cooccur, conflicts: e.conflicts };
      })
      .filter((c) => c.node)
      .sort((a, b) => b.cooccur - a.cooccur);
    return {
      self,
      conns,
      totalCooccur: conns.reduce((s, c) => s + c.cooccur, 0),
      contendedCount: conns.filter((c) => c.conflicts > 0).length,
    };
  }, [pinned, edges, layout]);

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
      const pinnedNode = pinned ? layout.nodeByAddr.get(pinned) : null;
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

  const neighbours = active ? layout.adj.get(active) ?? new Set<string>() : null;
  const isFocusNode = (addr: string) => !active || addr === active || (neighbours?.has(addr) ?? false);
  const isFocusEdge = (s: string, t: string) => !active || s === active || t === active;
  const activeNode = active ? layout.nodeByAddr.get(active) ?? null : null;

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
              <span style={{ color: themeA.subtle }}>{pinned ? "pinned" : "click to pin"}</span>
            </>
          ) : (
            <span>hover a contract to trace its connections · click to pin one</span>
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
          display: "block", margin: "0 auto", background: themeA.graphBg, borderRadius: themeA.radius,
        }}
        role="img"
        aria-label="Contract relationship graph for Monad mainnet"
      >
        <rect x={0} y={0} width={SIZE} height={SIZE} fill="transparent" onClick={() => setPinned(null)} />

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

        {/* Nodes + radial labels */}
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
                onClick={(e) => {
                  e.stopPropagation();
                  setPinned((cur) => (cur === n.address ? null : n.address));
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
                    x={lx} y={ly}
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

      {/* Pin detail panel: sits in the top-left corner the circle leaves empty */}
      {detail && (
        <div
          style={{
            position: "absolute",
            top: 44,
            left: 0,
            width: 290,
            maxHeight: "min(78vh, 820px)",
            overflowY: "auto",
            background: "rgba(20,19,16,0.94)",
            border: `1px solid ${themeA.border}`,
            borderRadius: themeA.radius,
            padding: "14px 16px",
            backdropFilter: "blur(2px)",
          }}
        >
          <div style={{ fontFamily: themeA.sans, fontSize: 16, color: themeA.text, fontWeight: 600, lineHeight: 1.25 }}>
            {fullName(detail.self)}
          </div>
          <div style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle, marginTop: 4, wordBreak: "break-all" }}>
            {detail.self.address}
          </div>
          <a
            href={`/contract/${detail.self.address}`}
            className="pev-link"
            onClick={(e) => { e.stopPropagation(); router.push(`/contract/${detail.self.address}`); }}
            style={{ display: "inline-block", marginTop: 6, fontFamily: themeA.mono, fontSize: 12, color: palette.ember }}
          >
            open contract ↗
          </a>

          <div style={{ display: "flex", gap: 14, margin: "12px 0", flexWrap: "wrap", fontFamily: themeA.mono, fontSize: 11, color: themeA.muted }}>
            <span><strong style={{ color: themeA.text }}>{detail.conns.length}</strong> linked</span>
            <span><strong style={{ color: themeA.text }}>{fmt(detail.totalCooccur)}</strong> co-occ</span>
            <span><strong style={{ color: detail.contendedCount > 0 ? palette.ember : themeA.text }}>{detail.contendedCount}</strong> contend</span>
          </div>

          <div style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, letterSpacing: "0.05em", marginBottom: 6 }}>
            TOP CONNECTIONS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {detail.conns.slice(0, 12).map((c) => (
              <button
                key={c.node!.address}
                type="button"
                onClick={(e) => { e.stopPropagation(); setPinned(c.node!.address); }}
                style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
                  background: "transparent", border: "none", padding: "3px 0", cursor: "pointer",
                  textAlign: "left", width: "100%",
                }}
                title={fullName(c.node!)}
              >
                <span style={{ fontFamily: themeA.sans, fontSize: 12, color: c.node!.label ? themeA.text : themeA.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {c.conflicts > 0 && <span style={{ color: palette.ember }} title="contends on storage">⚠ </span>}
                  {nodeDisplay(c.node!)}
                </span>
                <span style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle, whiteSpace: "nowrap" }}>
                  {fmt(c.cooccur)}×
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPinned(null); }}
            style={{
              marginTop: 12, background: "transparent", border: "none", padding: 0,
              cursor: "pointer", fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle,
            }}
          >
            ✕ clear
          </button>
        </div>
      )}
    </div>
  );
}
