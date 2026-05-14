"use client";

/**
 * ModeToggle, execution / conflict / heatmap segmented control.
 *
 * v1: only "execution" mode is fully implemented (the wave gantt). The other
 * two modes are stubbed for visual parity with variation-a, but currently
 * just toggle the highlight on the same Timeline view. Will route to
 * separate views in Phase 5.
 */

import { usePEV } from "./PEVContext";
import { themeA } from "./theme";
import type { PEVMode } from "./PEVContext";

const MODES: Array<[PEVMode, string]> = [
  ["execution", "Execution"],
  ["conflict", "Conflict"],
  ["heatmap", "Heatmap"],
];

export default function ModeToggle() {
  const { mode, setMode } = usePEV();

  return (
    <div
      style={{
        display: "inline-flex",
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        overflow: "hidden",
      }}
    >
      {MODES.map(([m, label]) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: "5px 14px",
              fontSize: 11,
              fontFamily: themeA.mono,
              background: active ? themeA.accent : "transparent",
              color: active ? themeA.onAccent : themeA.muted,
              border: "none",
              cursor: "pointer",
              transition: "background .15s, color .15s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
