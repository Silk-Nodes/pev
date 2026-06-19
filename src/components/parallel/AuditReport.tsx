import { diagnose } from "@/lib/audit/diagnose";
import type { ContractAudit } from "@/lib/indexer/store";
import { themeA, palette } from "@/components/parallel/theme";

/**
 * AuditReport, the visual contention audit for one contract: headline
 * stats, storage-slot heatmap, root-cause diagnosis, and the fix shown as
 * a before/after diagram + code pattern. Pure render of a ContractAudit
 * (data is precomputed and cached upstream; this never touches the DB).
 * Used inline on /showcase as the worked example.
 */

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const shortSlot = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${Math.round(n / 1000)}K` : `${n}`;

export function AuditReport({ audit, refreshedAt }: { audit: ContractAudit; refreshedAt?: Date }) {
  const dx = diagnose(audit);
  const ratePct = audit.totals.conflictRate != null ? Math.round(audit.totals.conflictRate * 100) : null;
  const maxSlot = Math.max(...audit.hotSlots.map((s) => s.conflicts), 1);
  const maxMethod = Math.max(...audit.methods.map((m) => m.conflicts), 1);
  const totalKinds = audit.kinds.reduce((a, k) => a + k.count, 0) || 1;

  return (
    <div>
      {/* subject line */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ fontSize: 18, color: themeA.text, fontWeight: 600 }}>{audit.label ?? short(audit.address)}</span>
        <span style={{ fontFamily: themeA.mono, fontSize: 12, color: themeA.subtle }}>{short(audit.address)}</span>
      </div>

      {/* headline numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Stat big={audit.totals.txs != null ? fmtCompact(audit.totals.txs) : "—"} label="transactions touched" sub={audit.totals.txs != null ? `${fmt(audit.totals.txs)} in ${audit.windowDays}d` : "not sampled"} />
        <Stat big={audit.totals.conflicts != null ? fmtCompact(audit.totals.conflicts) : "—"} label="storage collisions" sub={audit.totals.conflicts != null ? `${fmt(audit.totals.conflicts)} re-runs forced` : "not sampled"} warn />
        <Stat big={ratePct != null ? `${ratePct}%` : "—"} label="collision rate" sub={ratePct != null ? `~${ratePct >= 60 ? "2 in 3" : ratePct >= 35 ? "1 in 3" : "some"} transactions` : "not sampled"} warn />
      </div>

      {/* diagnosis */}
      <SubHead>The diagnosis</SubHead>
      <div style={{ padding: "16px 18px", background: palette.surface02, borderLeft: `3px solid ${palette.terracotta}`, borderRadius: themeA.radius, maxWidth: "70ch", marginBottom: 28 }}>
        <p style={{ fontSize: 16, color: themeA.text, lineHeight: 1.55, margin: "0 0 12px" }}>{dx.headline}</p>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, color: themeA.muted, fontFamily: themeA.mono }}>
          {dx.hottestSlot && <span>hottest slot <strong style={{ color: palette.ember }}>{shortSlot(dx.hottestSlot)}</strong>{dx.hottestSlotConflicts != null ? ` · ${fmt(dx.hottestSlotConflicts)}` : ""}</span>}
          {dx.dominantKind && <span>kind <strong style={{ color: palette.terracotta }}>{dx.dominantKind}</strong></span>}
          {dx.topMethod && <span>top method <strong style={{ color: themeA.text }}>{dx.topMethod}</strong></span>}
        </div>
      </div>

      {/* heatmap */}
      {audit.hotSlots.length > 0 && (
        <>
          <SubHead>Storage slots ranked by collisions</SubHead>
          <p style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.6, maxWidth: "62ch", margin: "0 0 14px" }}>
            Each cell is a storage slot. Size and heat show how much contention it causes, the hot
            ones are where transactions queue up.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 28 }}>
            {audit.hotSlots.map((s) => {
              const rel = s.conflicts / maxSlot;
              const size = 60 + Math.round(rel * 60);
              return (
                <div key={s.slot} title={`${s.slot}\n${fmt(s.conflicts)} collisions · ${fmt(s.touches)} touches`}
                  style={{ width: size, height: size, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", background: `rgba(200,85,61,${0.1 + rel * 0.6})`, border: `1px solid rgba(226,140,82,${0.25 + rel * 0.5})`, borderRadius: themeA.radius, padding: 6, textAlign: "center" }}>
                  <span style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.text, opacity: 0.85 }}>{shortSlot(s.slot)}</span>
                  <span style={{ fontFamily: themeA.mono, fontSize: 12, color: palette.bone, fontWeight: 600, marginTop: 4 }}>{fmtCompact(s.conflicts)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* the fix */}
      <SubHead>The fix · {dx.fix.title}</SubHead>
      <p style={{ fontSize: 15, color: themeA.muted, lineHeight: 1.7, maxWidth: "64ch", margin: "0 0 16px" }}>{dx.fix.rationale}</p>
      <FixDiagram />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 14, marginTop: 16 }}>
        <CodeCard label="Before" tone="warn" code={dx.fix.before} />
        <CodeCard label="After" tone="good" code={dx.fix.after} />
      </div>
      <p style={{ fontSize: 12, color: themeA.subtle, lineHeight: 1.6, maxWidth: "64ch", marginTop: 12 }}>
        Illustrative pattern for the contention measured, not your exact code. Your team maps the slot
        to its variable instantly; Silk Nodes can do the rewrite and verify the drop.
      </p>

      {/* methods + kinds */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 28, marginTop: 32 }}>
        {audit.methods.length > 0 && (
          <div>
            <SubHead>Methods causing conflicts</SubHead>
            {audit.methods.map((m) => (
              <div key={m.selector} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: themeA.mono, marginBottom: 4 }}>
                  <span style={{ color: themeA.text }}>{m.selector}</span>
                  <span style={{ color: palette.ember }}>{fmtCompact(m.conflicts)}</span>
                </div>
                <Bar pct={(m.conflicts / maxMethod) * 100} color={palette.ember} />
              </div>
            ))}
            <p style={{ fontSize: 11, color: themeA.subtle, marginTop: 8 }}>4-byte selectors. Resolve to names with the contract&apos;s ABI.</p>
          </div>
        )}
        {audit.kinds.length > 0 && (
          <div>
            <SubHead>Conflict kinds (recent sample)</SubHead>
            {audit.kinds.map((k) => (
              <div key={k.kind} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: themeA.text }}>{k.kind}</span>
                  <span style={{ color: themeA.muted, fontFamily: themeA.mono }}>{Math.round((k.count / totalKinds) * 100)}%</span>
                </div>
                <Bar pct={(k.count / totalKinds) * 100} color={k.kind.includes("write-write") ? palette.terracotta : palette.amber} />
              </div>
            ))}
          </div>
        )}
      </div>

      {refreshedAt && (
        <p style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 20 }}>
          {audit.windowDays}-day window · updated {refreshedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          {audit.partial ? " · partial (a heavy aggregate was skipped to protect the indexer)" : ""}
        </p>
      )}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 8, background: palette.surface03, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(pct, 3)}%`, height: "100%", background: color, opacity: 0.85 }} />
    </div>
  );
}

function FixDiagram() {
  const writers = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 700 180" style={{ width: "100%", height: "auto", background: themeA.graphBg, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }} role="img" aria-label="Before and after storage layout">
      <text x={20} y={24} fill={palette.terracotta} fontSize={12} fontFamily="var(--font-pev-mono), monospace">before · one shared slot</text>
      <text x={380} y={24} fill={palette.sage} fontSize={12} fontFamily="var(--font-pev-mono), monospace">after · sharded</text>
      {writers.map((i) => <line key={i} x1={30} y1={50 + i * 24} x2={150} y2={110} stroke={palette.terracotta} strokeOpacity={0.4} strokeWidth={1.4} />)}
      {writers.map((i) => <circle key={i} cx={26} cy={50 + i * 24} r={4} fill={palette.bone} opacity={0.7} />)}
      <rect x={150} y={92} width={36} height={36} rx={3} fill="rgba(200,85,61,0.7)" stroke={palette.terracotta} />
      <text x={168} y={146} fill={themeA.muted} fontSize={10} textAnchor="middle" fontFamily="var(--font-pev-mono), monospace">collide</text>
      <line x1={350} y1={36} x2={350} y2={160} stroke={themeA.border} strokeWidth={1} />
      {writers.map((i) => <line key={i} x1={400} y1={50 + i * 24} x2={560} y2={50 + i * 24} stroke={palette.sage} strokeOpacity={0.4} strokeWidth={1.4} />)}
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
    <div style={{ padding: "16px 16px", background: palette.surface02, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius }}>
      <div style={{ fontSize: 30, fontWeight: 600, color: warn ? palette.ember : themeA.text, letterSpacing: "-0.02em", lineHeight: 1 }}>{big}</div>
      <div style={{ fontSize: 13, color: themeA.text, marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <div className="pev-eyebrow" style={{ marginBottom: 10 }}>{children}</div>;
}
