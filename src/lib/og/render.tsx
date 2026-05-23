/**
 * og/render.tsx, JSX template for the per-block OG card.
 *
 * Matches the brand-book mockups (dark + cream variants):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  ▤ pev.                              MONAD MAINNET      │
 *   │  ─────────────────────────────────────────────  EXPLORER│
 *   │                                                          │
 *   │  BLOCK · APR 26, 2026 · 6 TX                            │
 *   │                                          EXECUTION       │
 *   │  Block #70,602,163                       TIMELINE        │
 *   │  Throughput-killer: 0xabcd…1234          [▓▓▓▓▓]        │
 *   │                                          [▓▓▓░░░]       │
 *   │  ──────────────────────────────────────                  │
 *   │                                                          │
 *   │  67/100         9              2                         │
 *   │  parallelism    conflicts      waves                     │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Renders at 1200×630 (the universal social-card aspect). Satori subset:
 * inline styles only, no className, limited flexbox (no `gap` shorthand
 * with a single value reliably; we use margins instead where needed).
 */

import { colorsFor, type CardVariant } from "./variant";
import type { PEVStatus } from "@/lib/probe-to-pev";

export interface BlockCardData {
  block: number;
  txCount: number;
  /** Unix seconds */
  timestamp: number;
  parallelismScore: number;
  conflictCount: number;
  executionDepth: number;
  /** When set: "Throughput-killer" / "Bottleneck" verdict. When null: clean. */
  bottleneck: {
    /** Human label if Sourcify-named, else short hex */
    label: string;
    /** "throughput-killer" if conflicts >= 3, else "bottleneck" */
    severity: "throughput-killer" | "bottleneck";
  } | null;
  /** Per-wave tx statuses for the mini timeline (max 6 waves × 8 cells shown) */
  waves: Array<Array<PEVStatus>>;
  /**
   * Editorial footer band, URL on the left, attribution on the right.
   * Without it the card reads as a screenshot; with it, it reads as a
   * shareable poster. Travels with the image even if someone re-posts it
   * out of context (you can't unfurl a PNG, but the URL is right there).
   */
  footer: {
    /** Display hostname, e.g. "pev.silknodes.io", sans protocol */
    host: string;
    /** Display path, e.g. "/block/70602163", leading slash included */
    path: string;
  };
}

export function renderBlockCard(
  data: BlockCardData,
  variant: CardVariant,
): React.ReactElement {
  const c = colorsFor(variant);
  const dateLabel = new Date(data.timestamp * 1000)
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "Inter Tight",
        padding: "56px 72px",
        position: "relative",
      }}
    >
      {/* Note: we used to apply a radial-gradient backgroundImage here for
          a subtle warm glow, but Satori's gradient parser is fragile and
          chokes on rgba alpha syntax. The flat background looks fine,
          dropped the glow rather than fight the renderer. */}
      {/* ─── Top bar: lockup + network attribution ─────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Lockup colors={c} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontFamily: "JetBrains Mono",
            fontSize: 13,
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          <span>MONAD MAINNET</span>
          <span style={{ marginTop: 2 }}>EXPLORER</span>
        </div>
      </div>

      {/* Hairline under the masthead */}
      <div
        style={{
          width: "100%",
          height: 1,
          background: c.line,
          marginTop: 32,
        }}
      />

      {/* ─── Body: title + verdict on the left, mini timeline on the right ─── */}
      <div
        style={{
          display: "flex",
          flex: 1,
          marginTop: 36,
          width: "100%",
          alignItems: "flex-start",
        }}
      >
        {/* Left column: eyebrow → title → verdict */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
          }}
        >
          {/* JSX expressions split a div into multiple children, which
              Satori then refuses to lay out without display:flex. We use
              a single template literal as the only child to avoid that. */}
          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 14,
              color: c.subtle,
              letterSpacing: "0.18em",
            }}
          >
            {`BLOCK · ${dateLabel} · ${data.txCount} TX`}
          </div>

          {/* The headline. "Block" in plain text + the # in ember = visual
              focal point. Each span gets a single string child via template
              literal so Satori doesn't complain about mixed expressions. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              marginTop: 18,
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              fontSize: 96,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: c.text,
            }}
          >
            <span>{"Block "}</span>
            <span style={{ color: c.ember }}>
              {`#${data.block.toLocaleString()}`}
            </span>
          </div>

          {/* Verdict line, the editorial hook */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              marginTop: 24,
              fontSize: 30,
            }}
          >
            <Verdict colors={c} bottleneck={data.bottleneck} />
          </div>
        </div>

        {/* Right column: EXECUTION TIMELINE label + mini wave grid */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            marginLeft: 48,
            // The arrow in the mockup pointed down at a vertical timeline.
            // We render the timeline horizontally below the label so the
            // arrow direction matches.
          }}
        >
          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 13,
              color: c.subtle,
              letterSpacing: "0.18em",
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
            }}
          >
            EXECUTION TIMELINE&nbsp;↓
          </div>
          <MiniTimeline waves={data.waves} colors={c} />
        </div>
      </div>

      {/* Hairline above the stats */}
      <div
        style={{
          width: "100%",
          height: 1,
          background: c.line,
          marginTop: 28,
          marginBottom: 28,
        }}
      />

      {/* ─── Three-stat strip ────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          width: "100%",
          alignItems: "flex-end",
        }}
      >
        <Stat
          colors={c}
          number={`${data.parallelismScore}`}
          suffix="/100"
          label="PARALLELISM SCORE"
        />
        <Stat
          colors={c}
          number={`${data.conflictCount}`}
          label="CONFLICTS DETECTED"
          highlight={data.conflictCount > 0 ? c.terracotta : undefined}
        />
        <Stat
          colors={c}
          number={`${data.executionDepth}`}
          suffix=" waves"
          label="EXECUTION DEPTH"
          last
        />
      </div>

      <FooterBand colors={c} host={data.footer.host} path={data.footer.path} />
    </div>
  );
}

/**
 * FooterBand, the editorial footer that signs every OG card. Consistent
 * across all card types so a feed of pev shares feels like one product.
 *   left:  pev.silknodes.io/<path>      (so the URL travels with the image)
 *   right: BY SILK NODES                (brand attribution)
 */
function FooterBand({
  colors,
  host,
  path,
}: {
  colors: ReturnType<typeof colorsFor>;
  host: string;
  path: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 32,
        fontFamily: "JetBrains Mono",
        fontSize: 14,
        color: colors.subtle,
        letterSpacing: "0.16em",
      }}
    >
      <span>{`${host}${path}`}</span>
      <span>BY SILK NODES</span>
    </div>
  );
}

/** The 4-bar mark + "pev." wordmark, brand-book accurate. */
function Lockup({ colors }: { colors: ReturnType<typeof colorsFor> }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {/* The 4-bar mark, scaled up from the brand-book SVG. Each bar is
          a separate div with explicit margin (Satori's flex `gap` support
          is unreliable, so we use marginTop for the inter-bar spacing). */}
      <div
        style={{
          width: 48,
          height: 48,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          marginRight: 18,
        }}
      >
        <div style={{ width: 44, height: 5, background: colors.sage }} />
        <div
          style={{ width: 26, height: 5, background: colors.amber, marginTop: 4 }}
        />
        <div
          style={{ width: 36, height: 5, background: colors.ember, marginTop: 4 }}
        />
        <div
          style={{
            width: 16,
            height: 5,
            background: colors.terracotta,
            marginTop: 4,
          }}
        />
      </div>
      {/* The wordmark, "pev" + ember italic period */}
      <div
        style={{
          fontFamily: "Instrument Serif",
          fontStyle: "italic",
          fontSize: 56,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          display: "flex",
          alignItems: "baseline",
        }}
      >
        <span style={{ color: colors.text }}>pev</span>
        <span style={{ color: colors.ember }}>.</span>
      </div>
    </div>
  );
}

/** The verdict line, three states matching the landing-page <Verdict /> component. */
function Verdict({
  colors,
  bottleneck,
}: {
  colors: ReturnType<typeof colorsFor>;
  bottleneck: BlockCardData["bottleneck"];
}) {
  if (!bottleneck) {
    return (
      <div
        style={{
          fontFamily: "Instrument Serif",
          fontStyle: "italic",
          color: colors.sage,
          display: "flex",
        }}
      >
        Clean. Every transaction ran independently
      </div>
    );
  }

  const verbColor =
    bottleneck.severity === "throughput-killer"
      ? colors.terracotta
      : colors.amber;
  const verb =
    bottleneck.severity === "throughput-killer"
      ? "Throughput-killer:"
      : "Bottleneck:";

  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      <span
        style={{
          fontFamily: "Instrument Serif",
          fontStyle: "italic",
          color: verbColor,
        }}
      >
        {`${verb} `}
      </span>
      <span
        style={{
          fontFamily: "JetBrains Mono",
          fontSize: 26,
          color: colors.terracotta,
        }}
      >
        {bottleneck.label}
      </span>
    </div>
  );
}

/**
 * Mini wave timeline, a stylized version of the page's Timeline component.
 * Renders up to 6 waves × 8 cells (downsamples gracefully for big blocks).
 *
 * Each wave is a row; each cell is a tx. Colors mirror the page:
 *   sage    → ran clean
 *   amber   → delayed (rescheduled into a later wave)
 *   striped → conflict source (re-executed)
 *   muted   → "no slot", placeholder when the wave is shorter than max
 *
 * The mockups show ~4 rows of 6-8 cells. We aim for similar density.
 */
function MiniTimeline({
  waves,
  colors,
}: {
  waves: Array<Array<PEVStatus>>;
  colors: ReturnType<typeof colorsFor>;
}) {
  const MAX_WAVES = 5;
  const MAX_CELLS = 8;
  const CELL_W = 38;
  const CELL_H = 14;
  const GAP = 4;

  const trimmedWaves = waves.slice(0, MAX_WAVES);
  // Find max cells per wave to know our actual horizontal span
  const maxCells = Math.min(
    MAX_CELLS,
    trimmedWaves.reduce((m, w) => Math.max(m, w.length), 0),
  );

  const colorFor = (s: PEVStatus): string => {
    if (s === "clean") return colors.cellClean;
    if (s === "delayed") return colors.cellDelayed;
    if (s === "source") return colors.cellSource;
    return colors.cellEmpty;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {trimmedWaves.map((wave, wi) => {
        // Sample cells if wave is bigger than MAX_CELLS, pick evenly-spaced
        // so the visualization stays representative for huge blocks.
        let cells: PEVStatus[];
        if (wave.length <= MAX_CELLS) {
          cells = wave;
        } else {
          const step = wave.length / MAX_CELLS;
          cells = Array.from(
            { length: MAX_CELLS },
            (_, i) => wave[Math.floor(i * step)],
          );
        }
        return (
          <div
            key={wi}
            style={{
              display: "flex",
              marginTop: wi === 0 ? 0 : GAP,
            }}
          >
            {Array.from({ length: maxCells }).map((_, ci) => {
              const status = cells[ci];
              const isStriped = status === "source";
              const fill =
                status === undefined ? colors.cellEmpty : colorFor(status);
              return (
                <div
                  key={ci}
                  style={{
                    width: CELL_W,
                    height: CELL_H,
                    background: fill,
                    borderRadius: 2,
                    marginLeft: ci === 0 ? 0 : GAP,
                    // Note: striped overlay (repeating-linear-gradient) was
                    // here, but Satori's gradient parser is fragile, solid
                    // terracotta reads as "conflict" cleanly enough at this
                    // scale (each cell is only 38×14 px in the card).
                    opacity: isStriped ? 0.85 : 1,
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** A single stat in the bottom three-stat strip. */
function Stat({
  colors,
  number,
  suffix,
  label,
  last,
  highlight,
}: {
  colors: ReturnType<typeof colorsFor>;
  number: string;
  suffix?: string;
  label: string;
  last?: boolean;
  highlight?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        marginRight: last ? 0 : 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          fontFamily: "Instrument Serif",
          fontStyle: "italic",
          fontSize: 80,
          lineHeight: 1,
          color: highlight ?? colors.text,
        }}
      >
        <span>{number}</span>
        {suffix && (
          <span
            style={{
              fontSize: 22,
              marginLeft: 4,
              color: colors.muted,
              fontStyle: "normal",
              fontFamily: "JetBrains Mono",
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono",
          fontSize: 13,
          color: colors.muted,
          letterSpacing: "0.18em",
          marginTop: 12,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   LANDING CARD, the unfurl when someone shares pev.silknodes.io
   ════════════════════════════════════════════════════════════════ */

export interface LandingCardData {
  /** Total blocks indexed in the analytics window (for the headline number) */
  totalBlocks: number;
  /** Average parallelism score over that window, 0-100 */
  avgScore: number;
  /** Total conflict pairs detected over the window */
  totalConflicts: number;
  /** Live chain head (or last known indexer cursor) for the "live" feel */
  chainHead: number;
  footer: { host: string; path: string };
}

export function renderLandingCard(
  data: LandingCardData,
  variant: CardVariant,
): React.ReactElement {
  const c = colorsFor(variant);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "Inter Tight",
        padding: "56px 72px",
        position: "relative",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Lockup colors={c} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontFamily: "JetBrains Mono",
            fontSize: 13,
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          <span>MONAD MAINNET</span>
          <span style={{ marginTop: 2 }}>EXPLORER</span>
        </div>
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 32 }}
      />

      {/* Hero copy, the H1 of pev (matches the actual page) */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          marginTop: 12,
        }}
      >
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            color: c.subtle,
            letterSpacing: "0.18em",
            marginBottom: 18,
          }}
        >
          PARALLEL EXECUTION VISUALIZER
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Instrument Serif",
            fontStyle: "italic",
            fontSize: 88,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: c.text,
          }}
        >
          <span>{"Is your contract"}</span>
          {/* Use a non-breaking space + a tiny marginLeft so Satori
              renders a real visible gap between the colored "killing"
              and the rest of the line (a regular leading space gets
              collapsed by the inline-flex layout). */}
          <span style={{ marginTop: 8, display: "flex", alignItems: "baseline" }}>
            <span style={{ color: c.terracotta }}>killing</span>
            <span style={{ marginLeft: "0.3em" }}>{"parallelism?"}</span>
          </span>
        </div>
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 28 }}
      />

      {/* Live stat strip, three numbers from the analytics cache */}
      <div
        style={{
          display: "flex",
          width: "100%",
          alignItems: "flex-end",
          marginTop: 24,
        }}
      >
        <Stat
          colors={c}
          number={`${data.avgScore}`}
          suffix="/100"
          label="CHAIN AVG · 7 DAYS"
        />
        <Stat
          colors={c}
          number={data.totalBlocks.toLocaleString()}
          label="BLOCKS ANALYZED"
        />
        <Stat
          colors={c}
          number={data.totalConflicts.toLocaleString()}
          label="CONFLICTS DETECTED"
          highlight={c.terracotta}
          last
        />
      </div>

      <FooterBand colors={c} host={data.footer.host} path={data.footer.path} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CONTRACT CARD, unfurl for /contract/[address]
   ════════════════════════════════════════════════════════════════ */

export interface ContractCardData {
  address: string;
  /** Sourcify-resolved name when available; null shows short hex */
  name: string | null;
  avgParallelismScore: number;
  blocksAppeared: number;
  txsTouched: number;
  conflictsCaused: number;
  /** Top hot slot for this contract (one-line bottleneck callout) */
  topSlot: { slot: string; conflicts: number } | null;
  footer: { host: string; path: string };
}

export function renderContractCard(
  data: ContractCardData,
  variant: CardVariant,
): React.ReactElement {
  const c = colorsFor(variant);
  const headlineColor =
    data.avgParallelismScore >= 70
      ? c.cellClean
      : data.avgParallelismScore >= 40
        ? c.cellDelayed
        : c.cellSource;

  // Score-based verdict copy. Mirrors the page's Verdict component vocabulary.
  let verdict: string;
  let verdictColor: string;
  if (data.conflictsCaused === 0) {
    verdict = "Clean. No outbound conflicts in window.";
    verdictColor = c.cellClean;
  } else if (data.avgParallelismScore < 40) {
    verdict = "Throughput-killer.";
    verdictColor = c.terracotta;
  } else if (data.avgParallelismScore < 70) {
    verdict = "Bottleneck.";
    verdictColor = c.amber;
  } else {
    verdict = "Mostly clean.";
    verdictColor = c.cellClean;
  }

  // Display name: Sourcify human label if known; else short hex.
  const labelDisplay = data.name ?? shortHexLocal(data.address, 8, 6);
  const labelIsName = data.name !== null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "Inter Tight",
        padding: "56px 72px",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Lockup colors={c} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontFamily: "JetBrains Mono",
            fontSize: 13,
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          <span>CONTRACT PROFILE</span>
          <span style={{ marginTop: 2 }}>MONAD MAINNET</span>
        </div>
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 32 }}
      />

      {/* Body */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          marginTop: 28,
        }}
      >
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          {`CONTRACT · ${shortHexLocal(data.address, 6, 4).toUpperCase()}`}
        </div>

        <div
          style={{
            marginTop: 14,
            fontFamily: labelIsName ? "Instrument Serif" : "JetBrains Mono",
            fontStyle: labelIsName ? "italic" : "normal",
            fontSize: labelIsName ? 64 : 44,
            lineHeight: 1,
            letterSpacing: labelIsName ? "-0.02em" : "0",
            color: c.text,
            // Truncate gracefully if hex is huge (shortHex caps it but
            // belt-and-suspenders for very long Sourcify names too)
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "flex",
          }}
        >
          {labelDisplay}
        </div>

        {/* Verdict line */}
        <div
          style={{
            marginTop: 22,
            display: "flex",
            alignItems: "baseline",
            fontFamily: "Instrument Serif",
            fontStyle: "italic",
            fontSize: 32,
            color: verdictColor,
          }}
        >
          {verdict}
        </div>

        {/* Top slot callout (small mono line under the verdict) */}
        {data.topSlot && (
          <div
            style={{
              marginTop: 14,
              fontFamily: "JetBrains Mono",
              fontSize: 16,
              color: c.muted,
              display: "flex",
            }}
          >
            {`top slot ${shortHexLocal(data.topSlot.slot, 10, 6)} · ${data.topSlot.conflicts.toLocaleString()} conflicts`}
          </div>
        )}
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 24 }}
      />

      {/* Stat strip */}
      <div
        style={{
          display: "flex",
          width: "100%",
          alignItems: "flex-end",
          marginTop: 24,
        }}
      >
        <Stat
          colors={c}
          number={`${data.avgParallelismScore}`}
          suffix="/100"
          label="AVG PARALLELISM"
          highlight={headlineColor}
        />
        <Stat
          colors={c}
          number={data.blocksAppeared.toLocaleString()}
          label="BLOCKS APPEARED"
        />
        <Stat
          colors={c}
          number={data.conflictsCaused.toLocaleString()}
          label="CONFLICTS CAUSED"
          highlight={data.conflictsCaused > 0 ? c.terracotta : undefined}
          last
        />
      </div>

      <FooterBand colors={c} host={data.footer.host} path={data.footer.path} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   ANALYTICS CARD, unfurl for /analytics
   ════════════════════════════════════════════════════════════════ */

export interface AnalyticsCardData {
  /** Window-wide stats (matches the page's stat strip) */
  totalBlocks: number;
  totalTransactions: number;
  totalConflicts: number;
  avgScore: number;
  /** The #1 killer contract over the window (resolved label or hex) */
  topKiller: { label: string; conflicts: number } | null;
  footer: { host: string; path: string };
}

export function renderAnalyticsCard(
  data: AnalyticsCardData,
  variant: CardVariant,
): React.ReactElement {
  const c = colorsFor(variant);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "Inter Tight",
        padding: "56px 72px",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Lockup colors={c} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontFamily: "JetBrains Mono",
            fontSize: 13,
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          <span>CHAIN ANALYTICS</span>
          <span style={{ marginTop: 2 }}>LAST 7 DAYS</span>
        </div>
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 32 }}
      />

      {/* Headline */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          marginTop: 12,
        }}
      >
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            color: c.subtle,
            letterSpacing: "0.18em",
            marginBottom: 18,
          }}
        >
          {`HOW MONAD PARALLELIZES · ${data.totalBlocks.toLocaleString()} BLOCKS`}
        </div>
        <div
          style={{
            fontFamily: "Instrument Serif",
            fontStyle: "italic",
            fontSize: 88,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: c.text,
            display: "flex",
          }}
        >
          {"How Monad parallelizes."}
        </div>

        {/* Top killer callout (the leaderboard's #1 row, abbreviated) */}
        {data.topKiller && (
          <div
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "baseline",
              fontSize: 28,
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              color: c.terracotta,
            }}
          >
            {`#1 killer: ${data.topKiller.label} · ${data.topKiller.conflicts.toLocaleString()} conflicts`}
          </div>
        )}
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 28 }}
      />

      {/* Stat strip */}
      <div
        style={{
          display: "flex",
          width: "100%",
          alignItems: "flex-end",
          marginTop: 24,
        }}
      >
        <Stat
          colors={c}
          number={`${data.avgScore}`}
          suffix="/100"
          label="AVG PARALLELISM"
          highlight={
            data.avgScore >= 70
              ? c.cellClean
              : data.avgScore >= 40
                ? c.cellDelayed
                : c.cellSource
          }
        />
        <Stat
          colors={c}
          number={data.totalTransactions.toLocaleString()}
          label="TRANSACTIONS"
        />
        <Stat
          colors={c}
          number={data.totalConflicts.toLocaleString()}
          label="CONFLICTS"
          highlight={c.terracotta}
          last
        />
      </div>

      <FooterBand colors={c} host={data.footer.host} path={data.footer.path} />
    </div>
  );
}

/* Small helper, kept private so we don't drag in the whole probe-to-pev
   module just to format an address. Same logic as shortHex from there. */
function shortHexLocal(h: string, headChars = 6, tailChars = 4): string {
  if (h.length <= 2 + headChars + tailChars) return h;
  return h.slice(0, 2 + headChars) + "…" + h.slice(-tailChars);
}

/* ════════════════════════════════════════════════════════════════
   DOCS CARD, unfurl for /docs
   ════════════════════════════════════════════════════════════════ */

/**
 * Docs card data. No live metrics; the card is editorial reference
 * content. We surface the seven section labels along the bottom as
 * a contents strip so the unfurl actually previews what's on the
 * page (instead of being a generic title card).
 */
export interface DocsCardData {
  footer: { host: string; path: string };
}

export function renderDocsCard(
  data: DocsCardData,
  variant: CardVariant,
): React.ReactElement {
  const c = colorsFor(variant);
  // The seven section labels, kept in the same order as the page TOC.
  // Shorter forms so they fit on one line at the card's font size.
  const sections = [
    "What pev is",
    "Parallel execution",
    "Metrics glossary",
    "How to use pev",
    "Data coverage",
    "API reference",
    "About",
  ];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "Inter Tight",
        padding: "56px 72px",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Lockup colors={c} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontFamily: "JetBrains Mono",
            fontSize: 13,
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          <span>THE MANUAL</span>
          <span style={{ marginTop: 2 }}>DOCUMENTATION · 07 SECTIONS</span>
        </div>
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 32 }}
      />

      {/* Headline */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          marginTop: 12,
        }}
      >
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            color: c.subtle,
            letterSpacing: "0.18em",
            marginBottom: 18,
          }}
        >
          {"DOCUMENTATION"}
        </div>
        <div
          style={{
            fontFamily: "Instrument Serif",
            fontStyle: "italic",
            fontSize: 96,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: c.text,
            display: "flex",
          }}
        >
          {"The manual."}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 24,
            color: c.subtle,
            fontFamily: "Instrument Serif",
            fontStyle: "italic",
            lineHeight: 1.3,
            maxWidth: 820,
            display: "flex",
          }}
        >
          {
            "Metrics, methodology, API reference, and what the data does and doesn't cover."
          }
        </div>
      </div>

      <div
        style={{ width: "100%", height: 1, background: c.line, marginTop: 28 }}
      />

      {/* Sections strip, the page TOC at a glance */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginTop: 18,
          flexWrap: "wrap",
        }}
      >
        {sections.map((label, i) => (
          <span
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: "JetBrains Mono",
              fontSize: 13,
              color: c.subtle,
              letterSpacing: "0.08em",
            }}
          >
            <span>
              <span style={{ color: c.text }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ marginLeft: 8 }}>{label.toUpperCase()}</span>
            </span>
            {i < sections.length - 1 && (
              <span style={{ color: c.subtle }}>·</span>
            )}
          </span>
        ))}
      </div>

      <FooterBand colors={c} host={data.footer.host} path={data.footer.path} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   INSIGHT CARD, one-off shareable findings (Pareto, anomalies, etc.)
   Reusable as we surface more interesting data over time.
   ════════════════════════════════════════════════════════════════ */

export interface InsightRow {
  rank: number;
  name: string;
  pct: number;
  metric: string;
}

export interface InsightCardData {
  /** Big-number headline, e.g. "81%" */
  headline: string;
  /** Subline below the headline */
  subline: string;
  /** Top-N list rows */
  rows: InsightRow[];
  /** Eyebrow above headline, e.g. "FINDING · 22 DAYS OF MONAD MAINNET" */
  eyebrow: string;
  /** Small contextual line below the list, e.g. "Across 44.3M conflicts, 11,865 contracts" */
  caption: string;
  footer: { host: string; path: string };
}

/**
 * Render the insight card at an arbitrary scale factor. scale=1 produces
 * the 1200x630 default; scale=4 produces a 4800x2520 high-DPI version
 * that stays crisp on retina displays and is suitable for download.
 * All numeric sizes inside (fontSize, padding, gaps, dimensions) are
 * multiplied by `scale` so the layout proportions stay identical at any
 * resolution. Lockup is the only exception, it has its own hardcoded
 * sizing baked in (shared with all other card types).
 */
export function renderInsightCard(
  data: InsightCardData,
  variant: CardVariant,
  scale: number = 1,
): React.ReactElement {
  const c = colorsFor(variant);
  const s = (n: number) => Math.round(n * scale);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "Inter Tight",
        padding: `${s(48)}px ${s(56)}px`,
      }}
    >
      {/* Top: lockup + eyebrow */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        {/* Lockup wraps its child mark+wordmark at fixed pixel sizes;
            for scale>1 we wrap it in a transform-scale container so it
            grows proportionally without us having to thread scale into
            the shared Lockup component. */}
        <div
          style={{
            display: "flex",
            transform: scale === 1 ? undefined : `scale(${scale})`,
            transformOrigin: "left center",
          }}
        >
          <Lockup colors={c} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontFamily: "JetBrains Mono",
            fontSize: s(12),
            color: c.subtle,
            letterSpacing: "0.18em",
          }}
        >
          <span>{data.eyebrow}</span>
        </div>
      </div>

      <div style={{ width: "100%", height: s(1), background: c.line, marginTop: s(24) }} />

      {/* Two-column body: big number left, list right */}
      <div
        style={{
          display: "flex",
          flex: 1,
          marginTop: s(28),
          alignItems: "flex-start",
          gap: s(40),
        }}
      >
        {/* Left: headline + subline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: `0 0 ${s(430)}px`,
          }}
        >
          <div
            style={{
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              fontSize: s(180),
              lineHeight: 0.9,
              color: c.ember,
              letterSpacing: "-0.03em",
            }}
          >
            {data.headline}
          </div>
          <div
            style={{
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              fontSize: s(28),
              color: c.text,
              lineHeight: 1.25,
              marginTop: s(18),
            }}
          >
            {data.subline}
          </div>
        </div>

        {/* Right: ranked list */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            fontFamily: "JetBrains Mono",
            fontSize: s(18),
          }}
        >
          {data.rows.map((r, i) => (
            <div
              key={r.rank}
              style={{
                display: "flex",
                alignItems: "center",
                gap: s(14),
                paddingTop: i === 0 ? 0 : s(12),
                paddingBottom: s(12),
                borderBottom:
                  i < data.rows.length - 1
                    ? `${Math.max(1, s(1))}px solid ${c.line}`
                    : "none",
              }}
            >
              <span
                style={{
                  color: c.subtle,
                  fontSize: s(14),
                  letterSpacing: "0.05em",
                  width: s(28),
                }}
              >
                {String(r.rank).padStart(2, "0")}
              </span>
              <span
                style={{
                  color: c.text,
                  flex: 1,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  fontFamily: "Inter Tight",
                  fontSize: s(18),
                }}
              >
                {r.name}
              </span>
              <span
                style={{
                  color: c.ember,
                  fontSize: s(18),
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  marginLeft: s(8),
                }}
              >
                {r.metric}
              </span>
            </div>
          ))}
          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: s(12),
              color: c.subtle,
              marginTop: s(18),
              letterSpacing: "0.05em",
              lineHeight: 1.5,
            }}
          >
            {data.caption}
          </div>
        </div>
      </div>

      {/* Scaled footer (inlined rather than using the shared FooterBand
          so it picks up the scale factor without forcing every other
          card type to plumb scale through). */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: s(32),
          fontFamily: "JetBrains Mono",
          fontSize: s(14),
          color: c.subtle,
          letterSpacing: "0.16em",
        }}
      >
        <span>{`${data.footer.host}${data.footer.path}`}</span>
        <span>BY SILK NODES</span>
      </div>
    </div>
  );
}
