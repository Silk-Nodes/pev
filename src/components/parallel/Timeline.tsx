"use client";

/**
 * Timeline, gantt-style wave visualization, ported from variation-a's Timeline.
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

import { useEffect } from "react";
import { usePEV, type PEVMode } from "./PEVContext";
import { themeA } from "./theme";
import type { PEVTx } from "@/lib/probe-to-pev";

interface Props {
  height?: number;
  showLaneLabels?: boolean;
  laneLabelWidth?: number;
}

/**
 * Per-cell visual encoding for a given mode. The same Timeline structure
 * (waves × txs) is repainted three ways so the user can flip between
 * facets of the same data without losing position context.
 *
 *   execution , status-driven (clean / delayed / source-with-stripes).
 *                Default; matches the live-feed colour vocabulary.
 *   conflict  , conflict-count gradient. Clean txs (zero conflicts) are
 *                dimmed so the eye lands on the contended ones first.
 *                Stripes appear on any tx that BLOCKED others (the cause).
 *   heatmap   , storage-I/O weight (reads + writes). Cool→hot gradient.
 *                Useful for spotting "fat" txs that touch many slots.
 */
function fillFor(
  tx: PEVTx,
  mode: PEVMode,
  dim: boolean,
): { bg: string; striped: boolean } {
  if (dim) return { bg: themeA.dim, striped: false };

  if (mode === "conflict") {
    const total = tx.inboundConflicts + tx.outboundConflicts;
    if (total === 0) return { bg: themeA.dim, striped: false };
    if (total <= 2) return { bg: themeA.status.delayed, striped: false };
    // Heavy conflict involvement → red, with stripes if this tx CAUSED it
    return {
      bg: themeA.status.source,
      striped: tx.outboundConflicts > 0,
    };
  }

  if (mode === "heatmap") {
    const ops = tx.readCount + tx.writeCount;
    if (ops === 0) return { bg: themeA.dim, striped: false };
    if (ops < 5) return { bg: themeA.status.clean, striped: false };
    if (ops < 20) return { bg: themeA.status.delayed, striped: false };
    if (ops < 60) return { bg: themeA.accent, striped: false }; // ember
    return { bg: themeA.status.source, striped: false };
  }

  // execution (default)
  if (tx.status === "source") return { bg: themeA.status.source, striped: true };
  if (tx.status === "delayed") return { bg: themeA.status.delayed, striped: false };
  return { bg: themeA.status.clean, striped: false };
}

export default function Timeline({
  height = 320,
  showLaneLabels = true,
  laneLabelWidth = 96,
}: Props) {
  const { data, selected, setSelected, hover, setHover, mode, neighborsOf } =
    usePEV();
  const { waveTxs, summary } = data;

  const related = selected ? neighborsOf(selected) : null;

  const waveCount = waveTxs.length;
  // Lane height auto-fits within the requested height, with sane bounds
  const laneH = Math.max(36, Math.min(64, Math.floor((height - 40) / Math.max(1, waveCount))));

  // Esc-to-deselect, universal "get me out of focus mode" shortcut.
  // Only attaches a listener while something is selected so we don't pay
  // for it on every page render.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, setSelected]);

  return (
    <div style={{ width: "100%", userSelect: "none" }}>
      {/* Header: block stats + a visible "clear selection" pill that only
          shows up when a tx is focused. Three ways to deselect:
            1. Click this pill
            2. Press Escape
            3. Click empty space in a wave row */}
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
        {selected && (
          <button
            type="button"
            onClick={() => setSelected(null)}
            title="Clear selection (Esc)"
            style={{
              background: "transparent",
              border: `1px solid ${themeA.accent}`,
              color: themeA.accent,
              borderRadius: themeA.radius,
              padding: "2px 10px",
              fontSize: 10,
              fontFamily: themeA.mono,
              cursor: "pointer",
              letterSpacing: ".05em",
              textTransform: "uppercase",
            }}
          >
            ✕ clear · esc
          </button>
        )}
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

        {/* Track area: each row is a wave, txs span the row at equal width.
            Clicking the EMPTY space within a row (not on a tx button) clears
            the selection, third "deselect" affordance alongside Esc and the
            "✕ clear" pill in the header. */}
        <div
          style={{ flex: 1, position: "relative", minWidth: 0 }}
          onClick={(e) => {
            // Only deselect if the click landed on the row background, not
            // on a tx button (buttons have their own onClick that selects)
            if (selected && (e.target as HTMLElement).tagName !== "BUTTON") {
              setSelected(null);
            }
          }}
        >
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
                  cursor: selected ? "pointer" : "default",
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
                    // Mode-aware fill: changes the cell colour vocabulary
                    // every time the user flips the ModeToggle.
                    const { bg: color, striped } = fillFor(tx, mode, dim);
                    // Display label priority: decoded method name > selector hex > tx hash short
                    // Method names are humanized: "transfer(address,uint256)" → "transfer"
                    const methodShort = tx.method
                      ? tx.method.split("(")[0]
                      : tx.selector
                        ? tx.selector
                        : null;
                    return (
                      <button
                        key={tx.id}
                        type="button"
                        onMouseEnter={() => setHover(tx.id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => setSelected(isSelected ? null : tx.id)}
                        title={`tx #${tx.position} · ${tx.label}${tx.method ? `\nmethod ${tx.method}` : tx.selector ? `\nselector ${tx.selector}` : ""}${tx.contractName ? `\ncontract ${tx.contractName}` : ""}\nreads ${tx.readCount} writes ${tx.writeCount}\nblocks ${tx.outboundConflicts} · waits on ${tx.inboundConflicts}`}
                        style={{
                          flex: `1 1 ${cellWidth}`,
                          minWidth: 36,
                          height: laneH - 14,
                          background: striped
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
                          // Striped cells alternate dark stripes over a coloured base,
                          // so dark `onBlock` text disappears into the stripe bands.
                          // Switch to bone (themeA.text) with a soft dark shadow so
                          // text reads on both the coloured base and the stripe bands.
                          color: striped ? themeA.text : themeA.onBlock,
                          textShadow: striped ? "0 1px 1px rgba(0,0,0,0.55)" : "none",
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
                          {methodShort ? (
                            <span style={{ fontWeight: 600 }}>{methodShort}</span>
                          ) : (
                            <span>{tx.label}</span>
                          )}
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
      {tx.method ? (
        <span>
          <span style={{ color: themeA.subtle }}>fn</span>{" "}
          <span style={{ color: themeA.accent }}>{tx.method.split("(")[0]}</span>
        </span>
      ) : tx.selector ? (
        <span>
          <span style={{ color: themeA.subtle }}>sel</span> {tx.selector}
        </span>
      ) : null}
      {tx.contractName && (
        <span>
          <span style={{ color: themeA.subtle }}>on</span>{" "}
          <span style={{ fontFamily: themeA.serif, fontStyle: "italic" }}>
            {tx.contractName}
          </span>
        </span>
      )}
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
