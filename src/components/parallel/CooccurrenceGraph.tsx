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

import { useEffect, useMemo, useRef, useState } from "react";
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

type Pt = { x: number; y: number };

export function CooccurrenceGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // Real-time light-up: pings fired when a live block touches a node, and
  // the SSE connection status.
  const [pings, setPings] = useState<{ id: number; x: number; y: number }[]>([]);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  // View mode: "rel" shows all relationships; "contention" fades clean
  // pairs and lights up only the ones that co-occur in contended txs.
  const [view, setView] = useState<"rel" | "contention">("rel");
  const pingId = useRef(0);
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

    // Continuous-flow particles: the strongest edges each carry a dot that
    // perpetually travels the chord, so the network is always in motion
    // (the gmonads "energy coursing through the network" feel). Staggered,
    // deterministic timing so SSR and client agree and they don't pulse in
    // lockstep. Heavier / contended edges flow a touch faster + brighter.
    const maxConflict = Math.max(...edges.map((e) => e.conflicts), 1);
    const flowEdges = [...edges]
      .sort((a, b) => b.cooccur - a.cooccur)
      .slice(0, 72)
      .map((e, i) => {
        const a = pos.get(e.source)!;
        const b = pos.get(e.target)!;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const qx = mx + (CX - mx) * 0.45;
        const qy = my + (CY - my) * 0.45;
        const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        // "hot" = meaningful conflict magnitude, not the near-universal
        // conflicts > 0. Drives the contention-view flow filter + accent.
        const hot = e.conflicts / maxConflict >= 0.05;
        return {
          d,
          hot,
          dur: (hot ? 1.0 : 1.4) + (i % 6) * 0.12,
          begin: `-${((i * 0.13) % 2).toFixed(2)}s`,
          source: e.source,
          target: e.target,
        };
      });

    return {
      pos,
      adj,
      nodeByAddr,
      flowEdges,
      maxCooccur,
      maxConflict,
      edgeWidth: (c: number) => 0.4 + 4.6 * Math.sqrt(c / maxCooccur),
      nodeRadius: (w: number) => 3 + 10 * Math.sqrt(w / maxWeight),
    };
  }, [nodes, edges]);

  // Real-time light-up: subscribe to the live block feed and ping any of
  // our nodes that a freshly-indexed block touched. Auto-reconnects.
  useEffect(() => {
    const posByLower = new Map<string, Pt>();
    for (const n of nodes) {
      const p = layout.pos.get(n.address);
      if (p) posByLower.set(n.address.toLowerCase(), { x: p.x, y: p.y });
    }
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/v1/graph-live");
      es.onopen = () => setLive("live");
      es.addEventListener("hello", () => setLive("live"));
      es.addEventListener("block", (ev) => {
        try {
          const { contracts } = JSON.parse((ev as MessageEvent).data) as { contracts: string[] };
          const fresh: { id: number; x: number; y: number }[] = [];
          for (const c of contracts) {
            const p = posByLower.get(c.toLowerCase());
            if (p) fresh.push({ id: pingId.current++, x: p.x, y: p.y });
            if (fresh.length >= 16) break; // cap pings per block
          }
          if (fresh.length) {
            setPings((prev) => [...prev, ...fresh]);
            const ids = new Set(fresh.map((f) => f.id));
            setTimeout(() => setPings((prev) => prev.filter((p) => !ids.has(p.id))), 800);
          }
        } catch {
          /* ignore malformed event */
        }
      });
      es.onerror = () => {
        setLive("offline");
        es?.close();
        if (!closed) retry = setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [nodes, layout]);

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
  const anyContended = edges.some((e) => e.conflicts > 0);

  const ToggleBtn = ({ id, label }: { id: "rel" | "contention"; label: string }) => (
    <button
      type="button"
      onClick={() => setView(id)}
      style={{
        padding: "5px 11px",
        background: view === id ? themeA.btnBg : "transparent",
        border: "none",
        color: view === id ? (id === "contention" ? palette.ember : themeA.text) : themeA.subtle,
        fontFamily: themeA.mono,
        fontSize: 12,
        fontWeight: view === id ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, marginBottom: 8, fontFamily: themeA.mono, fontSize: 12,
          color: themeA.muted, minHeight: 28, flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "inline-flex", border: `1px solid ${themeA.border}`, borderRadius: themeA.radius, overflow: "hidden" }}>
            <ToggleBtn id="rel" label="relationships" />
            <ToggleBtn id="contention" label="contention" />
          </span>
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={live === "live" ? "streaming live blocks" : live === "offline" ? "reconnecting" : "connecting"}>
            <span
              className={live === "live" ? "pev-live-dot" : undefined}
              style={{
                width: 7, height: 7, borderRadius: 7,
                background: live === "live" ? palette.sage : live === "offline" ? palette.terracotta : palette.amber,
                display: "inline-block",
              }}
            />
            <span style={{ color: themeA.subtle }}>{live === "live" ? "live" : live === "offline" ? "offline" : "…"}</span>
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
        </span>
      </div>

      {view === "contention" && !anyContended && (
        <div
          style={{
            marginBottom: 8,
            padding: "8px 12px",
            background: themeA.hintBg,
            border: `1px solid ${themeA.border}`,
            borderRadius: themeA.radius,
            fontFamily: themeA.mono,
            fontSize: 12,
            color: themeA.muted,
          }}
        >
          No contention recorded in this window yet. The contention layer fills once the
          conflict-count rollup has run.
        </div>
      )}

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
            const focus = isFocusEdge(e.source, e.target);
            const relC = e.cooccur / layout.maxCooccur;

            let opacity: number;
            let stroke: string;
            let width: number;
            if (view === "contention") {
              // Contention view: rank by conflict MAGNITUDE. Nearly every
              // pair has conflicts > 0 (a tx with 50 contracts flags all its
              // pairs when one collides), so a binary highlight is useless,
              // we scale by conflict_count and hard-fade the low end so only
              // the genuine hotspots glow.
              stroke = palette.ember;
              const relX = e.conflicts / layout.maxConflict;
              if (relX < 0.05) {
                opacity = 0.02;
                width = 0.4;
              } else {
                opacity = 0.35 + 0.6 * relX;
                width = 0.8 + 5 * Math.sqrt(relX);
              }
              if (active) opacity = focus ? opacity : 0.01;
            } else {
              // Relationship view: neutral composability. Depth by
              // co-occurrence strength; contention lives in the other view.
              stroke = palette.bone;
              opacity = 0.12 + 0.4 * relC;
              if (active) opacity = focus ? 0.7 : 0.03;
              width = layout.edgeWidth(e.cooccur) * (active && focus ? 1.5 : 1);
            }
            return (
              <path
                key={i}
                d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`}
                fill="none"
                stroke={stroke}
                strokeOpacity={opacity}
                strokeWidth={width}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Continuous flow: dots perpetually streaming along the strongest
            edges, so the network is always in motion. */}
        <g>
          {layout.flowEdges.map((fe, i) => {
            const focus = isFocusEdge(fe.source, fe.target);
            if (active && !focus) return null; // when inspecting, only flow the focused edges
            // Contention view: only the genuinely hot edges stream, in ember.
            // Relationship view: every strong edge streams, neutral bone.
            if (view === "contention" && !fe.hot) return null;
            const ember = view === "contention";
            return (
              <circle
                key={i}
                r={ember ? 2.6 : 2}
                fill={ember ? palette.ember : palette.bone}
                opacity={ember ? 0.9 : 0.5}
              >
                <animateMotion dur={`${fe.dur}s`} begin={fe.begin} repeatCount="indefinite" path={fe.d} />
              </circle>
            );
          })}
        </g>

        {/* Live pings: expanding ember rings when a block touches a node */}
        <g>
          {pings.map((p) => (
            <circle key={p.id} cx={p.x} cy={p.y} r={4} fill="none" stroke={palette.ember} strokeWidth={2.5} opacity={0.7}>
              <animate attributeName="r" from="4" to="34" dur="0.7s" fill="freeze" />
              <animate attributeName="opacity" from="0.7" to="0" dur="0.7s" fill="freeze" />
            </circle>
          ))}
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
