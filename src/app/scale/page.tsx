import Link from "next/link";
import type { Metadata } from "next";
import { getCachedGrowth, type GrowthData, type GrowthDay } from "@/lib/indexer/store";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

/**
 * /scale, how Monad is growing at the execution layer.
 *
 * Three questions in one page: is throughput growing, is the working
 * surface (active contracts) expanding, and is the chain holding its
 * parallelism as it scales. Reads ONLY the precomputed growth_cache row;
 * the aggregation happens out-of-band in scripts/refresh-growth.ts.
 * See [[pev-db-contention]].
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Monad at scale: throughput, contracts, and parallelism" },
  description:
    "How Monad is growing at the execution layer: transactions per day, contracts becoming active, and whether the chain holds its parallelism as it scales. Measured from pev's per-block execution traces.",
  alternates: { canonical: "/scale" },
  openGraph: {
    title: "Monad at scale",
    description:
      "Throughput, active contracts, and parallelism as Monad grows. From pev's execution traces.",
    type: "website",
    url: "/scale",
  },
};

const fmt = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) =>
  n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(2)}B`
  : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${Math.round(n / 1000)}K` : `${n}`;

export default async function ScalePage() {
  let got: { data: GrowthData; refreshedAt: Date } | null = null;
  try {
    got = await getCachedGrowth();
  } catch {
    got = null;
  }

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 80px", maxWidth: 1280, margin: "0 auto" }}>
      <SiteHeader
        variant="internal"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>scale</Crumb>
          </>
        }
      />

      <section style={{ marginBottom: 28 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>Chain growth · execution layer</div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(30px, 4.5vw, 48px)", color: themeA.text,
            margin: "0 0 16px", letterSpacing: "-0.01em", lineHeight: 1.1,
          }}
        >
          Monad is scaling. Is the parallelism holding?
        </h1>
        <p style={{ fontSize: 16, color: themeA.muted, lineHeight: 1.7, maxWidth: "64ch", margin: 0 }}>
          Transaction counts are easy to find. What nobody tracks is whether a growing chain keeps
          the parallelism it was designed for. pev traces every block, so we can watch throughput,
          the number of contracts actually running, and execution health together.
        </p>
      </section>

      {!got ? (
        <div style={{
          padding: "24px 20px", background: palette.surface03,
          border: `1px dashed ${themeA.border}`, borderRadius: themeA.radius,
          color: themeA.muted, fontSize: 14, lineHeight: 1.6, maxWidth: "62ch",
        }}>
          <div style={{ color: themeA.text, fontSize: 16, marginBottom: 8 }}>Warming up</div>
          This page reads a precomputed payload so it never runs heavy queries on a visit. It fills
          in once the growth refresh has run.
        </div>
      ) : (
        <Report data={got.data} refreshedAt={got.refreshedAt} />
      )}

      <p style={{ marginTop: 32 }}>
        <Link href="/" className="pev-link">← back to pev</Link>
      </p>
      <SiteFooter />
    </main>
  );
}

function Report({ data, refreshedAt }: { data: GrowthData; refreshedAt: Date }) {
  const d = data.daily;
  const w = data.newContracts;
  const totalNew = w.reduce((a, x) => a + x.newContracts, 0);

  return (
    <>
      {/* headline totals */}
      <section style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 12, marginBottom: 34,
      }}>
        <Stat big={compact(data.totals.txs)} label="transactions traced" sub={`${data.windowDays}-day window`} />
        <Stat big={compact(data.totals.blocks)} label="blocks analyzed" sub={`${fmt(data.totals.blocks)} total`} />
        {w.length > 0 && (
          <Stat big={compact(totalNew)} label="contracts newly active" sub="in this window" tone={palette.sage} />
        )}
        <Stat
          big={data.totals.contractsTracked != null ? compact(data.totals.contractsTracked) : "—"}
          label="contracts tracked"
          sub="ever seen executing"
        />
      </section>

      {/* 1 · throughput */}
      <Section
        kicker="Throughput"
        title="More transactions, every week"
        note={data.deltas.txsPct != null
          ? `${data.deltas.txsPct > 0 ? "+" : ""}${data.deltas.txsPct}% first week vs last`
          : undefined}
        noteTone={data.deltas.txsPct != null && data.deltas.txsPct > 0 ? palette.sage : themeA.muted}
      >
        <Bars days={d} pick={(x) => x.txs} color={palette.sage} label="transactions per day" unit="transactions" />
      </Section>

      {/* 2 · working surface */}
      {w.length > 0 && (
        <Section
          kicker="Working surface"
          title="More contracts actually running"
          note={`${fmt(totalNew)} became active`}
          noteTone={palette.sage}
        >
          <WeekBars weeks={w} />
          <p style={{ fontSize: 13, color: themeA.subtle, lineHeight: 1.6, marginTop: 12, maxWidth: "62ch" }}>
            Counted the first time a contract actually executes, not when it&apos;s deployed. A
            deployed contract nobody calls doesn&apos;t add anything to the chain.
          </p>
        </Section>
      )}

      {/* 3 · execution health */}
      <Section
        kicker="Execution health"
        title="Does the parallelism hold?"
        note={data.deltas.cpbPct != null
          ? `conflicts per block ${data.deltas.cpbPct > 0 ? "+" : ""}${data.deltas.cpbPct}%`
          : undefined}
        noteTone={data.deltas.cpbPct != null && data.deltas.cpbPct > 0 ? palette.ember : palette.sage}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <div>
            <Bars days={d} pick={(x) => x.avgScore} color={palette.bone} label="parallelism score (0-100)" max={100} unit="/100 parallelism score" />
          </div>
          <div>
            <Bars days={d} pick={(x) => x.cpb} color={palette.ember} label="conflicts per block" unit="conflicts per block" />
          </div>
        </div>
        <p style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.7, marginTop: 14, maxWidth: "64ch" }}>
          This is the pair that matters. Throughput can grow while the chain quietly does more
          duplicate work: every conflict is a transaction Monad executed, threw away, and ran
          again. Watching the two together is the only way to tell real scaling from busywork.
        </p>
      </Section>

      {/* CTA */}
      <section style={{
        marginTop: 44, padding: "26px clamp(20px, 4vw, 40px)",
        background: themeA.hintBg, border: `1px solid ${themeA.border}`, borderRadius: themeA.radius,
      }}>
        <h2 style={{ fontSize: 21, color: themeA.text, margin: "0 0 10px" }}>
          Where does your contract sit?
        </h2>
        <p style={{ fontSize: 15, color: themeA.muted, lineHeight: 1.6, maxWidth: "58ch", margin: "0 0 18px" }}>
          The chain-wide numbers are an average of very different contracts. pev shows exactly which
          storage slots and methods drive your own contention, and whether a change you ship
          actually moved it.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/showcase" className="pev-graph-cta">See a contract audit →</Link>
          <Link href="/graph" className="pev-link" style={{ alignSelf: "center" }}>Explore the graph</Link>
        </div>
      </section>

      <p style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 16 }}>
        {data.windowDays}-day window · updated {refreshedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        {data.partial ? " · partial (a heavy aggregate was skipped to protect the indexer)" : ""}
        {" · pev indexes from the block it was started, not chain genesis"}
      </p>
    </>
  );
}

/* ── charts (server-rendered SVG, no client JS) ── */

function Bars({
  days, pick, color, label, max, unit,
}: {
  days: GrowthDay[]; pick: (d: GrowthDay) => number; color: string;
  label: string; max?: number; unit?: string;
}) {
  const vals = days.map(pick);
  const hi = max ?? Math.max(...vals, 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 150 }}>
        {days.map((d, i) => {
          const v = pick(d);
          const pctH = Math.max((v / hi) * 100, v > 0 ? 1 : 0);
          return (
            <div key={d.day} className="pev-col">
              <div
                className="pev-col-bar"
                style={{
                  height: `${pctH}%`,
                  background: color,
                  opacity: 0.55 + 0.45 * (i / Math.max(days.length - 1, 1)),
                }}
              />
              <span className="pev-col-tip">
                <b>{fmt(Math.round(v * 100) / 100)}</b>{unit ? ` ${unit}` : ""}
                <i>{d.day}</i>
                <i>{fmt(d.txs)} txs · {fmt(d.blocks)} blocks</i>
                <i>score {d.avgScore} · {d.cpb} conflicts/block</i>
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ height: 1, background: themeA.border }} />
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle, marginTop: 6,
      }}>
        <span>{label}</span>
        <span>{days[0]?.day} → {days[days.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: { week: string; newContracts: number }[] }) {
  const hi = Math.max(...weeks.map((w) => w.newContracts), 1);
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150 }}>
        {weeks.map((w) => (
          <div key={w.week} className="pev-col">
            <div
              className="pev-col-bar"
              style={{
                height: `${Math.max((w.newContracts / hi) * 100, 2)}%`,
                background: palette.sage, opacity: 0.85,
              }}
            />
            <span className="pev-col-tip">
              <b>{fmt(w.newContracts)}</b> contracts
              <i>week of {w.week}</i>
              <i>first seen executing</i>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {weeks.map((w) => (
          <div key={w.week} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: themeA.mono, fontSize: 12, color: themeA.text }}>
              {compact(w.newContracts)}
            </div>
            <div style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.subtle, marginTop: 2 }}>
              {w.week.slice(5)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Section({
  kicker, title, note, noteTone, children,
}: {
  kicker: string; title: string; note?: string; noteTone?: string; children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 40 }}>
      <div className="pev-eyebrow" style={{ marginBottom: 8 }}>{kicker}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ fontSize: "clamp(20px, 2.8vw, 28px)", color: themeA.text, margin: 0, letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        {note && (
          <span style={{ fontFamily: themeA.mono, fontSize: 13, color: noteTone ?? themeA.muted }}>
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({ big, label, sub, tone }: { big: string; label: string; sub: string; tone?: string }) {
  return (
    <div style={{
      padding: "18px 18px", background: palette.surface02,
      border: `1px solid ${themeA.border}`, borderRadius: themeA.radius,
    }}>
      <div style={{ fontSize: 32, fontWeight: 600, color: tone ?? themeA.text, letterSpacing: "-0.02em", lineHeight: 1 }}>
        {big}
      </div>
      <div style={{ fontSize: 13, color: themeA.text, marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 4 }}>{sub}</div>
    </div>
  );
}
