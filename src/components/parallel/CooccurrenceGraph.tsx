/**
 * CooccurrenceGraph, a server-rendered SVG of the contract relationship
 * graph. Nodes (contracts) sit on a circle; edges (curved chords) connect
 * contracts that co-occur in the same transactions. Edge thickness encodes
 * co-occurrence weight; edge color encodes contention (ember when the pair
 * actually collides on storage, faint when they coexist cleanly). Node
 * size encodes total connection weight.
 *
 * Circular layout chosen deliberately: it is deterministic (no force
 * simulation, so it renders identically server-side every time), it reads
 * cleanly as a chord diagram, and it scales to ~50 nodes without becoming
 * a hairball. Pure SVG, no client JS, matching ConflictGraph.tsx.
 */

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

export function CooccurrenceGraph({ data }: { data: GraphData }) {
  const { nodes, edges } = data;
  if (nodes.length === 0) {
    return (
      <div style={{ color: themeA.muted, fontSize: 14, padding: 24 }}>
        No relationship data yet.
      </div>
    );
  }

  // ── Layout geometry ────────────────────────────────────────────
  const size = 900; // viewBox square
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38; // node ring radius
  const labelRadius = radius + 18; // labels sit just outside the ring

  // Place nodes evenly on the circle, heaviest first (data is pre-sorted).
  const angleFor = (i: number) => (2 * Math.PI * i) / nodes.length - Math.PI / 2;
  const pos = new Map<string, { x: number; y: number; angle: number }>();
  nodes.forEach((n, i) => {
    const a = angleFor(i);
    pos.set(n.address, { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), angle: a });
  });

  // ── Scales ─────────────────────────────────────────────────────
  const maxCooccur = Math.max(...edges.map((e) => e.cooccur), 1);
  const maxWeight = Math.max(...nodes.map((n) => n.weight), 1);
  // Edge stroke width: 0.4px .. 5px on a sqrt scale (so the biggest
  // edges don't drown everything; co-occurrence is heavy-tailed).
  const edgeWidth = (c: number) => 0.4 + 4.6 * Math.sqrt(c / maxCooccur);
  // Node radius: 3px .. 13px, sqrt-scaled by weight.
  const nodeRadius = (w: number) => 3 + 10 * Math.sqrt(w / maxWeight);
  // A pair "contends" if it has recorded storage conflicts.
  const isContended = (conflicts: number) => conflicts > 0;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: "100%", height: "auto", display: "block", background: themeA.graphBg, borderRadius: themeA.radius }}
      role="img"
      aria-label="Contract relationship graph: which Monad contracts co-occur in the same transactions"
    >
      {/* Edges first, so nodes draw on top */}
      <g>
        {edges.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          // Quadratic curve bowing toward the center, so chords between
          // distant nodes arc inward (classic chord-diagram look).
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const pull = 0.45; // 0 = straight, 1 = through center
          const qx = mx + (cx - mx) * pull;
          const qy = my + (cy - my) * pull;
          const contended = isContended(e.conflicts);
          return (
            <path
              key={i}
              d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`}
              fill="none"
              stroke={contended ? palette.ember : palette.bone}
              strokeOpacity={contended ? 0.5 : 0.14}
              strokeWidth={edgeWidth(e.cooccur)}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* Nodes + labels */}
      <g>
        {nodes.map((n) => {
          const p = pos.get(n.address)!;
          const r = nodeRadius(n.weight);
          // Label anchoring: right half of the circle anchors start,
          // left half anchors end, so text radiates outward cleanly.
          const onRight = Math.cos(p.angle) >= 0;
          const lx = cx + labelRadius * Math.cos(p.angle);
          const ly = cy + labelRadius * Math.sin(p.angle);
          const named = n.label != null;
          return (
            <g key={n.address}>
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={named ? palette.ember : palette.stone}
                fillOpacity={named ? 0.95 : 0.6}
                stroke={themeA.graphBg}
                strokeWidth={1.5}
              />
              <text
                x={lx}
                y={ly}
                fontSize={11}
                fontFamily={named ? "var(--font-sans, sans-serif)" : "var(--font-mono, monospace)"}
                fill={named ? themeA.text : themeA.muted}
                textAnchor={onRight ? "start" : "end"}
                dominantBaseline="middle"
                transform={`rotate(0 ${lx.toFixed(1)} ${ly.toFixed(1)})`}
              >
                {nodeDisplay(n)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
