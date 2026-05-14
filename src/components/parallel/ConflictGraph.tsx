"use client";

/**
 * ConflictGraph — SVG-based DAG of conflict edges.
 *
 * Layout:
 *   - X = position in block (later txs sit further right)
 *   - Y = wave number (deeper waves sit lower)
 *   - Only renders txs that participate in at least one conflict edge
 *     (clean txs are pruned from this view; they're already shown in Timeline)
 *
 * Edge styling:
 *   - solid line  → write-write conflict
 *   - dashed line → read-write conflict
 *   - thicker     → mixed (multiple shared slots, both kinds)
 *
 * Selection cross-talks with the rest of the panels via PEVContext.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import { usePEV } from "./PEVContext";
import { themeA } from "./theme";

interface Props {
  height?: number;
}

export default function ConflictGraph({ height = 280 }: Props) {
  const { data, selected, setSelected, hover, setHover, neighborsOf } = usePEV();
  const { txs, conflicts, summary } = data;

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Only nodes that participate in at least one conflict edge
  const conflictTxs = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conflicts) {
      ids.add(c.fromId);
      ids.add(c.toId);
    }
    return txs.filter((t) => ids.has(t.id));
  }, [txs, conflicts]);

  const padX = 32;
  const padY = 28;
  const nodeR = 11;
  const maxWave = Math.max(1, summary.waves - 1);
  const maxPos = Math.max(1, summary.txCount - 1);

  const nodePos = (tx: { position: number; wave: number }) => ({
    x: padX + (tx.position / maxPos) * (width - padX * 2),
    y: padY + (tx.wave / maxWave) * (height - padY * 2),
  });

  const related = selected ? neighborsOf(selected) : null;

  if (conflictTxs.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: themeA.graphBg,
          borderRadius: themeA.radius,
          border: `1px solid ${themeA.border}`,
          color: themeA.muted,
          fontFamily: themeA.mono,
          fontSize: 12,
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span style={{ color: themeA.status.clean, fontSize: 16 }}>● no conflicts</span>
        <span style={{ color: themeA.subtle }}>every tx in this block runs in parallel</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height,
        background: themeA.graphBg,
        borderRadius: themeA.radius,
        border: `1px solid ${themeA.border}`,
        overflow: "hidden",
      }}
    >
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          <marker id="pev-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={themeA.muted} />
          </marker>
          <marker
            id="pev-arrow-hot"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={themeA.accent} />
          </marker>
        </defs>

        {/* Edges */}
        {conflicts.map((c, i) => {
          const from = txs[c.fromIdx];
          const to = txs[c.toIdx];
          if (!from || !to) return null;
          const a = nodePos(from);
          const b = nodePos(to);
          const isActive = selected && (c.fromId === selected || c.toId === selected);
          const dim = !!selected && !isActive;
          // mid-control point — bow upward so edges don't overlap nodes
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2 - Math.max(14, Math.abs(b.x - a.x) * 0.08);

          const dash = c.kind === "read-write" ? "3 3" : undefined;
          const strokeWidth = isActive ? 1.8 : c.kind === "mixed" ? 1.4 : 1;

          return (
            <path
              key={i}
              d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
              fill="none"
              stroke={isActive ? themeA.accent : themeA.muted}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              opacity={dim ? 0.15 : 0.7}
              markerEnd={isActive ? "url(#pev-arrow-hot)" : "url(#pev-arrow)"}
            />
          );
        })}

        {/* Nodes */}
        {conflictTxs.map((tx) => {
          const { x, y } = nodePos(tx);
          const isSel = selected === tx.id;
          const isRel = related && related.has(tx.id);
          const isHov = hover === tx.id;
          const dim = !!selected && !isSel && !isRel;
          const fill =
            tx.status === "source"
              ? themeA.status.source
              : tx.status === "delayed"
                ? themeA.status.delayed
                : themeA.status.clean;

          return (
            <g
              key={tx.id}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(tx.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelected(isSel ? null : tx.id)}
              opacity={dim ? 0.3 : 1}
            >
              <circle
                cx={x}
                cy={y}
                r={isSel ? nodeR + 3 : isHov ? nodeR + 1 : nodeR}
                fill={fill}
                stroke={isSel ? themeA.accent : themeA.blockBorder}
                strokeWidth={isSel ? 2 : 1}
              />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontFamily={themeA.mono}
                fontSize={9}
                fill={themeA.onBlock}
                fontWeight={600}
              >
                {tx.position}
              </text>
              <text
                x={x}
                y={y + nodeR + 12}
                textAnchor="middle"
                fontFamily={themeA.mono}
                fontSize={9}
                fill={themeA.muted}
              >
                w{tx.wave}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          fontFamily: themeA.mono,
          fontSize: 9,
          color: themeA.subtle,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span>— write/write</span>
        <span>- - read/write</span>
      </div>

      {/* Axis hints */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 12,
          fontFamily: themeA.mono,
          fontSize: 9,
          color: themeA.subtle,
        }}
      >
        x = tx position · y = wave (depth)
      </div>
    </div>
  );
}
