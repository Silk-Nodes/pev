import Link from "next/link";
import type { Metadata } from "next";
import { getContractAudit, type ContractAudit } from "@/lib/indexer/store";
import { AuditReport } from "@/components/parallel/AuditReport";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

/**
 * /showcase, the single page that tells the whole pev-for-protocols story:
 * what contention is (explainer), pev on a REAL contract (the live worked
 * example, inline), what you get, and how to get your own audit (CTA).
 *
 * Reads only the precomputed audit cache for the featured contract (one PK
 * lookup). No heavy aggregation on the request path. See [[pev-db-contention]].
 */

export const dynamic = "force-dynamic";

// The flagship contract for the worked example.
const FEATURED = "0x34b6552d57a35a1d042ccae1951bd1c370112a6f"; // Perpl

export const metadata: Metadata = {
  title: { absolute: "What pev shows a protocol team: contention, costed and fixed" },
  description:
    "pev profiles your Monad contract's storage contention: where it collides, what it costs in re-execution, and how to fix it. A live worked example plus a protocol audit you can request.",
  alternates: { canonical: "/showcase" },
  openGraph: {
    title: "What pev shows a protocol team",
    description:
      "Where a Monad contract collides on storage, what it costs, and how to fix it. pev's parallel-execution profiler, with a live worked example.",
    type: "website",
    url: "/showcase",
  },
};

const DELIVERABLES = [
  "Top contention sources, ranked",
  "The exact storage slots colliding",
  "Method-level collision breakdown",
  "Who your contract collides with",
  "Conflict kinds (write-write vs read-write)",
  "Architecture changes by ROI",
  "Historical contention trend",
  "Per-contract API access",
];

export default async function ShowcasePage() {
  let live: { audit: ContractAudit; refreshedAt: Date } | null = null;
  try {
    live = await getContractAudit(FEATURED);
  } catch {
    live = null;
  }

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
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>For protocol teams · Monad mainnet</div>
        <h1 className="pev-display-italic" style={{ fontSize: "clamp(32px, 5.2vw, 56px)", color: themeA.text, margin: "0 0 16px", letterSpacing: "-0.01em", lineHeight: 1.08 }}>
          Find what&apos;s quietly throttling your protocol.
        </h1>
        <p style={{ fontSize: 17, color: themeA.muted, lineHeight: 1.65, maxWidth: "60ch", margin: 0 }}>
          Monad runs transactions <strong style={{ color: themeA.text }}>in parallel</strong>. But when
          many touch the <strong style={{ color: palette.terracotta }}>same storage</strong>, they
          collide and have to re-run one at a time. That hidden serialization caps your throughput.
          pev traces every block and shows you exactly where it happens, and how to fix it.
        </p>
      </section>

      <ContentionDiagram />

      {/* ── The live worked example ───────────────────────────────── */}
      <section style={{ marginTop: 44 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 8 }}>A real contract, audited</div>
        <h2 style={{ fontSize: "clamp(24px, 3.4vw, 34px)", color: themeA.text, margin: "0 0 18px", letterSpacing: "-0.01em" }}>
          Here&apos;s pev on a live Monad contract
        </h2>
        {live ? (
          <AuditReport audit={live.audit} refreshedAt={live.refreshedAt} />
        ) : (
          <div style={{ padding: "24px 20px", background: palette.surface03, border: `1px dashed ${themeA.border}`, borderRadius: themeA.radius, color: themeA.muted, fontSize: 14, lineHeight: 1.6, maxWidth: "62ch" }}>
            <div style={{ color: themeA.text, fontSize: 16, marginBottom: 8 }}>Live example warming up</div>
            The worked example is precomputed out-of-band (so this page never runs a heavy query on a
            visit). It appears here as soon as the audit job has run for the featured contract.
          </div>
        )}
      </section>

      {/* ── What you get ──────────────────────────────────────────── */}
      <section style={{ marginTop: 48 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 8 }}>What pev delivers to your team</div>
        <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", color: themeA.text, margin: "0 0 18px", letterSpacing: "-0.01em" }}>
          A full contract performance audit
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {DELIVERABLES.map((d) => (
            <div key={d} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", background: palette.surface02, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
              <span style={{ color: palette.sage, fontSize: 15, lineHeight: 1.4 }}>✓</span>
              <span style={{ fontSize: 14, color: themeA.text, lineHeight: 1.4 }}>{d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why it matters ────────────────────────────────────────── */}
      <section style={{ marginTop: 44 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 8 }}>Why it matters</div>
        <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", color: themeA.text, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
          Every collision is work the chain did twice
        </h2>
        <p style={{ fontSize: 16, color: themeA.muted, lineHeight: 1.7, maxWidth: "62ch" }}>
          Monad executes optimistically in parallel, then re-runs any transaction whose reads or
          writes conflicted with an earlier one. High contention means more re-execution: wasted
          compute, higher latency under load, and a lower <em>effective</em> throughput than the chain
          could deliver. Cutting contention is the single highest-leverage performance win for a busy
          contract, and almost nobody can see it today. pev can.
        </p>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section style={{ marginTop: 44, padding: "30px clamp(20px, 4vw, 44px)", background: themeA.hintBg, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
        <h2 style={{ fontSize: 24, color: themeA.text, margin: "0 0 10px", letterSpacing: "-0.01em" }}>Audit your contract</h2>
        <p style={{ fontSize: 15, color: themeA.muted, lineHeight: 1.6, maxWidth: "58ch", margin: "0 0 20px" }}>
          We&apos;ll identify your biggest contention sources, the contracts colliding with you, the
          storage slots forcing re-execution, and the architecture changes with the highest ROI, all
          from Monad mainnet data. Built by Silk Nodes.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <a href="mailto:info@silknodes.io?subject=pev%20protocol%20audit" className="pev-graph-cta">
            Request a protocol audit →
          </a>
          <Link href="/graph" className="pev-link" style={{ alignSelf: "center" }}>
            Explore the contract graph
          </Link>
        </div>
      </section>

      <p style={{ marginTop: 32 }}>
        <Link href="/" className="pev-link">← back to pev</Link>
      </p>
      <SiteFooter />
    </main>
  );
}

/**
 * The hero metaphor: parallel lanes of traffic flowing fast, funneling into
 * one shared contract where they collide and serialize. SMIL-animated, no
 * client JS.
 */
function ContentionDiagram() {
  const W = 1000;
  const H = 300;
  const laneYs = [44, 90, 136, 182, 228, 274];
  const hubX = 560;
  const hubY = H / 2;
  const outX = 920;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", marginTop: 24, background: themeA.graphBg, borderRadius: themeA.radius, border: `1px solid ${themeA.border}` }} role="img" aria-label="Parallel transactions colliding at a shared contract">
      <text x={28} y={26} fill={palette.sage} fontSize={13} fontFamily="var(--font-pev-mono), monospace">parallel · fast</text>
      <text x={outX - 6} y={26} fill={palette.terracotta} fontSize={13} fontFamily="var(--font-pev-mono), monospace" textAnchor="end">collision · re-run</text>
      {laneYs.map((y, i) => {
        const d = `M 20 ${y} C 240 ${y}, 360 ${hubY}, ${hubX - 40} ${hubY}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={palette.bone} strokeOpacity={0.1} strokeWidth={1.5} />
            {[0, 1, 2].map((k) => (
              <circle key={k} r={3} fill={palette.sage} opacity={0.85}>
                <animateMotion dur={`${1.6 + (i % 3) * 0.25}s`} begin={`-${(i * 0.2 + k * 0.6).toFixed(2)}s`} repeatCount="indefinite" path={d} />
              </circle>
            ))}
          </g>
        );
      })}
      <circle cx={hubX} cy={hubY} r={34} fill={palette.surface04} stroke={palette.terracotta} strokeWidth={2} />
      <circle cx={hubX} cy={hubY} r={34} fill="none" stroke={palette.terracotta} strokeOpacity={0.5} strokeWidth={2}>
        <animate attributeName="r" from="34" to="52" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" from="0.5" to="0" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <text x={hubX} y={hubY - 2} fill={themeA.text} fontSize={13} fontWeight={600} textAnchor="middle">shared</text>
      <text x={hubX} y={hubY + 14} fill={themeA.muted} fontSize={11} textAnchor="middle">state</text>
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
