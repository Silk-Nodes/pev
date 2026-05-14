/**
 * pev theme — token set per the PEV Brand Book v1.0 (Chapter 04 · Color).
 *
 * Mirrors values defined in parallel.css as CSS variables — duplicated here
 * as TypeScript constants for inline-style usage in components that need
 * computed colors (SVG fills, conditional backgrounds, gradient stops).
 *
 * Brand-named tokens (Ink, Cream, Bone, Ember, Sage, Amber, Terracotta,
 * Stone) are exposed alongside the legacy alias names used internally by
 * the components ported from variation-a.jsx.
 */

// ─── Brand Book primary palette ────────────────────────────────
export const palette = {
  ink: "#0e0d0b",
  cream: "#f6f0e1",
  bone: "#efe7d4",
  ember: "#e28c52",
  stone: "#8a8577",
  // Status palette
  sage: "#a8c487",
  amber: "#d4a94a",
  terracotta: "#c8553d",
  // Surface scale (deepest → highest)
  surface00: "#0a0907",
  surface01: "#0e0d0b",
  surface02: "#141310",
  surface03: "#1a1813",
  surface04: "#211e17",
  surface05: "#2a261d",
} as const;

export const themeA = {
  bg: "#0e0d0b",
  panel: "#141310",
  cardBg: "#17150f",
  altBg: "#1b1812",
  hintBg: "rgba(226,140,82,0.08)",
  border: "rgba(240,230,210,0.09)",
  gridFaint: "rgba(240,230,210,0.04)",
  laneAlt: "rgba(240,230,210,0.02)",
  text: "#efe7d4",
  muted: "#8a8577",
  subtle: "#5c5749",
  dim: "#2a2822",
  accent: "#e28c52",
  onAccent: "#1a0f08",
  btnBg: "rgba(240,230,210,0.04)",
  tooltipBg: "#1a1814",
  onBlock: "#0a0908",
  blockBorder: "rgba(0,0,0,0.35)",
  graphBg: "#111009",
  radius: 3,
  reexecStripe: "rgba(10,8,6,0.55)",
  status: {
    /** wave 0 + no inbound conflicts — fully parallel-safe */
    clean: "#a8c487",
    /** wave > 0 — forced to wait for an earlier conflicting tx */
    delayed: "#d4a94a",
    /** has outbound conflicts — this tx blocked others */
    source: "#c8553d",
  },
  mono: 'var(--font-pev-mono), "JetBrains Mono", ui-monospace, monospace',
  sans: 'var(--font-pev-sans), "Inter Tight", -apple-system, system-ui, sans-serif',
  serif: 'var(--font-pev-serif), "Instrument Serif", Georgia, serif',
} as const;

export type Theme = typeof themeA;
