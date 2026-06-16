import { getLatestSafeBlockNumber, probeBlock } from "@/lib/parallel-probe";
import { probeToPEV, shortHex } from "@/lib/probe-to-pev";
import { themeA, palette } from "@/components/parallel/theme";
import LiveBlockFeed from "@/components/parallel/LiveBlockFeed";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import SearchBox from "@/components/site/SearchBox";
import Link from "next/link";
import {
  getRecentBlocks,
  getBlockBottleneck,
  getTopBottleneckContracts,
  type BlockSummaryRow,
  type BlockBottleneck,
  type TopBottleneckContract,
} from "@/lib/indexer/store";
import { resolveContract, resolveManyContracts } from "@/lib/enrichment";
import type { Metadata } from "next";

// Dynamic so we can mark error-state URLs (?q_error=1) as noindex without
// polluting Google's index when /go bounces an unparseable search back here.
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ q_error?: string }>;
}): Promise<Metadata> {
  const params = (await searchParams) ?? {};
  const isErrorState = params.q_error === "1";
  return {
    title: "pev: Parallel Execution Visualizer for Monad",
    description:
      "Is your contract killing parallelism? Paste a block. pev reconstructs the execution graph, surfaces storage contention, and tells you which slots are costing you throughput.",
    ...(isErrorState && { robots: { index: false, follow: false } }),
  };
}

// Refresh every 5s so the live feed feels live without hammering the DB
export const revalidate = 5;

interface HeroCardData {
  block: number;
  blockHash: string;
  txCount: number;
  statefulTxCount: number;
  parallelismScore: number;
  blockedPct: number;
  waves: number;
  conflictCount: number;
  /** Top bottleneck slot + contract, with resolved name. Null if no contention. */
  bottleneck: (BlockBottleneck & { contractName: string | null }) | null;
}

/**
 * Landing, masthead, search, indexer-status, latest-block hero,
 * recent blocks feed, how Monad works, what we measure, honesty footer.
 *
 * Reads from the indexed Postgres data when available; falls back to a
 * single live trace if no blocks are indexed yet (helpful for brand-new
 * setups where the indexer hasn't run).
 */
export default async function PEVLanding({
  searchParams,
}: {
  searchParams?: Promise<{ q_error?: string; q?: string }>;
}) {
  // /go bounces unparseable input back here with q_error=1 and the original
  // string echoed in q. We surface a small inline error so the user sees
  // why the search did nothing instead of being silently reset.
  const params = (await searchParams) ?? {};
  const queryError = params.q_error === "1" ? (params.q ?? "") : null;
  // ─── 1. Get recent indexed blocks + top bottleneck contracts ────
  // Two queries in parallel:
  //   • recent blocks → live feed + hero card
  //   • top bottleneck contracts → chip affordance under the search,
  //     proving the H1 promise ("Is your contract killing parallelism?")
  //     by surfacing 3 contracts that are *actually* killing it right now.
  // LiveStatus is self-sufficient (SSE + /api/health), no SSR data needed.
  let recent: BlockSummaryRow[] = [];
  let bottleneckChips: Array<TopBottleneckContract & { name: string | null }> = [];
  let dbHealthy = true;
  try {
    const [r, tops] = await Promise.all([
      getRecentBlocks(10),
      getTopBottleneckContracts(3, 200),
    ]);
    recent = r;
    // Resolve labels for the chip set in one batched call (cache-first;
    // most addresses on Monad are unverified, so most resolve to null
    // and we fall back to short hex in the chip render).
    if (tops.length > 0) {
      const names = await resolveManyContracts(tops.map((t) => t.address));
      bottleneckChips = tops.map((t) => ({
        ...t,
        name: names.get(t.address.toLowerCase()) ?? null,
      }));
    }
  } catch (err) {
    dbHealthy = false;
    console.warn("[landing] db read failed:", (err as Error).message);
  }

  // ─── 2. Pick the hero card ────────────────────────────────
  // Prefer the most recently indexed block (instant, no RPC call).
  // If the DB has nothing, fall back to a live trace so the page still
  // works for fresh setups.
  let hero: HeroCardData | null = null;
  let heroSource: "indexed" | "live" | "none" = "none";

  if (recent.length > 0) {
    const top = recent[0];
    // Pull the top bottleneck slot for this block + resolve the contract
    // name in parallel. Both are best-effort: if either fails or returns
    // null, the verdict line just degrades to "Clean -" or hex.
    let bottleneck: HeroCardData["bottleneck"] = null;
    try {
      const b = await getBlockBottleneck(top.number);
      if (b) {
        const name = await resolveContract(b.topContract);
        bottleneck = { ...b, contractName: name };
      }
    } catch (err) {
      console.warn("[landing] bottleneck lookup failed:", (err as Error).message);
    }

    // We don't have stateful_count in the BlockSummaryRow; approximate
    // from txCount until the recent rows include it (cheap + accurate
    // enough for a landing card)
    hero = {
      block: top.number,
      blockHash: top.hash,
      txCount: top.txCount,
      statefulTxCount: top.txCount, // approximate, exact value lives in JSONB
      parallelismScore: top.parallelismScore,
      blockedPct: top.blockedPct,
      waves: top.executionDepth,
      conflictCount: top.conflictCount,
      bottleneck,
    };
    heroSource = "indexed";
  } else if (dbHealthy) {
    // Brand-new install: indexer hasn't run yet. Trace one block so
    // the landing card has SOMETHING to show.
    try {
      const latest = await getLatestSafeBlockNumber();
      const previewProbe = await probeBlock(latest);
      const preview = probeToPEV(previewProbe);
      // Live-trace fallback: derive the verdict directly from the
      // probed PEVData (no DB hit), so brand-new installs without an
      // indexer still get a verdict line.
      const topHot = preview.hotSlots[0] ?? null;
      const liveBottleneck: HeroCardData["bottleneck"] = topHot
        ? {
            topContract: topHot.contract,
            topSlot: topHot.slot,
            topSlotConflicts: topHot.conflictsCaused,
            topSlotTouches: topHot.touches,
            totalHotSlots: preview.hotSlots.length,
            contractName: await resolveContract(topHot.contract).catch(() => null),
          }
        : null;
      hero = {
        block: preview.summary.block,
        blockHash: preview.summary.blockHash,
        txCount: preview.summary.txCount,
        statefulTxCount: preview.summary.statefulTxCount,
        parallelismScore: preview.summary.parallelismScore,
        blockedPct: preview.summary.blockedPct,
        waves: preview.summary.waves,
        conflictCount: preview.summary.conflictCount,
        bottleneck: liveBottleneck,
      };
      heroSource = "live";
    } catch {
      heroSource = "none";
    }
  }

  return (
    <main className="pev-cover-glow" style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px clamp(20px, 4vw, 64px) 80px" }}>
        {/* Shared masthead. Home variant: lockup + tagline + LiveStatus +
            Silk Nodes attribution, no header search (the hero owns the big
            search box). The literal tagline here exists to decode the
            "pev" wordmark for first-time visitors. */}
        <SiteHeader variant="home" tagline="Parallel Execution Visualizer" />

        {/* ─── Hero ───────────────────────────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <div
            className="pev-eyebrow"
            style={{ letterSpacing: ".2em", marginBottom: 14 }}
          >
            Monad · Developer Tooling
          </div>
          <h1
            className="pev-display-italic"
            style={{
              fontFamily: themeA.serif,
              fontStyle: "normal",
              fontSize: "clamp(44px, 7vw, 84px)",
              lineHeight: 0.96,
              letterSpacing: "-0.025em",
              margin: 0,
              color: themeA.text,
              maxWidth: "16ch",
            }}
          >
            Is your contract <em style={{ color: themeA.accent, fontStyle: "italic" }}>killing</em>{" "}
            parallelism?
          </h1>
          <p
            style={{
              fontFamily: themeA.serif,
              fontStyle: "italic",
              fontSize: "clamp(17px, 1.6vw, 22px)",
              color: themeA.muted,
              marginTop: 24,
              maxWidth: "48ch",
              lineHeight: 1.4,
            }}
          >
            Paste a block number. pev reconstructs the execution graph, surfaces
            storage contention, and tells you exactly which slots are costing
            you throughput.
          </p>

          {/* Search, contract-first to match the H1 promise. The smart-
              search at /go auto-detects address vs block # vs tx hash,
              so the same input still works for everything. */}
          {queryError && (
            <div
              role="alert"
              style={{
                marginTop: 32,
                maxWidth: 640,
                padding: "10px 14px",
                background: `${themeA.status.source}14`,
                border: `1px solid ${themeA.status.source}55`,
                borderRadius: themeA.radius,
                fontFamily: themeA.mono,
                fontSize: 12,
                color: themeA.text,
              }}
            >
              <span style={{ color: themeA.status.sourceText }}>Couldn't parse</span>{" "}
              <span style={{ color: themeA.muted }}>"{queryError}"</span>
              <span style={{ color: themeA.subtle }}>
                {" "}, try a block number, a contract address (0x + 40 hex), or a tx hash (0x + 64 hex).
              </span>
            </div>
          )}
          <SearchBox
            variant="hero"
            autoFocus
            defaultValue={queryError ?? ""}
          />

          {/* Chips, three live contracts that are actively killing
              parallelism right now. Proves the H1 promise without making
              the visitor paste their own address first. Each chip is a
              link straight to /contract/[addr] with a short hex (or
              Sourcify name) + a tiny conflict count for context. */}
          {bottleneckChips.length > 0 && (
            <div style={{ marginTop: 14, maxWidth: 640 }}>
              <div
                style={{
                  fontFamily: themeA.mono,
                  fontSize: 11,
                  color: themeA.subtle,
                  letterSpacing: ".05em",
                  marginBottom: 8,
                }}
              >
                killing parallelism right now:
              </div>
              {/* Grid instead of flex-wrap so chips never orphan onto a
                  second row at the awkward 2+1 split. auto-fit + minmax
                  means the row holds as many chips as fit at >=180px each
                  and degrades cleanly at narrower viewports. Empty cells
                  are not rendered (auto-fit collapses them) so a fresh
                  indexer with only 1-2 bottleneck contracts looks fine. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 10,
                }}
              >
                {bottleneckChips.map((c) => (
                  <Link
                    key={c.address}
                    href={`/contract/${c.address}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "5px 10px",
                      background: themeA.panel,
                      border: `1px solid ${themeA.border}`,
                      borderRadius: themeA.radius,
                      fontFamily: c.name ? themeA.sans : themeA.mono,
                      fontSize: 11,
                      color: themeA.text,
                      textDecoration: "none",
                      transition: "border-color 120ms ease",
                      minWidth: 0,
                    }}
                    className="pev-chip-bottleneck"
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name ?? shortHex(c.address, 6, 4)}
                    </span>
                    <span
                      style={{
                        color: themeA.status.sourceText,
                        fontFamily: themeA.mono,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.totalConflicts.toLocaleString()} conf
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ─── Hero card (latest indexed block) ─────────────────── */}
        {hero && (
          <section style={{ marginBottom: 32 }}>
            <div
              className="pev-eyebrow"
              style={{
                marginBottom: 12,
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span>Latest analyzed block</span>
              {heroSource === "live" && (
                <span style={{ color: themeA.subtle, textTransform: "none", letterSpacing: 0 }}>
                  · live trace (indexer not yet running)
                </span>
              )}
            </div>
            <Link
              href={`/block/${hero.block}`}
              style={{
                display: "block",
                background: themeA.panel,
                border: `1px solid ${themeA.border}`,
                borderRadius: themeA.radius,
                padding: "28px 32px",
                textDecoration: "none",
                color: themeA.text,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 18,
                  flexWrap: "wrap",
                  marginBottom: 16,
                }}
              >
                <span
                  className="pev-display-italic"
                  style={{ fontSize: 38, color: themeA.text }}
                >
                  #{hero.block.toLocaleString()}
                </span>
                <span
                  className="pev-mono"
                  style={{ fontSize: 12, color: themeA.muted }}
                >
                  {hero.txCount} txs · {shortHex(hero.blockHash, 8, 6)}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                <Stat label="Parallelism" value={`${hero.parallelismScore}/100`} accent />
                <Stat label="Blocked" value={`${hero.blockedPct}%`} />
                <Stat label="Waves" value={String(hero.waves)} />
                <Stat label="Conflicts" value={String(hero.conflictCount)} />
              </div>

              {/* Verdict, the bridge between data and understanding. The
                  H1 asks "Is your contract killing parallelism?", this
                  is where we answer it in one line, not four numbers. */}
              <Verdict
                conflictCount={hero.conflictCount}
                waves={hero.waves}
                bottleneck={hero.bottleneck}
              />

              <div
                className="pev-mono"
                style={{ fontSize: 11, color: themeA.subtle, marginTop: 20 }}
              >
                click to inspect →
              </div>
            </Link>
            {/* Affordance: the H1 promise is contract-centric. The hero
                is block-centric. This one-line bridge invites the visitor
                to follow up with their own contract. */}
            <div
              style={{
                marginTop: 12,
                fontFamily: themeA.serif,
                fontStyle: "italic",
                fontSize: 13,
                color: themeA.subtle,
              }}
            >
              Auditing your own contract? Paste its address in the search
              above to see its parallelism profile.
            </div>
          </section>
        )}

        {/* ─── Live feed (client-hydrated, SSE-driven) ─────────── */}
        {recent.length > 0 && (
          <section style={{ marginBottom: 56 }}>
            <LiveBlockFeed initial={recent.slice(1)} maxRows={20} />
          </section>
        )}

        {/* ─── How Monad works ─────────────────────────────────────
            Replaces the old "Three principles" section. The principles
            were beautifully written but they were the team talking to
            itself, visitors arrived not knowing what parallelism is, and
            we made them wait for the "What we measure" cards below to
            even start learning. This section now teaches the foundation
            in 4 sentences, in the same editorial register, so the cards
            below have something concrete to build on. */}
        <section style={{ marginBottom: 56 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 18 }}>
            How Monad works
          </div>
          <div
            className="pev-display-italic"
            style={{
              fontSize: "clamp(22px, 2.6vw, 28px)",
              color: themeA.text,
              lineHeight: 1.3,
              marginBottom: 24,
              maxWidth: "26ch",
            }}
          >
            Parallelism, in plain words.
          </div>
          <p
            style={{
              fontFamily: themeA.sans,
              fontSize: 16,
              color: themeA.muted,
              lineHeight: 1.7,
              maxWidth: "62ch",
              margin: 0,
            }}
          >
            Monad doesn't process transactions one at a time. It runs them
            in parallel,{" "}
            <em
              style={{
                fontFamily: themeA.serif,
                fontStyle: "italic",
                color: themeA.text,
              }}
            >
              many at once
            </em>
            , across separate execution lanes. The catch: when two
            transactions touch the same storage slot in the same block,
            the chain has to run one first and re-execute the other once
            it finishes. So the shape of your contract decides how
            parallel the chain can be. Contracts with{" "}
            <span style={{ color: themeA.status.clean }}>isolated state</span>{" "}
            (per-user balances, sharded counters) parallelize cleanly;
            contracts with{" "}
            <span style={{ color: themeA.status.sourceText }}>hot shared state</span>{" "}
            (a single global counter, a shared queue) become the chokepoint{" "}
            <em
              style={{
                fontFamily: themeA.serif,
                fontStyle: "italic",
                color: themeA.text,
              }}
            >
              everyone else waits on
            </em>
            .
          </p>
        </section>

        {/* ─── What we measure ─────────────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 14 }}>
            What we measure
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <Card
              title="Parallelism Score"
              body="Theoretical speedup vs. serial execution, on a 0-100 scale. Higher means the same work could finish in fewer rounds."
            />
            <Card
              title="Execution Waves"
              body="Minimum number of sequential rounds the block needs because of storage conflicts. Lower is more parallel."
            />
            <Card
              title="Hot Storage Slots"
              body="Storage slots touched by multiple txs in the same block, the bottlenecks."
            />
          </div>
        </section>

        {/* ─── Relationship graph CTA ──────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <Link
            href="/graph"
            className="pev-graph-cta"
            style={{
              display: "block",
              padding: "26px 28px",
              border: `1px solid ${themeA.border}`,
              borderRadius: themeA.radius,
              background: palette.surface02,
              textDecoration: "none",
            }}
          >
            <div
              className="pev-eyebrow"
              style={{ marginBottom: 12, color: themeA.accent }}
            >
              New · Relationship graph
            </div>
            <div
              className="pev-display-italic"
              style={{
                fontSize: "clamp(22px, 2.6vw, 28px)",
                color: themeA.text,
                lineHeight: 1.3,
                marginBottom: 12,
                maxWidth: "30ch",
              }}
            >
              See which contracts move together. →
            </div>
            <p
              style={{
                fontFamily: themeA.sans,
                fontSize: 15,
                color: themeA.muted,
                lineHeight: 1.6,
                maxWidth: "62ch",
                margin: 0,
              }}
            >
              An interactive map of how Monad&apos;s protocols compose at
              runtime: which contracts share transactions, and which of them
              collide on storage. Hover any contract to trace its connections.
            </p>
          </Link>
        </section>

        {/* ─── Honesty ─────────────────────────────────────────── */}
        <section
          style={{
            padding: 22,
            border: `1px dashed ${themeA.border}`,
            borderRadius: themeA.radius,
            marginBottom: 40,
            background: palette.surface03,
          }}
        >
          <div className="pev-eyebrow" style={{ marginBottom: 8 }}>
            What this is, and isn't
          </div>
          <p
            style={{
              fontSize: 13,
              color: themeA.muted,
              lineHeight: 1.6,
              margin: 0,
              maxWidth: "62ch",
            }}
          >
            Every metric on this page is computed from real{" "}
            <span className="pev-mono" style={{ color: themeA.text }}>prestateTracer</span>{" "}
            output. We show <em style={{ color: themeA.text, fontFamily: themeA.serif, fontStyle: "italic" }}>theoretical</em>{" "}
            parallelism, the maximum speedup the block's conflict structure
            allows, not what Monad's scheduler actually decided. That's
            internal and not exposed via RPC, so we don't fake it. Method
            names are decoded via the{" "}
            <a
              href="https://www.4byte.directory/"
              className="pev-link"
              target="_blank"
              rel="noreferrer"
            >
              4byte directory
            </a>{" "}
            when a selector has been submitted there; otherwise we show the
            raw 4-byte hex. Contract names come from{" "}
            <a
              href="https://sourcify.dev/"
              className="pev-link"
              target="_blank"
              rel="noreferrer"
            >
              Sourcify
            </a>{" "}
            when verified, coverage on Monad mainnet is still early.
          </p>
        </section>

        {/* ─── Footer ──────────────────────────────────────────── */}
        <SiteFooter />
      </div>
    </main>
  );
}

// ─── small components ────────────────────────────────────────────
// Note: IndexerStatus was removed in favor of <LiveStatus /> (a client
// component that polls /api/health every 4s). The old version showed a
// confusing "10 indexed" count derived from recent.length and didn't
// tick the chain head live. See components/parallel/LiveStatus.tsx.

/**
 * Verdict, one-line answer to "did this block parallelize, and if not, why?"
 *
 * Three states:
 *   • clean:       no conflicts            → "Clean, every tx ran independently in N waves"
 *   • bottleneck:  1-2 conflicts           → "Bottleneck: <contract> · slot <…01> (4 touches)"
 *   • killer:      3+ conflicts            → "Throughput-killer: <contract> · K conflicts across M slots"
 *
 * Editorial voice: a single declarative noun ("Bottleneck:" / "Throughput-killer:")
 * carries the severity instead of an emoji. Color comes from the brand status
 * palette, sage when clean, terracotta when bad, and matches the dot in the
 * top-right LiveStatus pill.
 */
function Verdict({
  conflictCount,
  waves,
  bottleneck,
}: {
  conflictCount: number;
  waves: number;
  bottleneck: HeroCardData["bottleneck"];
}) {
  // Clean path, celebrate it, but keep it small.
  if (conflictCount === 0 || !bottleneck) {
    return (
      <div
        style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: `1px solid ${themeA.border}`,
          fontFamily: themeA.serif,
          fontStyle: "italic",
          fontSize: 16,
          color: themeA.status.clean,
          lineHeight: 1.4,
        }}
      >
        Clean. Every transaction ran independently
        {waves > 0 && (
          <span style={{ color: themeA.muted, fontStyle: "normal", fontFamily: themeA.sans }}>
            {" "}in {waves} wave{waves === 1 ? "" : "s"}
          </span>
        )}.
      </div>
    );
  }

  // Severity threshold, 3+ conflicts = throughput-killer; below = bottleneck.
  // (3 is roughly where a single hot slot starts costing meaningful waves on
  //  a typical 30-tx Monad block; below that it's noise.)
  const isKiller = conflictCount >= 3;
  const verb = isKiller ? "Throughput-killer" : "Bottleneck";
  // sourceText (lighter terracotta) instead of source: this color flows
  // directly into the verdict label's text style (17px italic), so the
  // brighter inline-text variant is needed for WCAG AA.
  const color = isKiller ? themeA.status.sourceText : themeA.status.delayed;
  const contractLabel =
    bottleneck.contractName ?? shortHex(bottleneck.topContract, 6, 4);

  return (
    <div
      style={{
        marginTop: 18,
        paddingTop: 16,
        borderTop: `1px solid ${themeA.border}`,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: 10,
        lineHeight: 1.4,
      }}
    >
      <span
        className="pev-display-italic"
        style={{
          fontSize: 17,
          color,
          // Stop the trailing colon from creating an awkward gap before the address
          marginRight: -4,
        }}
      >
        {verb}:
      </span>
      <span
        className="pev-mono"
        style={{
          fontSize: 13,
          color: themeA.text,
          // contractName (when verified on Sourcify) is plain text; raw hex is mono.
          // Either way mono works because shortHex is hex.
          fontFamily: bottleneck.contractName ? themeA.sans : themeA.mono,
        }}
      >
        {contractLabel}
      </span>
      <span style={{ fontSize: 12, color: themeA.subtle }}>·</span>
      <span
        className="pev-mono"
        style={{ fontSize: 12, color: themeA.muted }}
      >
        slot{" "}
        <span style={{ color: themeA.text }}>
          {shortHex(bottleneck.topSlot, 8, 4)}
        </span>
      </span>
      <span style={{ fontSize: 12, color: themeA.subtle }}>·</span>
      <span style={{ fontSize: 12, color: themeA.muted }}>
        {isKiller ? (
          <>
            <span style={{ color: themeA.text }}>{conflictCount}</span> conflicts
            {bottleneck.totalHotSlots > 1 && (
              <>
                {" "}across{" "}
                <span style={{ color: themeA.text }}>{bottleneck.totalHotSlots}</span>{" "}
                slots
              </>
            )}
          </>
        ) : (
          <>
            <span style={{ color: themeA.text }}>{bottleneck.topSlotTouches}</span>{" "}
            txs touched · <span style={{ color: themeA.text }}>{conflictCount}</span>{" "}
            conflict{conflictCount === 1 ? "" : "s"}
          </>
        )}
      </span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ borderLeft: `2px solid ${themeA.border}`, paddingLeft: 14 }}>
      <div className="pev-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: themeA.mono,
          fontSize: 22,
          color: accent ? themeA.status.clean : themeA.text,
          marginTop: 4,
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: 18,
      }}
    >
      <div className="pev-display-italic" style={{ fontSize: 18, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: themeA.muted, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

