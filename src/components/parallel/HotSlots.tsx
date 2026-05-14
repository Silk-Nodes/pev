"use client";

/**
 * HotSlots, contention ranking. Shows the top N storage slots that were
 * touched by multiple txs in this block, sorted by touch count.
 *
 * When a tx is selected, slots NOT touched by that tx fade to ~40% opacity,
 * letting you see at a glance which hotspots matter for the selection.
 */

import { usePEV } from "./PEVContext";
import { themeA } from "./theme";

interface Props {
  limit?: number;
}

function heatColor(intensity: number): string {
  if (intensity > 0.7) return themeA.status.source;
  if (intensity > 0.4) return themeA.status.delayed;
  if (intensity > 0.15) return "#d4a94a";
  return themeA.status.clean;
}

export default function HotSlots({ limit = 8 }: Props) {
  const { data, selected, txById, conflictsByTx } = usePEV();
  const { hotSlots } = data;

  // Slots touched by the selected tx, derived from its conflict edges
  const selectedSlotSet = new Set<string>();
  if (selected) {
    const tx = txById.get(selected);
    if (tx) {
      for (const c of conflictsByTx.get(selected) ?? []) {
        for (const s of c.sharedSlots) selectedSlotSet.add(s);
      }
    }
  }

  if (hotSlots.length === 0) {
    return (
      <div style={{ padding: "20px 0", color: themeA.muted, fontFamily: themeA.mono, fontSize: 12 }}>
        No hot slots, every storage slot in this block was touched by at most one tx.
      </div>
    );
  }

  const slots = hotSlots.slice(0, limit);

  return (
    <div>
      {slots.map((s, i) => {
        const key = `${s.contract}:${s.slot}`;
        const highlighted = selectedSlotSet.has(key);
        const dim = selected && !highlighted;
        const heat = heatColor(s.contention);

        return (
          <div
            key={key}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              padding: "11px 0",
              alignItems: "center",
              borderBottom: i < slots.length - 1 ? `1px solid ${themeA.border}` : "none",
              opacity: dim ? 0.4 : 1,
              transition: "opacity .15s",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: themeA.mono,
                  fontSize: 11,
                  color: themeA.text,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.label}
                </span>
                {highlighted && (
                  <span style={{ color: themeA.accent, fontSize: 9, flexShrink: 0 }}>● accessed</span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: themeA.muted,
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ fontFamily: themeA.mono }}>{s.contractLabel}</span>
              </div>
            </div>

            <div
              style={{
                textAlign: "right",
                fontFamily: themeA.mono,
                fontSize: 10,
                flexShrink: 0,
              }}
            >
              <div style={{ color: heat, fontWeight: 600, whiteSpace: "nowrap" }}>
                {s.touches} touch{s.touches === 1 ? "" : "es"}
              </div>
              <div style={{ color: themeA.subtle, marginTop: 2, whiteSpace: "nowrap" }}>
                {s.conflictsCaused} conflict{s.conflictsCaused === 1 ? "" : "s"}
              </div>
              <div
                style={{
                  width: 88,
                  height: 4,
                  background: themeA.border,
                  borderRadius: 2,
                  marginTop: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round(s.contention * 100)}%`,
                    height: "100%",
                    background: heat,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
