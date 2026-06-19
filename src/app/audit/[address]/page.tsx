import Link from "next/link";
import type { Metadata } from "next";
import { getContractAudit, type ContractAudit } from "@/lib/indexer/store";
import { diagnose } from "@/lib/audit/diagnose";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

/**
 * /audit/[address], a real per-contract contention audit: where a
 * contract collides on storage, why, and how to fix it, built from pev's
 * execution traces. Reads ONLY the precomputed cache (one PK lookup); the
 * heavy analysis happens out-of-band in scripts/contract-audit.ts. Never
 * aggregates on a page request. See [[pev-db-contention]].
 */

export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ address: string }>;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const shortSlot = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${Math.round(n / 1000)}K` : `${n}`;

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { address } = await params;
  const got = await getContractAudit(address).catch(() => null);
  const name = got?.audit.label ?? short(address);
  return {
    title: { absolute: `${name}: contention audit` },
    description: `Where ${name} collides on storage on Monad mainnet, why, and how to fix it. A parallel-execution audit from pev's per-block traces.`,
    alternates: { canonical: `/audit/${address.toLowerCase()}` },
  };
}

export default async function AuditPage({ params }: PageParams) {
  const { address } = await params;
  const lower = address.toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(lower);

  let got: { audit: ContractAudit; refreshedAt: Date } | null = null;
  if (valid) got = await getContractAudit(lower).catch(() => null);

  const name = got?.audit.label ?? short(lower);

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 96px", maxWidth: 1100, margin: "0 auto" }}>
      <SiteHeader
        variant="internal"
        tagline="Contention audit"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/showcase">audit</Crumb>
            <CrumbSep />
            <Crumb current>{short(lower)}</Crumb>
          </>
        }
      />

      <section style={{ marginBottom: 24 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
          Contention audit · Monad mainnet
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(30px, 4.5vw, 48px)",
            color: themeA.text,
            margin: "0 0 12px",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          {name}
        </h1>
        <p style={{ fontFamily: themeA.mono, fontSize: 13, color: themeA.subtle, margin: 0 }}>
          {lower}
        </p>
      </section>

      {!valid ? (
        <EmptyState title="That doesn't look like an address" body="Pass a 40-character 0x address." />
      ) : !got ? (
        <EmptyState
          title="Not analyzed yet"
          body="This contract hasn't been profiled. Audits are precomputed out-of-band (npm run audit:contract -- <address>) so the page never runs heavy queries on a request."
        />
      ) : (
        <Report audit={got.audit} refreshedAt={got.refreshedAt} />
      )}

      <p style={{ marginTop: 32 }}>
        <Link href="/showcase" className="pev-link">
          ← how pev audits a contract
        </Link>
      </p>
      <SiteFooter />
    </main>
  );
}

function Report({ audit, refreshedAt }: { audit: ContractAudit; refreshedAt: Date }) {
  const dx = diagnose(audit);
  const ratePct = audit.totals.conflictRate != null ? Math.round(audit.totals.conflictRate * 100) : null;
  const maxSlot = Math.max(...audit.hotSlots.map((s) => s.conflicts), 1);
  const maxMethod = Math.max(...audit.methods.map((m) => m.conflicts), 1);
  const totalKinds = audit.kinds.reduce((a, k) => a + k.count, 0) || 1;

  return (
    <>
      {/* headline numbers */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 8 }}>
        <Stat big={audit.totals.txs != null ? fmtCompact(audit.totals.txs) : "—"} label="transactions touched" sub={audit.totals.txs != null ? `${fmt(audit.totals.txs)} in ${audit.windowDays}d` : "not sampled"} />
        <Stat big={audit.totals.conflicts != null ? fmtCompact(audit.totals.conflicts) : "—"} label="storage collisions" sub={audit.totals.conflicts != null ? `${fmt(audit.totals.conflicts)} re-runs forced` : "not sampled"} warn />
        <Stat big={ratePct != null ? `${ratePct}%` : "—"} label="collision rate" sub={ratePct != null ? `~${ratePct >= 60 ? "2 in 3" : ratePct >= 35 ? "1 in 3" : "some"} transactions` : "not sampled"} warn />
      </section>

      {/* diagnosis */}
      <Section kicker="The diagnosis" title="What's slowing this contract down">
        <div style={{ padding: "18px 20px", background: palette.surface02, borderLeft: `3px solid ${palette.terracotta}`, borderRadius: themeA.radius, maxWidth: "70ch" }}>
          <p style={{ fontSize: 17, color: themeA.text, lineHeight: 1.55, margin: "0 0 12px" }}>{dx.headline}</p>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: themeA.muted, fontFamily: themeA.mono }}>
            {dx.hottestSlot && (
              <span>hottest slot <strong style={{ color: palette.ember }}>{shortSlot(dx.hottestSlot)}</strong>{dx.hottestSlotConflicts != null ? ` · ${fmt(dx.hottestSlotConflicts)} collisions` : ""}</span>
            )}
            {dx.dominantKind && <span>kind <strong style={{ color: palette.terracotta }}>{dx.dominantKind}</strong></span>}
            {dx.topMethod && <span>top method <strong style={{ color: themeA.text }}>{dx.topMethod}</strong></span>}
          </div>
        </div>
      </Section>

      {/* storage heatmap */}
      {audit.hotSlots.length > 0 && (
        <Section kicker="Where it hurts" title="Storage slots ranked by collisions">
          <p style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.6, maxWidth: "62ch", margin: "0 0 16px" }}>
            Each cell is a storage slot in this contract. Size and heat show how much contention it
            causes. The hot ones are where transactions queue up.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {audit.hotSlots.map((s) => {
              const rel = s.conflicts / maxSlot;
              const size = 64 + Math.round(rel * 64);
              return (
                <div
                  key={s.slot}
                  title={`${s.slot}\n${fmt(s.conflicts)} collisions · ${fmt(s.touches)} touches`}
                  style={{
                    width: size,
                    height: size,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    background: `rgba(200,85,61,${0.1 + rel * 0.6})`,
                    border: `1px solid rgba(226,140,82,${0.25 + rel * 0.5})`,
                    borderRadius: themeA.radius,
                    padding: 6,
                    textAlign: "center",
                  }}
                >
                  <span style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.text, opacity: 0.85 }}>{shortSlot(s.slot)}</span>
                  <span style={{ fontFamily: themeA.mono, fontSize: 12, color: palette.bone, fontWeight: 600, marginTop: 4 }}>{fmtCompact(s.conflicts)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* the fix, shown */}
      <Section kicker="The fix" title={dx.fix.title}>
        <p style={{ fontSize: 16, color: themeA.muted, lineHeight: 1.7, maxWidth: "64ch", margin: "0 0 18px" }}>{dx.fix.rationale}</p>
        <FixDiagram pattern={dx.pattern} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginTop: 18 }}>
          <CodeCard label="Before" tone="warn" code={dx.fix.before} />
          <CodeCard label="After" tone="good" code={dx.fix.after} />
        </div>
        <p style={{ fontSize: 12, color: themeA.subtle, lineHeight: 1.6, maxWidth: "64ch", marginTop: 14 }}>
          The snippet is the standard pattern for the contention we measured, illustrative, not your
          exact code. Your team maps the slot to its variable instantly; Silk Nodes can do the full
          rewrite and verify the contention drop.
        </p>
      </Section>

      {/* methods + kinds */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 28, marginTop: 40 }}>
        {audit.methods.length > 0 && (
          <div>
            <div className="pev-eyebrow" style={{ marginBottom: 12 }}>Methods causing conflicts</div>
            {audit.methods.map((m) => (
              <div key={m.selector} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: themeA.mono, marginBottom: 4 }}>
                  <span style={{ color: themeA.text }}>{m.selector}</span>
                  <span style={{ color: palette.ember }}>{fmtCompact(m.conflicts)}</span>
                </div>
                <div style={{ height: 8, background: palette.surface03, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${Math.max((m.conflicts / maxMethod) * 100, 3)}%`, height: "100%", background: palette.ember, opacity: 0.85 }} />
                </div>
              </div>
            ))}
            <p style={{ fontSize: 11, color: themeA.subtle, marginTop: 8 }}>4-byte function selectors. Resolve to names with the contract&apos;s ABI.</p>
          </div>
        )}
        {audit.kinds.length > 0 && (
          <div>
            <div className="pev-eyebrow" style={{ marginBottom: 12 }}>Conflict kinds (recent sample)</div>
            {audit.kinds.map((k) => (
              <div key={k.kind} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: themeA.text }}>{k.kind}</span>
                  <span style={{ color: themeA.muted, fontFamily: themeA.mono }}>{Math.round((k.count / totalKinds) * 100)}%</span>
                </div>
                <div style={{ height: 8, background: palette.surface03, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${Math.max((k.count / totalKinds) * 100, 3)}%`, height: "100%", background: k.kind.includes("write-write") ? palette.terracotta : palette.amber }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CTA */}
      <section style={{ marginTop: 44, padding: "26px clamp(20px, 4vw, 40px)", background: themeA.hintBg, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
        <h2 style={{ fontSize: 21, color: themeA.text, margin: "0 0 10px" }}>Want the full audit for your protocol?</h2>
        <p style={{ fontSize: 15, color: themeA.muted, lineHeight: 1.6, maxWidth: "58ch", margin: "0 0 18px" }}>
          Every contention source, the exact slots and methods, the architecture changes with the
          highest ROI, and the verified contention drop after the fix. Built from Monad mainnet data
          by Silk Nodes.
        </p>
        <a href="mailto:info@silknodes.io?subject=pev%20protocol%20audit" className="pev-graph-cta">
          Request a protocol audit →
        </a>
      </section>

      <p style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 16 }}>
        {audit.windowDays}-day window · updated {refreshedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        {audit.partial ? " · partial (a heavy aggregate was skipped to protect the indexer)" : ""}
      </p>
    </>
  );
}

/* ── small components ── */

function FixDiagram({ pattern }: { pattern: string }) {
  // before: many arrows into one red cell. after: spread into green cells.
  const writers = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 700 180" style={{ width: "100%", height: "auto", background: themeA.graphBg, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }} role="img" aria-label="Before and after storage layout">
      <text x={20} y={24} fill={palette.terracotta} fontSize={12} fontFamily="var(--font-pev-mono), monospace">before · one shared slot</text>
      <text x={380} y={24} fill={palette.sage} fontSize={12} fontFamily="var(--font-pev-mono), monospace">after · sharded</text>
      {/* before: writers -> one cell */}
      {writers.map((i) => {
        const y = 50 + i * 24;
        return <line key={i} x1={30} y1={y} x2={150} y2={110} stroke={palette.terracotta} strokeOpacity={0.4} strokeWidth={1.4} />;
      })}
      {writers.map((i) => <circle key={i} cx={26} cy={50 + i * 24} r={4} fill={palette.bone} opacity={0.7} />)}
      <rect x={150} y={92} width={36} height={36} rx={3} fill="rgba(200,85,61,0.7)" stroke={palette.terracotta} />
      <text x={168} y={146} fill={themeA.muted} fontSize={10} textAnchor="middle" fontFamily="var(--font-pev-mono), monospace">collide</text>
      {/* divider */}
      <line x1={350} y1={36} x2={350} y2={160} stroke={themeA.border} strokeWidth={1} />
      {/* after: writers -> own shard cells */}
      {writers.map((i) => {
        const y = 50 + i * 24;
        return <line key={i} x1={400} y1={y} x2={560} y2={y} stroke={palette.sage} strokeOpacity={0.4} strokeWidth={1.4} />;
      })}
      {writers.map((i) => <circle key={i} cx={396} cy={50 + i * 24} r={4} fill={palette.bone} opacity={0.7} />)}
      {writers.map((i) => <rect key={i} x={560} y={50 + i * 24 - 9} width={18} height={18} rx={2} fill="rgba(168,196,135,0.5)" stroke={palette.sage} />)}
      <text x={600} y={146} fill={themeA.muted} fontSize={10} textAnchor="middle" fontFamily="var(--font-pev-mono), monospace">parallel</text>
    </svg>
  );
}

function CodeCard({ label, tone, code }: { label: string; tone: "warn" | "good"; code: string }) {
  const accent = tone === "warn" ? palette.terracotta : palette.sage;
  return (
    <div style={{ background: palette.surface00, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${themeA.border}`, fontSize: 11, fontFamily: themeA.mono, color: accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <pre style={{ margin: 0, padding: "14px 14px", fontSize: 12.5, lineHeight: 1.5, color: themeA.text, fontFamily: themeA.mono, overflowX: "auto", whiteSpace: "pre" }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Stat({ big, label, sub, warn = false }: { big: string; label: string; sub: string; warn?: boolean }) {
  return (
    <div style={{ padding: "18px 18px", background: palette.surface02, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
      <div style={{ fontSize: 32, fontWeight: 600, color: warn ? palette.ember : themeA.text, letterSpacing: "-0.02em", lineHeight: 1 }}>{big}</div>
      <div style={{ fontSize: 14, color: themeA.text, marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 40 }}>
      <div className="pev-eyebrow" style={{ marginBottom: 8 }}>{kicker}</div>
      <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", color: themeA.text, margin: "0 0 14px", letterSpacing: "-0.01em", lineHeight: 1.2 }}>{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: "24px 20px", background: palette.surface03, border: `1px dashed ${themeA.border}`, borderRadius: themeA.radius, color: themeA.muted, fontSize: 14, lineHeight: 1.6, maxWidth: "60ch" }}>
      <div style={{ color: themeA.text, fontSize: 16, marginBottom: 8 }}>{title}</div>
      {body}
    </div>
  );
}
