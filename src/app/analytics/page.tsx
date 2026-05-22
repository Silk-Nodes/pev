import Link from "next/link";
import type { Metadata } from "next";
import {
  getAnalyticsData,
  getCachedAnalyticsData,
  type AnalyticsData,
  type AnalyticsDayPoint,
  type AnalyticsKiller,
  type AnalyticsHotSlot,
  type AnalyticsMethod,
  type AnalyticsConflictKind,
  type AnalyticsWaveBucket,
  type AnalyticsStandoutBlock,
} from "@/lib/indexer/store";
import { resolveManyContracts, resolveManyMethods } from "@/lib/enrichment";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { shortHex } from "@/lib/probe-to-pev";

/**
 * /analytics, chain-wide rollup of how Monad has parallelized over the
 * last 7 days. Three sections, in order:
 *
 *   1. Stat strip, the "what happened" headline numbers (avg score,
 *      blocks, txs, conflicts) over the window
 *   2. Daily chart, 7 bars showing avg parallelism score per day, color
 *      graded sage (good) → terracotta (bad). Pure SVG, no chart lib.
 *   3. Killers leaderboard, top 10 contracts ranked by total conflicts
 *      caused over the window. Real absolute counts, no rate math.
 *      Each row links to /contract/[address].
 *
 * Window is 7 days, ~1.2M blocks. Page is cached for 5 minutes via
 * revalidate so we don't hit the DB on every visit.
 */

const WINDOW_DAYS = 7;

// Per-page OG card with the headline + #1 killer + 7d stats. Served
// from /og/ not /api/og/ so Twitter's card validator doesn't flag it
// as "may be robots.txt-restricted" (heuristic check on /api/* URLs).
// ?v=N is the cache-bust knob for Twitter/Discord preview caches.
const OG_IMAGE_URL = "/og/analytics?v=4";
const OG_TITLE = "Analytics · pev";
const OG_DESCRIPTION =
  "How Monad parallelizes. Chain-wide stats and the top contracts causing throughput contention over the last 7 days.";

export const metadata: Metadata = {
  // Absolute title bypasses root template. 59 chars, inside Google's
  // 50-60 char target. Loads the head with the queries we want to
  // rank for: "Monad parallelism", "analytics", "bottleneck contracts".
  title: {
    absolute: "Analytics: Monad parallelism stats and bottleneck contracts",
  },
  description: OG_DESCRIPTION,
  // Self-canonical so Google indexes /analytics as a distinct page.
  alternates: {
    canonical: "/analytics",
  },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    type: "article",
    url: "/analytics",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "pev, chain-wide analytics for Monad",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

// Dynamic rendering on each request. We tried `revalidate = 300` (ISR)
// originally, but that forces Next.js to prerender at build time, and
// the heaviest query (top methods, scans ~10M tx_executions rows over
// 7 days) blew past the 60s build timeout. SSR-on-request is fine for
// this page: the queries take 1-3s warm and the page is cached at the
// CDN edge by Cloudflare.
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  // Hot path: read the precomputed payload from analytics_cache
  // (refreshed every 5 min by the systemd timer). ~5ms PK lookup, no
  // aggregation. Falls through to live computation only when the cache
  // is empty (fresh deploy, before the first refresh has run).
  let data: AnalyticsData | null = null;
  let cacheAge: { refreshedAt: Date; refreshMs: number | null } | null = null;
  try {
    const cached = await getCachedAnalyticsData();
    if (cached) {
      data = cached.data;
      cacheAge = { refreshedAt: cached.refreshedAt, refreshMs: cached.refreshMs };
    } else {
      // Cold cache fallback. Slow but always works.
      console.warn("[analytics] cache empty, falling back to live computation");
      data = await getAnalyticsData(WINDOW_DAYS);
    }
  } catch (err) {
    console.warn("[analytics] data read failed:", (err as Error).message);
  }

  // Batch-resolve labels for everything that has a name resolution
  // path: killer contracts + hot-slot owners (Sourcify cache) + method
  // selectors (4byte cache). All cache-first lookups; the rare miss
  // hits the upstream API once and is cached forever after.
  let contractNames = new Map<string, string | null>();
  let methodNames = new Map<string, string | null>();
  if (data) {
    const allAddresses = [
      ...data.killers.map((k) => k.address),
      ...data.hotSlots.map((s) => s.contract),
    ];
    const allSelectors = data.methods.map((m) => m.selector);
    try {
      const [contracts, methods] = await Promise.all([
        allAddresses.length > 0
          ? resolveManyContracts(allAddresses)
          : Promise.resolve(new Map<string, string | null>()),
        allSelectors.length > 0
          ? resolveManyMethods(allSelectors)
          : Promise.resolve(new Map<string, string | null>()),
      ]);
      contractNames = contracts;
      methodNames = methods;
    } catch (err) {
      console.warn("[analytics] name resolution failed:", (err as Error).message);
    }
  }
  const killerNames = contractNames; // alias for the existing KillersList prop

  if (!data || data.daily.length === 0) {
    return (
      <main
        style={{
          padding: "32px clamp(20px, 4vw, 64px) 80px",
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        <SiteHeader
          variant="internal"
          tagline="How Monad parallelizes"
          breadcrumb={
            <>
              <Crumb href="/">pev</Crumb>
              <CrumbSep />
              <Crumb current>analytics</Crumb>
            </>
          }
        />
        <p style={{ color: themeA.muted, marginTop: 32 }}>
          Not enough indexed data yet to compute analytics. Check back in a
          few minutes.
        </p>
        <SiteFooter />
      </main>
    );
  }

  return (
    <main
      style={{
        padding: "32px clamp(20px, 4vw, 64px) 80px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <SiteHeader
        variant="internal"
        tagline="How Monad parallelizes"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>analytics</Crumb>
          </>
        }
      />

      {/* Hero */}
      <section style={{ marginBottom: 32 }}>
        <div className="pev-eyebrow" style={{ letterSpacing: ".18em" }}>
          {`Analytics · last ${WINDOW_DAYS} days`}
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(36px, 5vw, 56px)",
            color: themeA.text,
            margin: "10px 0 0",
            lineHeight: 1.05,
          }}
        >
          How Monad parallelizes.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: themeA.muted,
            marginTop: 14,
            maxWidth: "62ch",
            lineHeight: 1.6,
          }}
        >
          Real numbers from{" "}
          <span style={{ color: themeA.text, fontFamily: themeA.mono }}>
            {data.totals.blocks.toLocaleString()}
          </span>{" "}
          blocks indexed over the last {WINDOW_DAYS} days. The chart is the
          chain&rsquo;s parallelism score, day by day. The list below is who
          caused the contention.
        </p>
      </section>

      {/* Stat strip */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <Stat
          label="Avg parallelism"
          value={`${data.totals.avgScore}/100`}
          color={
            data.totals.avgScore >= 70
              ? themeA.status.clean
              : data.totals.avgScore >= 40
                ? themeA.status.delayed
                : themeA.status.source
          }
        />
        <Stat label="Blocks" value={data.totals.blocks.toLocaleString()} />
        <Stat label="Transactions" value={data.totals.txs.toLocaleString()} />
        <Stat
          label="Conflicts"
          value={data.totals.conflicts.toLocaleString()}
          color={
            data.totals.conflicts > 0 ? themeA.status.source : themeA.text
          }
        />
      </section>

      {/* Daily chart */}
      <section style={{ marginBottom: 48 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 14 }}>
          Daily parallelism
        </div>
        <DailyChart points={data.daily} />
      </section>

      {/* "Today's standout" editorial callouts: two concrete blocks
          readers can click into for either extreme of the chain. We
          tolerate missing standout data (older cached payloads pre-
          this-field) by simply not rendering the section. */}
      {data.standout?.cleanest && data.standout?.worst && (
        <section style={{ marginBottom: 48 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 14 }}>
            Today&rsquo;s standout blocks
          </div>
          <div className="pev-grid-two-col" style={{ gap: 20 }}>
            <StandoutBlockCard kind="cleanest" block={data.standout.cleanest} />
            <StandoutBlockCard kind="worst" block={data.standout.worst} />
          </div>
        </section>
      )}

      {/* Chain-shape strip, two structural breakdowns side-by-side.
          Conflict kinds = "what type of contention dominates"; wave
          depth = "how parallel is the chain structurally". Both teach
          the underlying mechanics in a glance. */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 48,
        }}
      >
        <ConflictKindsCard kinds={data.conflictKinds} />
        <WaveDepthCard buckets={data.waveDistribution} />
      </section>

      {/* Killers leaderboard, contract-level */}
      <section style={{ marginBottom: 40 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 6 }}>
          Top conflict-causing contracts
        </div>
        <p
          style={{
            fontSize: 13,
            color: themeA.muted,
            marginBottom: 18,
            maxWidth: "62ch",
            lineHeight: 1.5,
          }}
        >
          Ranked by total conflicts caused over the window. Click any row to
          inspect the contract&rsquo;s parallelism profile.
        </p>
        <KillersList killers={data.killers} names={killerNames} />
      </section>

      {/* Hot slots leaderboard, storage-level granularity. Often
          surfaces the universal anti-pattern (slot 0 = global counter).
          Narrower window than the rest of the page (24h) for performance,
          labeled inline so the data stays honest. */}
      <section style={{ marginBottom: 40 }}>
        <div
          className="pev-eyebrow"
          style={{ marginBottom: 6, display: "flex", gap: 10 }}
        >
          <span>Top contended storage slots</span>
        </div>
        <p
          style={{
            fontSize: 13,
            color: themeA.muted,
            marginBottom: 18,
            maxWidth: "62ch",
            lineHeight: 1.5,
          }}
        >
          One level deeper than the contract list, the exact{" "}
          <span style={{ color: themeA.text, fontFamily: themeA.mono }}>
            (contract, slot)
          </span>{" "}
          pairs causing the most contention. Click to inspect the contract.
        </p>
        <HotSlotsList slots={data.hotSlots} names={contractNames} />
      </section>

      {/* Methods leaderboard, cross-contract pattern. The "killer
          functions of Monad" view, which 4-byte selectors create the
          most contention regardless of which contract they live on.
          24h window for the same perf reason as hot slots. */}
      <section style={{ marginBottom: 40 }}>
        <div
          className="pev-eyebrow"
          style={{ marginBottom: 6, display: "flex", gap: 10 }}
        >
          <span>Top conflict-causing methods</span>
        </div>
        <p
          style={{
            fontSize: 13,
            color: themeA.muted,
            marginBottom: 18,
            maxWidth: "62ch",
            lineHeight: 1.5,
          }}
        >
          The function selectors causing the most outbound conflicts, summed
          across every contract that calls them. Resolved against{" "}
          <a
            href="https://www.4byte.directory/"
            className="pev-link"
            target="_blank"
            rel="noreferrer"
          >
            4byte
          </a>{" "}
          when known.
        </p>
        <MethodsList methods={data.methods} names={methodNames} />
      </section>

      {/* Cache freshness indicator. Lives in its own quiet line above
          the caveat. Tells observant users "the data on this page is up
          to N minutes stale", which is honest about how the analytics
          page works (precomputed every 5 min, not live per request). */}
      {cacheAge && (
        <div
          style={{
            marginBottom: 12,
            fontFamily: themeA.mono,
            fontSize: 11,
            color: themeA.subtle,
            letterSpacing: "0.05em",
          }}
        >
          payload refreshed{" "}
          {Math.max(
            0,
            Math.round((Date.now() - cacheAge.refreshedAt.getTime()) / 60000),
          )}{" "}
          min ago
          {cacheAge.refreshMs !== null && (
            <span style={{ marginLeft: 8 }}>
              · computed in {(cacheAge.refreshMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      )}

      {/* Window disclosure + caveat */}
      <section
        style={{
          padding: 18,
          border: `1px dashed ${themeA.border}`,
          borderRadius: themeA.radius,
          marginBottom: 32,
          background: palette.surface03,
          fontSize: 12,
          color: themeA.muted,
          lineHeight: 1.6,
        }}
      >
        <span className="pev-eyebrow">Caveat</span>
        <br />
        Stats above are aggregated over blocks{" "}
        <Link
          href={`/block/${data.windowFromBlock}`}
          className="pev-link"
        >
          #{data.windowFromBlock.toLocaleString()}
        </Link>{" "}
        to{" "}
        <Link href={`/block/${data.windowToBlock}`} className="pev-link">
          #{data.windowToBlock.toLocaleString()}
        </Link>
        , roughly the last {WINDOW_DAYS} days of mainnet at current cadence.
        Conflict counts are absolute (no rate normalization), so contracts
        with more total transactions naturally appear higher on the list.
        Names are shown when verified on Sourcify (rare on Monad mainnet
        right now); otherwise we show the short hex.
      </section>

      <SiteFooter />
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Helper components, kept inline so the page reads top to bottom.
   ───────────────────────────────────────────────────────────────── */

/**
 * StandoutBlockCard, editorial callout pair for the analytics page.
 * Renders one of two extremes from the last ~24h: the cleanest block
 * (highest parallelism score) or the worst (lowest). Each card is
 * a click target leading to the block page so readers can see what
 * caused either extreme in concrete detail.
 *
 * Visual treatment differs by kind so a glance distinguishes them:
 *   cleanest → sage-tinted border, "clean" status color on the score
 *   worst    → terracotta-tinted border, "source" color on the score
 * Both use the same panel background and editorial layout so the
 * difference reads as "same UI, different verdict".
 */
function StandoutBlockCard({
  kind,
  block,
}: {
  kind: "cleanest" | "worst";
  block: AnalyticsStandoutBlock;
}) {
  const isClean = kind === "cleanest";
  const accentColor = isClean
    ? themeA.status.clean
    : themeA.status.sourceText;
  const eyebrowText = isClean ? "Cleanest block, 24h" : "Worst block, 24h";
  const tagline = isClean
    ? "Every tx parallel, no contention. This is what the chain looks like at its best."
    : "Heaviest contention in the window. Click through to see which contracts were fighting.";

  // age relative to now, approximate
  const ts = new Date(block.timestamp);
  const ageSec = Math.max(0, Math.round((Date.now() - ts.getTime()) / 1000));
  const ageLabel =
    ageSec < 60
      ? `${ageSec}s ago`
      : ageSec < 3600
        ? `${Math.round(ageSec / 60)}m ago`
        : ageSec < 86400
          ? `${Math.round(ageSec / 3600)}h ago`
          : `${Math.round(ageSec / 86400)}d ago`;

  return (
    <Link
      href={`/block/${block.number}`}
      style={{
        display: "block",
        padding: "20px 22px",
        background: themeA.panel,
        // A 2px left-border in the kind color is the visual "verdict
        // strip" without needing to color the whole card. Sits next to
        // the standard border so the card still reads as a unified
        // panel from any distance.
        borderLeft: `3px solid ${accentColor}`,
        border: `1px solid ${themeA.border}`,
        borderLeftWidth: 3,
        borderLeftColor: accentColor,
        borderRadius: themeA.radius,
        textDecoration: "none",
        color: themeA.text,
      }}
    >
      <div
        className="pev-eyebrow"
        style={{ color: themeA.subtle, marginBottom: 10 }}
      >
        {eyebrowText}
      </div>
      <div
        className="pev-mono"
        style={{
          fontSize: 22,
          color: themeA.text,
          marginBottom: 6,
        }}
      >
        #{block.number.toLocaleString()}
      </div>
      <div
        className="pev-mono"
        style={{
          fontSize: 12,
          color: themeA.muted,
          marginBottom: 16,
        }}
      >
        <span style={{ color: accentColor }}>
          {block.parallelismScore}/100
        </span>
        {" · "}
        {block.txCount} tx
        {" · "}
        {block.conflictCount} conf
        {" · "}
        {ageLabel}
      </div>
      <div
        style={{
          fontFamily: themeA.serif,
          fontStyle: "italic",
          fontSize: 14,
          color: themeA.muted,
          lineHeight: 1.5,
        }}
      >
        {tagline}
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ borderLeft: `2px solid ${themeA.border}`, paddingLeft: 14 }}>
      <div className="pev-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: themeA.mono,
          fontSize: 22,
          color: color ?? themeA.text,
          marginTop: 4,
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * DailyChart, simple inline SVG bar chart. One bar per day, height
 * proportional to that day's average parallelism score (0-100), color
 * graded by score.
 *
 * No charting library. Satori-friendly (server-rendered). Honest:
 * if a day has no blocks (gap in indexer), it just doesn't appear.
 */
function DailyChart({ points }: { points: AnalyticsDayPoint[] }) {
  if (points.length === 0) {
    return (
      <div style={{ color: themeA.muted, fontSize: 13 }}>
        No data in this window.
      </div>
    );
  }

  // Layout, kept simple. Width responsive via viewBox; height fixed.
  const W = 1000;
  const H = 240;
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 38;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const barGap = 12;
  const barW = (innerW - barGap * (points.length - 1)) / points.length;

  // Auto-scale the Y-axis to the data range so 80-83 doesn't render as
  // 7 identical-looking bars. We pad ±3 around the data range, clamp
  // [0, 100], and enforce a minimum 10-point spread so a flat day
  // doesn't collapse into a zero-height axis. The chart now shows the
  // actual variation between days even when the chain is healthy.
  const scores = points.map((p) => p.avgScore);
  const dataMin = Math.min(...scores);
  const dataMax = Math.max(...scores);
  let yMin = Math.max(0, Math.floor(dataMin - 3));
  let yMax = Math.min(100, Math.ceil(dataMax + 3));
  if (yMax - yMin < 10) {
    // Expand symmetrically around the midpoint, but stay within [0, 100]
    const mid = (yMax + yMin) / 2;
    yMin = Math.max(0, Math.floor(mid - 5));
    yMax = Math.min(100, Math.ceil(mid + 5));
  }
  const yMid = Math.round((yMin + yMax) / 2);
  const ySpan = Math.max(1, yMax - yMin);

  // Map a score to a y-coordinate. Scores below yMin clip to the
  // baseline; scores above yMax clip to the top (shouldn't happen
  // given our auto-fit, but defensive).
  const yFor = (score: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, score));
    const frac = (clamped - yMin) / ySpan;
    return PAD_T + innerH - frac * innerH;
  };

  const colorFor = (score: number) => {
    if (score >= 70) return themeA.status.clean;
    if (score >= 40) return themeA.status.delayed;
    return themeA.status.source;
  };

  // Three ticks on the auto-scaled axis: floor, midpoint, ceiling.
  const yTicks = [yMin, yMid, yMax];

  // Format the day label as "Mon" "Tue" etc., from the YYYY-MM-DD string.
  // We treat the date as UTC (which matches how date_trunc('day', ts) groups).
  const dayLabel = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  };
  const dateLabel = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };

  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: 18,
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Y-axis gridlines + labels at the auto-scaled floor, midpoint,
            ceiling. Bottom line is solid (it's the baseline); the others
            are dashed so they read as reference, not structure. */}
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke={themeA.border}
                strokeDasharray={tick === yMin ? "" : "2 4"}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y + 4}
                fontSize={11}
                fontFamily={themeA.mono}
                fill={themeA.subtle}
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {points.map((p, i) => {
          const x = PAD_L + i * (barW + barGap);
          const y = yFor(p.avgScore);
          const h = PAD_T + innerH - y;
          const color = colorFor(p.avgScore);
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(2, h)}
                fill={color}
                rx={3}
              />
              {/* Score number above the bar */}
              <text
                x={x + barW / 2}
                y={y - 6}
                fontSize={13}
                fontFamily={themeA.mono}
                fill={themeA.text}
                textAnchor="middle"
              >
                {p.avgScore}
              </text>
              {/* Day label below the bar */}
              <text
                x={x + barW / 2}
                y={H - PAD_B + 18}
                fontSize={11}
                fontFamily={themeA.mono}
                fill={themeA.muted}
                textAnchor="middle"
                letterSpacing="0.08em"
              >
                {dayLabel(p.date).toUpperCase()}
              </text>
              {/* Date below the day */}
              <text
                x={x + barW / 2}
                y={H - PAD_B + 32}
                fontSize={10}
                fontFamily={themeA.mono}
                fill={themeA.subtle}
                textAnchor="middle"
              >
                {dateLabel(p.date)}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: `1px solid ${themeA.border}`,
          fontFamily: themeA.mono,
          fontSize: 11,
          color: themeA.subtle,
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: themeA.status.clean,
              marginRight: 6,
              verticalAlign: "middle",
            }}
          />
          {`70+ `}
          <span style={{ color: themeA.muted }}>clean</span>
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: themeA.status.delayed,
              marginRight: 6,
              verticalAlign: "middle",
            }}
          />
          {`40-69 `}
          <span style={{ color: themeA.muted }}>contended</span>
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: themeA.status.source,
              marginRight: 6,
              verticalAlign: "middle",
            }}
          />
          {`< 40 `}
          <span style={{ color: themeA.muted }}>throughput-killer</span>
        </span>
      </div>
    </div>
  );
}

function KillersList({
  killers,
  names,
}: {
  killers: AnalyticsKiller[];
  names: Map<string, string | null>;
}) {
  if (killers.length === 0) {
    return (
      <div style={{ color: themeA.muted, fontSize: 13 }}>
        No conflict-causing contracts in this window. The chain ran clean.
      </div>
    );
  }
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        overflow: "hidden",
      }}
    >
      {killers.map((k, i) => {
        const name = names.get(k.address.toLowerCase()) ?? null;
        return (
          <Link
            key={k.address}
            href={`/contract/${k.address}`}
            className="pev-row-killer"
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr auto auto auto",
              gap: 18,
              alignItems: "center",
              padding: "14px 20px",
              borderBottom:
                i < killers.length - 1
                  ? `1px solid ${themeA.border}`
                  : "none",
              textDecoration: "none",
              color: themeA.text,
              transition: "background 120ms ease",
            }}
          >
            <span
              className="pev-mono"
              style={{
                fontSize: 12,
                color: themeA.subtle,
                letterSpacing: "0.05em",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                fontFamily: name ? themeA.sans : themeA.mono,
                fontSize: 14,
                color: themeA.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={k.address}
            >
              {name ?? shortHex(k.address, 8, 6)}
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 12,
                color: themeA.muted,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: themeA.text }}>
                {k.hotBlocks.toLocaleString()}
              </span>{" "}
              blocks
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 14,
                color: themeA.status.source,
                whiteSpace: "nowrap",
                fontWeight: 500,
              }}
            >
              {k.totalConflicts.toLocaleString()} conf
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 11,
                color: themeA.subtle,
                letterSpacing: "0.05em",
              }}
            >
              audit →
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ─── Hot slots leaderboard ─────────────────────────────────────
   Same row pattern as KillersList but with the slot hash inline,
   so devs can see which exact storage location is contended. Click
   routes to the contract page (the hot slot is in context there). */

function HotSlotsList({
  slots,
  names,
}: {
  slots: AnalyticsHotSlot[];
  names: Map<string, string | null>;
}) {
  if (slots.length === 0) {
    return (
      <div style={{ color: themeA.muted, fontSize: 13 }}>
        No contended storage slots in this window.
      </div>
    );
  }
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        overflow: "hidden",
      }}
    >
      {slots.map((s, i) => {
        const name = names.get(s.contract.toLowerCase()) ?? null;
        return (
          <Link
            key={`${s.contract}-${s.slot}`}
            href={`/contract/${s.contract}`}
            className="pev-row-killer"
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr auto auto auto",
              gap: 18,
              alignItems: "center",
              padding: "14px 20px",
              borderBottom:
                i < slots.length - 1
                  ? `1px solid ${themeA.border}`
                  : "none",
              textDecoration: "none",
              color: themeA.text,
              transition: "background 120ms ease",
            }}
          >
            <span
              className="pev-mono"
              style={{
                fontSize: 12,
                color: themeA.subtle,
                letterSpacing: "0.05em",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: name ? themeA.sans : themeA.mono,
                  fontSize: 14,
                  color: themeA.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={s.contract}
              >
                {name ?? shortHex(s.contract, 8, 6)}
              </span>
              <span
                className="pev-mono"
                style={{
                  fontSize: 11,
                  color: themeA.subtle,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={s.slot}
              >
                slot {shortHex(s.slot, 10, 6)}
              </span>
            </div>
            <span
              className="pev-mono"
              style={{
                fontSize: 12,
                color: themeA.muted,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: themeA.text }}>
                {s.hotBlocks.toLocaleString()}
              </span>{" "}
              blocks
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 14,
                color: themeA.status.source,
                whiteSpace: "nowrap",
                fontWeight: 500,
              }}
            >
              {s.totalConflicts.toLocaleString()} conf
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 11,
                color: themeA.subtle,
                letterSpacing: "0.05em",
              }}
            >
              audit →
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ─── Methods leaderboard ───────────────────────────────────────
   Cross-contract pattern view. Rows are not links (no /method route
   exists yet) so the row is a plain div, not a Link. Future: add a
   /method/[selector] page that shows top contracts using the method,
   then convert these rows to links. */

function MethodsList({
  methods,
  names,
}: {
  methods: AnalyticsMethod[];
  names: Map<string, string | null>;
}) {
  if (methods.length === 0) {
    return (
      <div style={{ color: themeA.muted, fontSize: 13 }}>
        No methods caused conflicts in this window.
      </div>
    );
  }
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        overflow: "hidden",
      }}
    >
      {methods.map((m, i) => {
        // 4byte signatures look like "transfer(address,uint256)". We show
        // them as-is when known; selector hex when not.
        const signature = names.get(m.selector.toLowerCase()) ?? null;
        const display = signature ?? m.selector;
        return (
          <div
            key={m.selector}
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr auto auto",
              gap: 18,
              alignItems: "center",
              padding: "14px 20px",
              borderBottom:
                i < methods.length - 1
                  ? `1px solid ${themeA.border}`
                  : "none",
              color: themeA.text,
            }}
          >
            <span
              className="pev-mono"
              style={{
                fontSize: 12,
                color: themeA.subtle,
                letterSpacing: "0.05em",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                fontFamily: signature ? themeA.sans : themeA.mono,
                fontSize: 14,
                color: themeA.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`${m.selector} ${signature ?? ""}`.trim()}
            >
              {display}
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 12,
                color: themeA.muted,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: themeA.text }}>
                {m.txCount.toLocaleString()}
              </span>{" "}
              txs ·{" "}
              <span style={{ color: themeA.text }}>
                {m.blockCount.toLocaleString()}
              </span>{" "}
              blocks
            </span>
            <span
              className="pev-mono"
              style={{
                fontSize: 14,
                color: themeA.status.source,
                whiteSpace: "nowrap",
                fontWeight: 500,
              }}
            >
              {m.conflictsCaused.toLocaleString()} conf
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Conflict kinds card ───────────────────────────────────────
   Three rows showing percentage breakdown of write-write / read-write
   / write-read. Plain horizontal proportion bars (no SVG needed) +
   counts. Tells the dev WHAT kind of contention dominates. */

function ConflictKindsCard({ kinds }: { kinds: AnalyticsConflictKind[] }) {
  // DB stores LOWERCASE hyphenated kinds (write-write / read-write / mixed).
  // We map each to a friendlier label + subtitle + brand color so the
  // card teaches what each conflict type actually means.
  const KIND_COPY: Record<string, { label: string; subtitle: string; color: string }> = {
    "write-write": {
      label: "WRITE / WRITE",
      subtitle: "both txs wrote the same slot",
      color: themeA.status.source,
    },
    "read-write": {
      label: "READ / WRITE",
      subtitle: "one tx read a slot the other wrote",
      color: themeA.status.delayed,
    },
    "write-read": {
      label: "WRITE / READ",
      subtitle: "one tx wrote a slot the other read",
      color: themeA.accent,
    },
    mixed: {
      label: "MIXED",
      subtitle: "the same pair conflicted on slots in multiple ways",
      color: themeA.muted,
    },
  };

  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "16px 18px",
      }}
    >
      <div className="pev-eyebrow" style={{ marginBottom: 4 }}>
        Conflict kinds
      </div>
      <div
        style={{
          fontSize: 13,
          color: themeA.muted,
          marginBottom: 16,
        }}
      >
        What kind of contention dominates the chain.
      </div>
      {kinds.length === 0 ? (
        <div style={{ color: themeA.muted, fontSize: 13 }}>
          No conflicts in this window.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {kinds.map((k) => {
            const copy = KIND_COPY[k.kind] ?? {
              label: k.kind.toUpperCase(),
              subtitle: "",
              color: themeA.muted,
            };
            const pct = Math.round(k.share * 100);
            return (
              <div
                key={k.kind}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                  }}
                >
                  <span
                    className="pev-mono"
                    style={{
                      fontSize: 11,
                      color: themeA.subtle,
                      letterSpacing: "0.12em",
                    }}
                  >
                    {copy.label}
                  </span>
                  <span
                    className="pev-mono"
                    style={{ fontSize: 13, color: themeA.text }}
                  >
                    <span style={{ fontWeight: 500 }}>{pct}%</span>
                    <span style={{ color: themeA.subtle, marginLeft: 8 }}>
                      {k.count.toLocaleString()}
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: themeA.border,
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, pct)}%`,
                      height: "100%",
                      background: copy.color,
                      borderRadius: 3,
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: themeA.subtle }}>
                  {copy.subtitle}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Wave depth histogram card ─────────────────────────────────
   Distribution of execution_depth across all blocks in the window.
   1 wave = perfectly parallel; N waves = N rounds of serialization.
   The "62% of blocks ran in 1 wave" stat is the headline takeaway. */

function WaveDepthCard({ buckets }: { buckets: AnalyticsWaveBucket[] }) {
  if (buckets.length === 0) {
    return null;
  }
  const totalBlocks = buckets.reduce((s, b) => s + b.blockCount, 0);
  const oneWaveShare = buckets.find((b) => b.waves === 1)?.share ?? 0;
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "16px 18px",
      }}
    >
      <div className="pev-eyebrow" style={{ marginBottom: 4 }}>
        Wave depth
      </div>
      <div
        style={{
          fontSize: 13,
          color: themeA.muted,
          marginBottom: 16,
        }}
      >
        How many sequential rounds blocks needed.{" "}
        <span style={{ color: themeA.text }}>
          {Math.round(oneWaveShare * 100)}%
        </span>{" "}
        ran fully parallel.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {buckets.map((b) => {
          const pct = Math.round(b.share * 100);
          // Waves 1 = best (clean), 2 = mild, 3 = contended, 4+ = bad
          const color =
            b.waves === 1
              ? themeA.status.clean
              : b.waves === 2
                ? themeA.accent
                : b.waves === 3
                  ? themeA.status.delayed
                  : themeA.status.source;
          const label =
            b.waves >= 4 ? "4+ waves" : `${b.waves} wave${b.waves === 1 ? "" : "s"}`;
          return (
            <div
              key={b.waves}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                }}
              >
                <span
                  className="pev-mono"
                  style={{
                    fontSize: 12,
                    color: themeA.text,
                    letterSpacing: "0.05em",
                  }}
                >
                  {label}
                </span>
                <span
                  className="pev-mono"
                  style={{ fontSize: 13, color: themeA.text }}
                >
                  <span style={{ fontWeight: 500 }}>{pct}%</span>
                  <span style={{ color: themeA.subtle, marginLeft: 8 }}>
                    {b.blockCount.toLocaleString()}
                  </span>
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: themeA.border,
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    height: "100%",
                    background: color,
                    borderRadius: 3,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px solid ${themeA.border}`,
          fontFamily: themeA.mono,
          fontSize: 11,
          color: themeA.subtle,
        }}
      >
        {totalBlocks.toLocaleString()} blocks total
      </div>
    </div>
  );
}
