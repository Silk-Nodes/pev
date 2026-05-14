"use client";

/**
 * Timeline — gantt-style wave visualization, ported from variation-a's Timeline.
 *
 * Adaptations from the original (decided in design review):
 *   - "thread t0..t4" → "wave 0..N" (forced execution rounds, not physical threads)
 *   - X-axis is no longer ms time. Each wave row contains its txs side-by-side
 *     at equal widths within that row; widest rows = widest parallelism.
 *   - Diagonal stripe pattern repurposed: stripes mean "this tx blocked others"
 *     (outboundConflicts > 0), not "this tx was re-executed".
 *
 * Interaction:
 *   - hover a tx → highlight in ConflictGraph + show tooltip
 *   - click a tx → selects across all panels; click again to deselect
 *   - selecting dims unrelated txs to ~28% opacity
 */

import { usePEV } from "./PEVContext";
import { themeA } from "./theme";
import type { PEVTx } from "@/lib/probe-to-pev";

interface Props {
  height?: number;
  showLaneLabels?: boolean;
  laneLabelWidth?: number;
}

export default function Timeline({
  height = 320,
  showLaneLabels = true,
  laneLabelWidth = 96,
}: Props) {
  const { data, selected, setSelected, hover, setHover, neighborsOf } = usePEV();
  const { waveTxs, summary } = data;

  const related = selected ? neighborsOf(selected) : null;

  const waveCount = waveTxs.length;
  // Lane height auto-fits within the requested height, with sane bounds
  const laneH = Math.max(36, Math.min(64, Math.floor((height - 40) / Math.max(1, waveCount))));

  // Color for a tx based on status. Stripe pattern is applied via className.
  const fillFor = (tx: PEVTx, dim: boolean): string => {
    if (dim) return themeA.dim;
    if (tx.status === "source") return themeA.status.source;
    if (tx.status === "delayed") return themeA.status.delayed;
    return themeA.status.clean;
  };

  return (
    <div style={{ width: "100%", userSelect: "none" }}>
      {/* Header: block stats, no zoom controls (no ms timing to zoom) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          fontSize: 11,
          color: themeA.muted,
          fontFamily: themeA.mono,
        }}
      >
        <div style={{ flex: 1 }}>
          block <span style={{ color: themeA.text }}>#{summary.block.toLocaleString()}</span>
          {"  ·  "}
          {summary.txCount} txs across {summary.waves} wave{summary.waves === 1 ? "" : "s"}
          {"  ·  "}depth {summary.longestChain}
        </div>
        <div style={{ color: themeA.subtle }}>parallel ↔ serial</div>
      </div>

      <div style={{ display: "flex", gap: 0 }}>
        {/* Wave labels (left gutter) */}
        {showLaneLabels && (
          <div style={{ width: laneLabelWidth, flexShrink: 0 }}>
            {waveTxs.map((_, i) => (
              <div
                key={i}
                style={{
                  height: laneH,
                  display: "flex",
                  alignItems: "center",
                  fontFamily: themeA.mono,
                  fontSize: 10,
                  color: themeA.muted,
                  borderTop: i === 0 ? `1px solid ${themeA.border}` : `1px solid ${themeA.gridFaint}`,
                  paddingLeft: 8,
                }}
              >
                <span style={{ color: themeA.subtle }}>wave</span>&nbsp;
                <span style={{ color: themeA.text }}>w{i}</span>
              </div>
            ))}
          </div>
        )}

        {/* Track area: each row is a wave, txs span the row at equal width */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          {waveTxs.map((wave, wIdx) => {
            const cellWidth = wave.length > 0 ? `calc(${100 / wave.length}% - ${(wave.length - 1) * 2 / wave.length}px)` : "100%";
            return (
              <div
                key={wIdx}
                style={{
                  height: laneH,
                  borderTop: wIdx === 0 ? `1px solid ${themeA.border}` : `1px solid ${themeA.gridFaint}`,
                  background: wIdx % 2 === 0 ? "transparent" : themeA.laneAlt,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  padding: "4px 8px",
                  position: "relative",
                }}
              >
                {wave.length === 0 ? (
                  <span style={{ color: themeA.subtle, fontFamily: themeA.mono, fontSize: 10 }}>
                    (empty)
                  </span>
                ) : (
                  wave.map((tx) => {
                    const isSelected = selected === tx.id;
                    const isRelated = related && related.has(tx.id);
                    const dim = !!selected && !isSelected && !isRelated;
                    const isStriped = tx.status === "source";
                    const color = fillFor(tx, dim);
                    return (
                      <button
                        key={tx.id}
                        type="button"
                        onMouseEnter={() => setHover(tx.id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => setSelected(isSelected ? null : tx.id)}
                        title={`tx #${tx.position} · ${tx.label}\nreads ${tx.readCount} writes ${tx.writeCount}\nblocks ${tx.outboundConflicts} · waits on ${tx.inboundConflicts}`}
                        style={{
                          flex: `1 1 ${cellWidth}`,
                          minWidth: 36,
                          height: laneH - 14,
                          background: isStriped
                            ? `repeating-linear-gradient(135deg, ${color}, ${color} 4px, ${themeA.reexecStripe} 4px, ${themeA.reexecStripe} 8px)`
                            : color,
                          border: isSelected
                            ? `1.5px solid ${themeA.accent}`
                            : `1px solid ${themeA.blockBorder}`,
                          borderRadius: themeA.radius,
                          boxShadow: isSelected
                            ? `0 0 0 3px ${themeA.accent}22, 0 6px 18px ${themeA.accent}33`
                            : "none",
                          opacity: dim ? 0.28 : 1,
                          cursor: "pointer",
                          padding: "0 8px",
                          color: themeA.onBlock,
                          fontFamily: themeA.mono,
                          fontSize: 10,
                          fontWeight: 500,
                          textAlign: "left",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          transition: "opacity .15s, box-shadow .15s",
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ opacity: 0.6 }}>#{tx.position}</span>
                          <span>{tx.label}</span>
                          {tx.outboundConflicts > 0 && (
                            <span style={{ opacity: 0.85 }}>· blocks {tx.outboundConflicts}</span>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hover tooltip (fixed at the bottom, like the original) */}
      {hover && <TxTooltip txId={hover} />}
    </div>
  );
}

function TxTooltip({ txId }: { txId: string }) {
  const { txById } = usePEV();
  const tx = txById.get(txId);
  if (!tx) return null;
  const statusLabel =
    tx.status === "source"
      ? `● blocks ${tx.outboundConflicts} later tx${tx.outboundConflicts === 1 ? "" : "s"}`
      : tx.status === "delayed"
        ? `● delayed (wave ${tx.wave})`
        : "● parallel · no conflicts";
  const statusColor =
    tx.status === "source"
      ? themeA.status.source
      : tx.status === "delayed"
        ? themeA.status.delayed
        : themeA.status.clean;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: themeA.tooltipBg,
        border: `1px solid ${themeA.border}`,
        borderRadius: 6,
        padding: "8px 14px",
        display: "flex",
        gap: 18,
        fontFamily: themeA.mono,
        fontSize: 11,
        color: themeA.text,
        pointerEvents: "none",
        zIndex: 100,
        boxShadow: "0 8px 30px rgba(0,0,0,.4)",
      }}
    >
      <span>
        <span style={{ color: themeA.subtle }}>tx</span> {tx.label}
      </span>
      <span>
        <span style={{ color: themeA.subtle }}>r/w</span> {tx.readCount}/{tx.writeCount}
      </span>
      <span>
        <span style={{ color: themeA.subtle }}>wave</span> {tx.wave}
      </span>
      <span style={{ color: statusColor }}>{statusLabel}</span>
    </div>
  );
}
