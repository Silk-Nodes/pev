"use client";

/**
 * SummaryMetrics, the four-metric strip from variation-a's masthead.
 *
 * Honest data adaptations (decided in design review):
 *   - PARALLELISM (0/100)        ← derived from parallelism factor
 *   - BLOCKED %                  ← was "RE-EXECUTED %"; now means "% of stateful txs in wave > 0"
 *   - AVG CONFLICTS / TX         ← was "AVG RETRIES"; now means "avg outbound conflict count per tx"
 *   - LONGEST CHAIN              ← unchanged; equals execution depth (critical-path length)
 */

import { usePEV } from "./PEVContext";
import { themeA } from "./theme";

export default function SummaryMetrics() {
  const { data } = usePEV();
  const { summary } = data;

  const parallelismColor =
    summary.parallelismScore > 70
      ? themeA.status.clean
      : summary.parallelismScore > 40
        ? themeA.status.delayed
        : themeA.status.source;

  const items: Array<{ label: string; value: string; unit?: string; color: string }> = [
    {
      label: "Parallelism",
      value: String(summary.parallelismScore),
      unit: "/100",
      color: parallelismColor,
    },
    {
      label: "Blocked",
      value: String(summary.blockedPct),
      unit: "%",
      color: summary.blockedPct > 0 ? themeA.status.source : themeA.text,
    },
    {
      label: "Avg conflicts / tx",
      value: String(summary.avgConflictsPerTx),
      color: themeA.text,
    },
    {
      label: "Longest chain",
      value: String(summary.longestChain),
      unit: " deep",
      color: themeA.text,
    },
  ];

  return (
    <div className="pev-grid-stats-4" style={{ gap: 12 }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            borderLeft: `2px solid ${themeA.border}`,
            paddingLeft: 12,
            minWidth: 0,
          }}
        >
          <div className="pev-eyebrow">{it.label}</div>
          <div
            style={{
              fontSize: 22,
              fontFamily: themeA.mono,
              color: it.color,
              marginTop: 3,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {it.value}
            {it.unit && <span style={{ fontSize: 12, color: themeA.muted }}>{it.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
