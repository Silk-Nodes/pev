import Link from "next/link";
import type { Metadata } from "next";
import {
  getCachedGrowth,
  type GrowthData,
  type GrowthDay,
  type MonadRelease,
  type WaveBucket,
  type SlotConcentration,
} from "@/lib/indexer/store";
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

export default async function ScalePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w } = await searchParams;
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
        <Report data={got.data} refreshedAt={got.refreshedAt} window={w} />
      )}

      <p style={{ marginTop: 32 }}>
        <Link href="/" className="pev-link">← back to pev</Link>
      </p>
      <SiteFooter />
    </main>
  );
}

/** Split the series into two halves and compare, so every window gets an
 *  honest "start vs end" delta rather than a fixed 7-day comparison. */
function halvesDelta(days: GrowthDay[]) {
  const pct = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);
  if (days.length < 4) return { txsPct: null, scorePct: null, cpbPct: null };
  const half = Math.floor(days.length / 2);
  const A = days.slice(0, half);
  const B = days.slice(-half);
  const sum = (xs: GrowthDay[], k: "txs" | "blocks" | "conflicts") =>
    xs.reduce((a, x) => a + x[k], 0);
  const mean = (xs: GrowthDay[]) => xs.reduce((a, x) => a + x.avgScore, 0) / xs.length;
  return {
    txsPct: pct(sum(A, "txs"), sum(B, "txs")),
    scorePct: pct(mean(A), mean(B)),
    cpbPct: pct(
      sum(A, "conflicts") / Math.max(sum(A, "blocks"), 1),
      sum(B, "conflicts") / Math.max(sum(B, "blocks"), 1),
    ),
  };
}

function Report({
  data, refreshedAt, window: windowParam,
}: {
  data: GrowthData; refreshedAt: Date; window?: string;
}) {
  // Drop incomplete edge days. The first indexed day and today are both
  // partial (pev started mid-day; today is still running), so they render
  // as artificially short bars and drag the deltas. A day counts as
  // complete if it has at least 70% of the median day's blocks.
  const all = (() => {
    const src = data.daily;
    if (src.length < 3) return src;
    const med = [...src.map((x) => x.blocks)].sort((a, b) => a - b)[Math.floor(src.length / 2)];
    const floor = med * 0.7;
    let lo = 0;
    let hi = src.length - 1;
    if (src[lo].blocks < floor) lo += 1;
    if (src[hi].blocks < floor) hi -= 1;
    return src.slice(lo, hi + 1);
  })();
  // Only offer windows the index can actually fill, no empty tabs.
  const choices = [7, 30, 90, 365].filter((n) => all.length >= n);
  const picked = Number(windowParam);
  const valid = choices.includes(picked);
  // Default to the full indexed range: the widest honest view.
  const isAll = !valid;
  const active = valid ? picked : 0;
  const d = isAll ? all : all.slice(-picked);

  // Weeks that fall inside the visible day range.
  const firstDay = d[0]?.day ?? "";
  const w = data.newContracts.filter((x) => x.week >= firstDay.slice(0, 10));
  const totalNew = w.reduce((a, x) => a + x.newContracts, 0);

  const totals = {
    blocks: d.reduce((a, x) => a + x.blocks, 0),
    txs: d.reduce((a, x) => a + x.txs, 0),
  };
  // Releases inside the visible range, for timeline markers.
  const lastDay = d[d.length - 1]?.day ?? "";
  const rel = (data.releases ?? []).filter((r) => r.day >= firstDay && r.day <= lastDay);
  const deltas = halvesDelta(d);
  const label = isAll ? "all time" : `${d.length}-day window`;

  return (
    <>
      {/* window filter */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 20,
      }}>
        <span className="pev-eyebrow" style={{ marginRight: 4 }}>Window</span>
        {choices.map((n) => (
          <WindowBtn key={n} href={`/scale?w=${n}`} label={`${n}d`} on={!isAll && active === n} />
        ))}
        <WindowBtn href="/scale?w=all" label={`all (${all.length}d)`} on={isAll} />
        {data.history?.firstDay && (
          <span style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle, marginLeft: 4 }}>
            pev has indexed from {data.history.firstDay}
            {data.history.daysAvailable ? ` · ${data.history.daysAvailable}d of chain history` : ""}
          </span>
        )}
      </div>

      {/* headline totals */}
      <section style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 12, marginBottom: 34,
      }}>
        <Stat big={compact(totals.txs)} label="transactions traced" sub={label} />
        <Stat big={compact(totals.blocks)} label="blocks analyzed" sub={`${fmt(totals.blocks)} total`} />
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
        note={deltas.txsPct != null
          ? `${deltas.txsPct > 0 ? "+" : ""}${deltas.txsPct}% first half vs second`
          : undefined}
        noteTone={deltas.txsPct != null && deltas.txsPct > 0 ? palette.sage : themeA.muted}
      >
        <Bars days={d} pick={(x) => x.txs} color={palette.sage} label="transactions per day" unit="transactions" releases={rel} />
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
        note={deltas.cpbPct != null
          ? `conflicts per block ${deltas.cpbPct > 0 ? "+" : ""}${deltas.cpbPct}%`
          : undefined}
        noteTone={deltas.cpbPct != null && deltas.cpbPct > 0 ? palette.ember : palette.sage}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <div>
            <Bars days={d} pick={(x) => x.avgScore} color={palette.bone} label="parallelism score (0-100)" max={100} unit="/100 parallelism score" releases={rel} />
          </div>
          <div>
            <Bars days={d} pick={(x) => x.cpb} color={palette.ember} label="conflicts per block" unit="conflicts per block" releases={rel} />
          </div>
        </div>
        <p style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.7, marginTop: 14, maxWidth: "64ch" }}>
          This is the pair that matters. Throughput can grow while the chain quietly does more
          duplicate work: every conflict is a transaction Monad executed, threw away, and ran
          again. Watching the two together is the only way to tell real scaling from busywork.
        </p>
        {rel.length > 0 && (
          <p style={{ fontSize: 12.5, color: themeA.subtle, lineHeight: 1.7, marginTop: 12, maxWidth: "64ch" }}>
            <span style={{ color: palette.sage }}>Dashed lines</span> mark Monad node releases in
            this window. They are GitHub publish dates, not mainnet activation, and chain-wide
            numbers move with what dapps do as much as with the client. Read them as context for
            correlation, not as cause.
          </p>
        )}
      </Section>

      {/* 4 · wave distribution, the mechanism behind the score */}
      {(data.waves?.length ?? 0) > 0 && (
        <Section
          kicker="Parallel execution"
          title="How many waves does a block need?"
          note={`avg ${(d.reduce((a, x) => a + x.avgWaves, 0) / Math.max(d.length, 1)).toFixed(2)} waves`}
        >
          <p style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.7, maxWidth: "64ch", margin: "0 0 18px" }}>
            Monad executes a block in waves: everything that can run together runs together, then
            whatever was blocked runs next. One wave means perfect parallelism. This is what the
            score is actually made of, it&apos;s{" "}
            <span style={{ fontFamily: themeA.mono, fontSize: 13, color: themeA.text }}>
              100 × (1 − waves / stateful txs)
            </span>
            , so wave depth <em>is</em> the parallelism.
          </p>
          <WaveHistogram waves={data.waves!} />
          <div style={{ marginTop: 22 }}>
            <Bars days={d} pick={(x) => x.avgWaves} color={palette.amber} label="average waves per block" releases={rel} />
          </div>
        </Section>
      )}

      {/* 5 · contention concentration */}
      {data.concentration && data.concentration.topSlots.length > 0 && (
        <Section
          kicker="Where the contention lives"
          title="Ten storage slots, most of the problem"
          note={`${data.concentration.windowDays}d sample`}
        >
          <div style={{ display: "flex", gap: 18, alignItems: "baseline", flexWrap: "wrap", marginBottom: 18 }}>
            <span style={{ fontSize: 52, fontWeight: 600, color: palette.ember, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {data.concentration.pct}%
            </span>
            <span style={{ fontSize: 15, color: themeA.text, lineHeight: 1.6, maxWidth: "46ch" }}>
              of every storage conflict on Monad traces back to just these ten slots.
              Contention isn&apos;t spread across the chain, it concentrates.
            </span>
          </div>
          <SlotTable c={data.concentration} />
          <p style={{ fontSize: 12.5, color: themeA.subtle, lineHeight: 1.7, marginTop: 14, maxWidth: "66ch" }}>
            Measured share of conflicts, not a projection. We deliberately don&apos;t claim what the
            parallelism score would become if these were fixed: the score is derived from wave
            depth, and how removing a conflict collapses a wave depends on the rest of the block.
          </p>
        </Section>
      )}

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
        {label} · updated {refreshedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        {data.partial ? " · partial (a heavy aggregate was skipped to protect the indexer)" : ""}
        {" · pev indexes from the block it was started, not chain genesis"}
      </p>
    </>
  );
}

/* ── charts (server-rendered SVG, no client JS) ── */

function Bars({
  days, pick, color, label, max, unit, releases,
}: {
  days: GrowthDay[]; pick: (d: GrowthDay) => number; color: string;
  label: string; max?: number; unit?: string; releases?: MonadRelease[];
}) {
  const vals = days.map(pick);
  const hi = max ?? Math.max(...vals, 1);
  const relByDay = new Map((releases ?? []).map((r) => [r.day, r.tag]));
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
              {relByDay.has(d.day) && (
                <span className="pev-col-mark" aria-hidden="true">
                  <em>{relByDay.get(d.day)}</em>
                </span>
              )}
              <span className="pev-col-tip">
                <b>{fmt(Math.round(v * 100) / 100)}</b>{unit ? ` ${unit}` : ""}
                <i>{d.day}</i>
                {relByDay.has(d.day) && <i>Monad {relByDay.get(d.day)} released</i>}
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

function WaveHistogram({ waves }: { waves: WaveBucket[] }) {
  const total = waves.reduce((a, w) => a + w.blocks, 0) || 1;
  const top = waves.slice(0, 12);
  const hi = Math.max(...top.map((w) => w.blocks), 1);
  return (
    <div>
      {top.map((w) => {
        const pct = (w.blocks / total) * 100;
        return (
          <div key={w.waves} style={{ display: "grid", gridTemplateColumns: "5.5rem 1fr 5rem", alignItems: "center", gap: 12, marginBottom: 7 }}>
            <span style={{ fontFamily: themeA.mono, fontSize: 12, color: w.waves === 1 ? palette.sage : themeA.muted }}>
              {w.waves} wave{w.waves === 1 ? "" : "s"}
            </span>
            <span style={{ height: 13, background: "rgba(239,231,212,0.05)", borderRadius: 2, overflow: "hidden", display: "block" }}>
              <span style={{
                display: "block", height: "100%", width: `${Math.max((w.blocks / hi) * 100, 0.6)}%`,
                background: w.waves === 1 ? palette.sage : w.waves <= 3 ? palette.bone : palette.ember,
                opacity: 0.85,
              }} />
            </span>
            <span style={{ fontFamily: themeA.mono, fontSize: 12, color: themeA.subtle, textAlign: "right" }}>
              {pct >= 0.1 ? `${pct.toFixed(1)}%` : "<0.1%"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SlotTable({ c }: { c: SlotConcentration }) {
  const hi = Math.max(...c.topSlots.map((s) => s.conflicts), 1);
  return (
    <div>
      {c.topSlots.map((s, i) => (
        <div key={`${s.contract}-${s.slot}`} style={{
          display: "grid", gridTemplateColumns: "1.6rem minmax(0,1fr) 1.1fr 5.5rem",
          alignItems: "center", gap: 12, padding: "7px 0",
          borderBottom: `1px solid ${themeA.border}`,
        }}>
          <span style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle }}>{i + 1}</span>
          <Link href={`/contract/${s.contract}`} className="pev-link" style={{
            fontSize: 13.5, color: s.label ? palette.ember : themeA.text,
            textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {s.label ?? `${s.contract.slice(0, 10)}…${s.contract.slice(-4)}`}
          </Link>
          <span style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.subtle, overflow: "hidden", textOverflow: "ellipsis" }}>
            slot {s.slot.slice(0, 10)}…
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <span style={{ height: 8, width: `${Math.max((s.conflicts / hi) * 46, 3)}px`, background: palette.ember, opacity: 0.8, borderRadius: 2 }} />
            <span style={{ fontFamily: themeA.mono, fontSize: 12, color: themeA.text }}>{compact(s.conflicts)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function WindowBtn({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link
      href={href}
      className="pev-link"
      style={{
        fontFamily: themeA.mono, fontSize: 11, letterSpacing: "0.05em",
        textDecoration: "none", padding: "4px 10px", borderRadius: themeA.radius,
        border: `1px solid ${on ? palette.ember : themeA.border}`,
        background: on ? "rgba(226,140,82,0.10)" : "transparent",
        color: on ? palette.ember : themeA.subtle,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
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
