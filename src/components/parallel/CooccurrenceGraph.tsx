"use client";

/**
 * CooccurrenceGraph, an interactive SVG of the contract relationship
 * graph. Nodes (contracts) sit on a circle; edges (curved chords)
 * connect contracts that co-occur in the same transactions.
 *
 * Static encoding:
 *   - edge thickness = co-occurrence weight
 *   - edge color     = ember when the pair collides on storage
 *                      (contention), faint bone when they coexist cleanly
 *   - node size      = total connection weight
 *   - node color     = ember if labelled, grey if unknown
 *
 * Interaction:
 *   - hover a node  → highlight it + its neighbours + the edges between
 *                     them, fade everything else, surface a readout
 *   - click a node  → navigate to that contract's page
 *
 * Circular layout is deterministic (no force sim), so the initial SSR
 * render matches hydration exactly. Interaction is layered on with
 * local state; the heavy data still comes precomputed from the cache.
 */

import { useMemo, useState } from "react";
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
  return n.label ?? shortAddr(n.address);
}

const SIZE = 900;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = SIZE * 0.38;
const LABEL_RADIUS = RADIUS + 18;

export function CooccurrenceGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const { nodes, edges } = data;

  // Layout + scales + adjacency, computed once for the dataset.
  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; angle: number }>();
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos.set(n.address, { x: CX + RADIUS * Math.cos(a), y: CY + RADIUS * Math.sin(a), angle: a });
    });
    const maxCooccur = Math.max(...edges.map((e) => e.cooccur), 1);
    const maxWeight = Math.max(...nodes.map((n) => n.weight), 1);
    // Adjacency: address -> set of neighbour addresses.
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

  if (nodes.length === 0) {
    return <div style={{ color: themeA.muted, fontSize: 14, padding: 24 }}>No relationship data yet.</div>;
  }

  const neighbours = hovered ? layout.adj.get(hovered) ?? new Set<string>() : null;
  const isFocusNode = (addr: string) => !hovered || addr === hovered || (neighbours?.has(addr) ?? false);
  const isFocusEdge = (s: string, t: string) => !hovered || s === hovered || t === hovered;

  const hoveredNode = hovered ? nodes.find((n) => n.address === hovered) ?? null : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ width: "100%", height: "auto", display: "block", background: themeA.graphBg, borderRadius: themeA.radius }}
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
            // Base opacities; dim hard when another node is focused.
            let opacity = contended ? 0.5 : 0.14;
            if (hovered) opacity = focus ? (contended ? 0.85 : 0.5) : 0.04;
            return (
              <path
                key={i}
                d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`}
                fill="none"
                stroke={contended ? palette.ember : palette.bone}
                strokeOpacity={opacity}
                strokeWidth={layout.edgeWidth(e.cooccur) * (hovered && focus ? 1.5 : 1)}
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
            const isHovered = n.address === hovered;
            return (
              <g
                key={n.address}
                style={{ cursor: "pointer" }}
                opacity={focus ? 1 : 0.18}
                onMouseEnter={() => setHovered(n.address)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => router.push(`/contract/${n.address}`)}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? r * 1.4 : r}
                  fill={named ? palette.ember : palette.stone}
                  fillOpacity={named ? 0.95 : 0.6}
                  stroke={isHovered ? palette.bone : themeA.graphBg}
                  strokeWidth={isHovered ? 2 : 1.5}
                />
                {/* Show labels for named nodes always; for unnamed only when focused by a hover */}
                {(named || (hovered && focus)) && (
                  <text
                    x={lx}
                    y={ly}
                    fontSize={isHovered ? 13 : 11}
                    fontFamily={named ? "var(--font-sans, sans-serif)" : "var(--font-mono, monospace)"}
                    fill={isHovered ? palette.bone : named ? themeA.text : themeA.muted}
                    fontWeight={isHovered ? 600 : 400}
                    textAnchor={onRight ? "start" : "end"}
                    dominantBaseline="middle"
                  >
                    {nodeDisplay(n)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover readout: who you're on + its connection count */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          minHeight: 18,
          fontFamily: themeA.mono,
          fontSize: 12,
          color: themeA.muted,
          pointerEvents: "none",
        }}
      >
        {hoveredNode ? (
          <span>
            <span style={{ color: palette.ember }}>{nodeDisplay(hoveredNode)}</span>
            {" · "}
            {hoveredNode.degree} connection{hoveredNode.degree === 1 ? "" : "s"}
            {" · click to open contract"}
          </span>
        ) : (
          <span>hover a contract to trace its connections</span>
        )}
      </div>
    </div>
  );
}
