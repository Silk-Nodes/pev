/**
 * og/variant.ts, deterministic dark/cream selection for OG cards.
 *
 * The same block always renders the same card, that's important because
 * Twitter/Discord/Slack cache OG images aggressively (often forever).
 * Using Math.random() would mean the same shared link could re-render
 * differently across cache invalidations, which feels broken.
 *
 * We hash the block number → 50/50 dark/cream. To a casual feed-scroller
 * it looks like a coin flip per card; to caches it's a stable function.
 *
 * Two-variant choice (dark + cream) is intentional: enough variety to
 * break the "everything looks the same" feed pattern, simple enough that
 * we don't have to design for N permutations.
 */

export type CardVariant = "dark" | "cream";

/**
 * Pick a card variant for a given numeric seed (typically a block number,
 * but works for any integer, contract pages can hash the address bytes).
 *
 * Uses xmur3-style hash to spread evenly even across consecutive block
 * numbers (modulo would cluster runs of dark/cream blocks together). Not
 * cryptographic, just better-distributed than `seed % 2`.
 */
export function pickVariant(seed: number): CardVariant {
  // Coerce to unsigned 32-bit, scramble bits, take low bit.
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h & 1) === 0 ? "dark" : "cream";
}

/**
 * Variant-specific color tokens. Mirrors the brand book palette but
 * resolved to literal hex strings (Satori doesn't honor CSS variables).
 *
 * Accent colors (ember/sage/amber/terracotta) are intentionally identical
 * across variants, that's the brand. Only background, text, muted, and
 * line tokens flip.
 */
export interface VariantColors {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  subtle: string;
  line: string;
  // Accents (identical across variants, brand palette per Brand Book Ch. 04)
  ember: string;
  sage: string;
  amber: string;
  terracotta: string;
  // Pre-computed cell fills for the mini wave timeline
  cellClean: string;
  cellDelayed: string;
  cellSource: string;
  cellEmpty: string;
}

export function colorsFor(variant: CardVariant): VariantColors {
  const accents = {
    ember: "#e28c52",
    sage: "#a8c487",
    amber: "#d4a94a",
    terracotta: "#c8553d",
  };
  const cells = {
    cellClean: "#a8c487",
    cellDelayed: "#d4a94a",
    cellSource: "#c8553d",
  };

  if (variant === "dark") {
    return {
      bg: "#0e0d0b",
      panel: "#141310",
      text: "#efe7d4",
      muted: "#8a8577",
      subtle: "#5c5749",
      line: "rgba(240, 230, 210, 0.12)",
      cellEmpty: "rgba(240, 230, 210, 0.06)",
      ...accents,
      ...cells,
    };
  }

  // cream variant
  return {
    bg: "#f6f0e1",
    panel: "#ebe4d1",
    text: "#1a1813",
    muted: "#605c52",
    subtle: "#8a8577",
    line: "rgba(26, 24, 19, 0.14)",
    cellEmpty: "rgba(26, 24, 19, 0.07)",
    ...accents,
    ...cells,
  };
}
