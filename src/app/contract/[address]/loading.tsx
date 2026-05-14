/**
 * Loading state for /contract/[address].
 *
 * Next.js App Router uses this as the Suspense boundary fallback while
 * the server component fetches data. Without it the browser shows the
 * previous page (or blank) for the full duration of the contract query
 * pipeline (which can be 1-7s on popular contracts), making it feel
 * frozen. With it, the user sees a branded skeleton + status line as
 * soon as they click.
 *
 * Design choices:
 *   • Mirrors the real page's layout (SiteHeader, breadcrumb structure)
 *     so the swap to the loaded page doesn't visually shift everything.
 *   • The status line is the editorial brand voice rather than a
 *     spinner ("Searching the index…"). It updates the user about what
 *     pev is actually doing instead of generic "Loading."
 *   • A pulsing dot keeps the eye occupied so the page doesn't read as
 *     frozen even when the query takes 5s+ on a heavy contract.
 *   • Three skeleton blocks roughly outline where the verdict, stat
 *     strip, and window disclosure will land. Same panel/border tokens
 *     as the real page for visual continuity.
 */

import { themeA } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";

export default function ContractLoading() {
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
        tagline="How this contract behaves under parallel load"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/">contract</Crumb>
            <CrumbSep />
            <Crumb current title="loading">…</Crumb>
          </>
        }
      />

      {/* Editorial status line. Pulse animation keyed by `pev-pulse` so
          the user reads "page is working" without the cliché spinner. */}
      <section
        style={{
          marginTop: 48,
          marginBottom: 32,
          padding: "20px 22px",
          background: themeA.panel,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <PulseDot />
        <div>
          <div
            className="pev-eyebrow"
            style={{
              color: themeA.subtle,
              marginBottom: 4,
            }}
          >
            pev
          </div>
          <div
            className="pev-display-italic"
            style={{
              color: themeA.text,
              fontSize: "clamp(20px, 2.4vw, 26px)",
              lineHeight: 1.2,
            }}
          >
            Searching the index for this contract…
          </div>
          <div
            style={{
              color: themeA.muted,
              fontSize: 12,
              marginTop: 6,
              fontFamily: themeA.mono,
            }}
          >
            Aggregating blocks, hot slots, and method-level conflict counts.
            This usually takes a second; popular contracts can take a few.
          </div>
        </div>
      </section>

      {/* Skeleton: 4-stat strip placeholder, mirrors the real page.
          Same responsive grid as the loaded state so the swap doesn't
          re-flow the layout. */}
      <section
        className="pev-grid-stats-4"
        style={{ gap: 16, marginBottom: 32 }}
      >
        {[0, 1, 2, 3].map((i) => (
          <SkeletonStat key={i} />
        ))}
      </section>

      {/* Skeleton: window-disclosure band placeholder. */}
      <SkeletonRow height={62} />

      {/* Skeleton: 2-column hot slots / recent blocks placeholder, stacks
          to 1 column on mobile to mirror the loaded layout. */}
      <section
        className="pev-grid-two-col"
        style={{ gap: 20, marginTop: 32 }}
      >
        <SkeletonRow height={260} />
        <SkeletonRow height={260} />
      </section>

      <style>{`
        @keyframes pev-pulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.15); }
        }
        @keyframes pev-shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
      `}</style>
    </main>
  );
}

function PulseDot() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: themeA.accent,
        boxShadow: `0 0 12px ${themeA.accent}`,
        animation: "pev-pulse 1.4s ease-in-out infinite",
        flexShrink: 0,
      }}
    />
  );
}

function SkeletonStat() {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        height: 84,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "60%",
          height: 10,
          background: themeA.border,
          borderRadius: 2,
          marginBottom: 12,
        }}
      />
      <div
        style={{
          width: "40%",
          height: 22,
          background: themeA.border,
          borderRadius: 2,
        }}
      />
      <ShimmerOverlay />
    </div>
  );
}

function SkeletonRow({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <ShimmerOverlay />
    </div>
  );
}

function ShimmerOverlay() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, rgba(240,230,210,0.04) 50%, transparent 100%)",
        backgroundSize: "400px 100%",
        animation: "pev-shimmer 1.6s linear infinite",
        pointerEvents: "none",
      }}
    />
  );
}
