import Link from "next/link";
import type { Metadata } from "next";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

/**
 * /showcase, the protocol use-case page. A worked example of what pev's
 * execution traces reveal about one real contract (Kuru's MarginAccount),
 * built so a non-expert grasps "parallel execution + contention" in a few
 * seconds, then can drill into the sophisticated detail.
 *
 * IMPORTANT: this page does NO live database work. The figures come from a
 * static report object below, refreshed out-of-band. After the 2026-06-18
 * contention incident the rule is firm: never run a heavy aggregation on a
 * page request. See [[pev-db-contention]].
 */

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: { absolute: "What pev shows a protocol team: a Kuru worked example" },
  description:
    "A worked example of pev's parallel-execution profiling: where Kuru's MarginAccount collides on storage, what it costs in re-execution, and how to fix it. The contention profiler for Monad protocols.",
  alternates: { canonical: "/showcase" },
  openGraph: {
    title: "What pev shows a protocol team",
    description:
      "Where a real Monad contract collides on storage, what it costs, and how to fix it. pev's parallel-execution profiler, worked example.",
    type: "website",
    url: "/showcase",
  },
};

// ─── The worked-example report (static, real figures from pev traces) ──
// Kuru Exchange: MarginAccount. Refreshed out-of-band, never live.
const SUBJECT = {
  name: "Kuru Exchange: MarginAccount",
  address: "0x2a68ba1833cdf93fa9da1eebd7f46242ad8e90c5",
  txs: 1_971_569,
  conflicts: 1_350_629,
  // The single largest collision source: a high-frequency solver that
  // executes orders against the shared margin state (7-day window).
  topCollider: {
    label: "High-frequency solver",
    address: "0x57cf97fe1fac7d78b07e7e0761410cb2e91f0ca7",
    collisions: 462_498,
  },
};
const conflictRate = Math.round((SUBJECT.conflicts / SUBJECT.txs) * 100);
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${Math.round(n / 1000)}K` : `${n}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ShowcasePage() {
  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 96px", maxWidth: 1100, margin: "0 auto" }}>
      <SiteHeader
        variant="internal"
        tagline="What pev shows your team"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>showcase</Crumb>
          </>
        }
      />

      {/* ── Hero: the concept in one glance ───────────────────────── */}
      <section style={{ marginBottom: 12 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
          Worked example · Monad mainnet
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(32px, 5.2vw, 56px)",
            color: themeA.text,
            margin: "0 0 16px",
            letterSpacing: "-0.01em",
            lineHeight: 1.08,
          }}
        >
          Find what&apos;s quietly throttling your protocol.
        </h1>
        <p style={{ fontSize: 17, color: themeA.muted, lineHeight: 1.65, maxWidth: "60ch", margin: 0 }}>
          Monad runs transactions <strong style={{ color: themeA.text }}>in parallel</strong>. But
          when many transactions touch the <strong style={{ color: palette.terracotta }}>same
          storage</strong>, they collide and have to re-run one at a time. That hidden
          serialization caps your throughput. pev traces every block and shows you exactly where it
          happens.
        </p>
      </section>

      {/* The 3-second visual: parallel lanes jamming at a shared slot */}
      <ContentionDiagram />

      {/* ── Three numbers that frame the example ──────────────────── */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          margin: "28px 0 8px",
        }}
      >
        <Stat big={fmtCompact(SUBJECT.txs)} label="transactions touched" sub={`${fmt(SUBJECT.txs)} total`} />
        <Stat
          big={fmtCompact(SUBJECT.conflicts)}
          label="storage collisions"
          sub={`${fmt(SUBJECT.conflicts)} re-runs forced`}
          warn
        />
        <Stat
          big={`${conflictRate}%`}
          label="collision rate"
          sub={`~${conflictRate >= 60 ? "2 in 3" : "1 in 2"} transactions collide`}
          warn
        />
      </section>
      <p style={{ fontSize: 13, color: themeA.subtle, fontFamily: themeA.mono, margin: "4px 0 0" }}>
        subject: {SUBJECT.name} · {short(SUBJECT.address)}
      </p>

      {/* ── In one sentence ───────────────────────────────────────── */}
      <Callout>
        Roughly <strong style={{ color: palette.terracotta }}>two out of every three</strong>{" "}
        transactions that touch Kuru&apos;s MarginAccount hit a storage collision, which means Monad
        executed them, threw the result away, and ran them again. That is throughput the chain paid
        for twice.
      </Callout>

      {/* ── The sophisticated part: where it comes from ───────────── */}
      <Section
        kicker="The diagnosis"
        title="Most of the collisions trace to one source"
      >
        <p style={{ fontSize: 16, color: themeA.muted, lineHeight: 1.7, maxWidth: "62ch" }}>
          pev doesn&apos;t just count collisions, it shows <em>who</em> you collide with. For the
          MarginAccount, a single <strong style={{ color: themeA.text }}>high-frequency solver</strong>{" "}
          executing orders against your shared margin state is the largest contributor:
        </p>
        <ColliderBar
          label={SUBJECT.topCollider.label}
          address={SUBJECT.topCollider.address}
          value={SUBJECT.topCollider.collisions}
          ofTotal={SUBJECT.conflicts}
        />
        <p style={{ fontSize: 14, color: themeA.subtle, lineHeight: 1.65, maxWidth: "62ch", marginTop: 14 }}>
          That&apos;s the kind of finding no block explorer surfaces, because explorers count
          transactions <em>sent to</em> a contract, not what each transaction actually{" "}
          <em>touches</em>. With the full report, pev breaks this down to the exact{" "}
          <strong style={{ color: themeA.text }}>storage slot</strong> and{" "}
          <strong style={{ color: themeA.text }}>method</strong> driving each collision.
        </p>
      </Section>

      {/* ── What it costs ─────────────────────────────────────────── */}
      <Section kicker="Why it matters" title="Every collision is work the chain did twice">
        <p style={{ fontSize: 16, color: themeA.muted, lineHeight: 1.7, maxWidth: "62ch" }}>
          Monad executes optimistically in parallel, then re-runs any transaction whose reads or
          writes conflicted with an earlier one. High contention means more re-execution: wasted
          compute, higher latency under load, and a lower <em>effective</em> throughput than the
          chain could deliver. Cutting contention is the single highest-leverage performance win for
          a busy contract, and almost nobody can see it today.
        </p>
      </Section>

      {/* ── What you can do ───────────────────────────────────────── */}
      <Section kicker="The fix" title="What the data points you toward">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 4 }}>
          <Fix
            title="Shard the hot slot"
            body="A single global counter or accumulator that every tx writes is the classic bottleneck. Split it into N buckets and contention drops by ~N."
          />
          <Fix
            title="Account per user, not globally"
            body="Move shared running totals into per-account storage so independent users stop colliding on one slot."
          />
          <Fix
            title="Separate read and write paths"
            body="Reads that don't need the latest write can use a snapshot, taking them out of the conflict set entirely."
          />
        </div>
      </Section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section
        style={{
          marginTop: 40,
          padding: "28px clamp(20px, 4vw, 40px)",
          background: themeA.hintBg,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
        }}
      >
        <h2 style={{ fontSize: 22, color: themeA.text, margin: "0 0 10px", letterSpacing: "-0.01em" }}>
          This is one contract. pev can do it for yours.
        </h2>
        <p style={{ fontSize: 15, color: themeA.muted, lineHeight: 1.6, maxWidth: "58ch", margin: "0 0 20px" }}>
          A full contention report, slot-level, method-level, and trended over time, plus a
          per-contract API your team can wire into a dashboard or CI. Free to explore, built by Silk
          Nodes.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/graph" className="pev-graph-cta">
            See the live graph →
          </Link>
          <Link href={`/contract/${SUBJECT.address}`} className="pev-link" style={{ alignSelf: "center" }}>
            Open this contract in pev
          </Link>
        </div>
      </section>

      <p style={{ marginTop: 32 }}>
        <Link href="/" className="pev-link">
          ← back to pev
        </Link>
      </p>

      <SiteFooter />
    </main>
  );
}

/* ───────────────────────── components ───────────────────────── */

/**
 * The hero metaphor: many parallel lanes of traffic flowing fast, funneling
 * into one shared contract where they collide and serialize. SMIL-animated
 * so it renders server-side with no client JS.
 */
function ContentionDiagram() {
  const W = 1000;
  const H = 300;
  const laneYs = [44, 90, 136, 182, 228, 274 - 0]; // 6 inbound lanes
  const hubX = 560;
  const hubY = H / 2;
  const outX = 920;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        marginTop: 24,
        background: themeA.graphBg,
        borderRadius: themeA.radius,
        border: `1px solid ${themeA.border}`,
      }}
      role="img"
      aria-label="Parallel transactions colliding at a shared contract"
    >
      {/* left label */}
      <text x={28} y={26} fill={palette.sage} fontSize={13} fontFamily="var(--font-pev-mono), monospace">
        parallel · fast
      </text>
      {/* right label */}
      <text x={outX - 6} y={26} fill={palette.terracotta} fontSize={13} fontFamily="var(--font-pev-mono), monospace" textAnchor="end">
        collision · re-run
      </text>

      {/* inbound clean lanes */}
      {laneYs.map((y, i) => {
        const d = `M 20 ${y} C 240 ${y}, 360 ${hubY}, ${hubX - 40} ${hubY}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={palette.bone} strokeOpacity={0.1} strokeWidth={1.5} />
            {[0, 1, 2].map((k) => (
              <circle key={k} r={3} fill={palette.sage} opacity={0.85}>
                <animateMotion
                  dur={`${1.6 + (i % 3) * 0.25}s`}
                  begin={`-${(i * 0.2 + k * 0.6).toFixed(2)}s`}
                  repeatCount="indefinite"
                  path={d}
                />
              </circle>
            ))}
          </g>
        );
      })}

      {/* the shared-state hub */}
      <circle cx={hubX} cy={hubY} r={34} fill={palette.surface04} stroke={palette.terracotta} strokeWidth={2} />
      <circle cx={hubX} cy={hubY} r={34} fill="none" stroke={palette.terracotta} strokeOpacity={0.5} strokeWidth={2}>
        <animate attributeName="r" from="34" to="52" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" from="0.5" to="0" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <text x={hubX} y={hubY - 2} fill={themeA.text} fontSize={13} fontWeight={600} textAnchor="middle">
        shared
      </text>
      <text x={hubX} y={hubY + 14} fill={themeA.muted} fontSize={11} textAnchor="middle">
        state
      </text>
      <text x={hubX} y={hubY + 60} fill={themeA.subtle} fontSize={12} textAnchor="middle" fontFamily="var(--font-pev-mono), monospace">
        MarginAccount
      </text>

      {/* outbound: single serialized lane, red, spaced out (the jam) */}
      {(() => {
        const d = `M ${hubX + 40} ${hubY} C ${hubX + 140} ${hubY}, ${outX - 120} ${hubY}, ${outX} ${hubY}`;
        return (
          <g>
            <path d={d} fill="none" stroke={palette.terracotta} strokeOpacity={0.25} strokeWidth={3} />
            {[0, 1, 2, 3].map((k) => (
              <circle key={k} r={4} fill={palette.terracotta}>
                <animateMotion dur="2.6s" begin={`-${(k * 0.65).toFixed(2)}s`} repeatCount="indefinite" path={d} />
              </circle>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

function Stat({ big, label, sub, warn = false }: { big: string; label: string; sub: string; warn?: boolean }) {
  return (
    <div style={{ padding: "18px 18px", background: palette.surface02, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
      <div style={{ fontSize: 34, fontWeight: 600, color: warn ? palette.ember : themeA.text, letterSpacing: "-0.02em", lineHeight: 1 }}>
        {big}
      </div>
      <div style={{ fontSize: 14, color: themeA.text, marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: "24px 0 8px",
        padding: "18px 20px",
        background: palette.surface02,
        borderLeft: `3px solid ${palette.ember}`,
        borderRadius: themeA.radius,
        fontSize: 17,
        lineHeight: 1.6,
        color: themeA.text,
        maxWidth: "66ch",
      }}
    >
      {children}
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 40 }}>
      <div className="pev-eyebrow" style={{ marginBottom: 8 }}>{kicker}</div>
      <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", color: themeA.text, margin: "0 0 14px", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ColliderBar({ label, address, value, ofTotal }: { label: string; address: string; value: number; ofTotal: number }) {
  const pct = Math.round((value / ofTotal) * 100);
  return (
    <div style={{ marginTop: 18, maxWidth: "62ch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 15, color: themeA.text }}>
          {label} <span style={{ color: themeA.subtle, fontFamily: themeA.mono, fontSize: 12 }}>{short(address)}</span>
        </span>
        <span style={{ fontSize: 14, color: palette.ember, fontFamily: themeA.mono }}>{fmt(value)}</span>
      </div>
      <div style={{ height: 12, background: palette.surface03, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(pct, 4)}%`, height: "100%", background: palette.ember, opacity: 0.85 }} />
      </div>
      <div style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 6 }}>
        ~{pct}% of all collisions, from a single counterparty, in 7 days
      </div>
    </div>
  );
}

function Fix({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: "16px 16px", background: palette.surface02, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
      <div style={{ fontSize: 15, color: palette.sage, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}
