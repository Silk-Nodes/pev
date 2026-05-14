/**
 * PEVBrand, the brand mark and wordmark, ported from the PEV Brand Book
 * (public/parallel-preview/brand-book.html, chapters 02-03).
 *
 * The mark is four stacked colored bars of unequal length, an abstraction
 * of the execution timeline itself:
 *   - Sage     #a8c487  →  clean parallel execution
 *   - Amber    #d4a94a  →  delayed (rescheduled)
 *   - Ember    #e28c52  →  the warm accent (also: outbound conflicts)
 *   - Terracotta #c8553d → conflict / contention
 *
 * The wordmark pairs Instrument Serif (italic optional) with an ember "."
 *, the period reads as "the halt; the stop-moment a developer wants to
 * understand" (per the brand book).
 *
 * These are pure SVG/CSS, no client-side state, safe to render server-side.
 */

import { themeA } from "./theme";

export interface PEVMarkProps {
  size?: number;
  /** for use over a light surface, no effect on the bar colors themselves */
  className?: string;
}

/**
 * The 4-bar logo mark. Pure SVG, no background, drop it on any surface.
 * Aspect ratio is fixed at 1:1 (32×32 viewBox).
 */
export function PEVMark({ size = 28, className }: PEVMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="pev"
      role="img"
    >
      <rect x="3" y="6" width="26" height="3" fill="#a8c487" />
      <rect x="3" y="12" width="15" height="3" fill="#d4a94a" />
      <rect x="3" y="18" width="22" height="3" fill="#e28c52" />
      <rect x="3" y="24" width="10" height="3" fill="#c8553d" />
    </svg>
  );
}

/**
 * App-icon variant: same bars, dark squircle background (for OS docks,
 * favicons, OG cards). Default 256×256 viewBox per the brand book.
 */
export function PEVAppIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-label="pev" role="img">
      <rect width="256" height="256" rx="56" fill={themeA.bg} />
      <g transform="translate(36, 60)">
        <rect x="0" y="0" width="184" height="20" rx="2" fill="#a8c487" />
        <rect x="0" y="36" width="108" height="20" rx="2" fill="#d4a94a" />
        <rect x="0" y="72" width="156" height="20" rx="2" fill="#e28c52" />
        <rect x="0" y="108" width="72" height="20" rx="2" fill="#c8553d" />
      </g>
    </svg>
  );
}

export interface PEVWordmarkProps {
  /** font-size in px (drives the visual size, period is colored in the same size) */
  size?: number;
  /** color for the "pev" text. Period is always ember. */
  color?: string;
  /** if true, "e" is italic (per Variation E in the brand book) */
  italicE?: boolean;
}

/**
 * Wordmark: serif "pev" with an ember period.
 * The period is the brand's "halt moment", color is always ember regardless
 * of the surrounding text color.
 */
export function PEVWordmark({
  size = 24,
  color,
  italicE = false,
}: PEVWordmarkProps) {
  const textColor = color ?? themeA.text;
  return (
    <span
      style={{
        fontFamily: themeA.serif,
        fontWeight: 400,
        fontSize: size,
        letterSpacing: "-0.03em",
        lineHeight: 0.9,
        color: textColor,
        whiteSpace: "nowrap",
      }}
    >
      p{italicE ? <em style={{ fontStyle: "italic" }}>e</em> : "e"}v
      <span style={{ color: themeA.accent }}>.</span>
    </span>
  );
}

/**
 * Compact lockup: mark + wordmark side-by-side.
 * Used in the masthead, hero header, OG card, and app-icon contexts.
 */
export function PEVLockup({
  markSize = 22,
  wordSize = 22,
  color,
  gap = 10,
}: {
  markSize?: number;
  wordSize?: number;
  color?: string;
  gap?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap }}>
      <PEVMark size={markSize} />
      <PEVWordmark size={wordSize} color={color} />
    </span>
  );
}
