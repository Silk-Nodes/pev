/**
 * /docs, single-page documentation for pev.
 *
 * Editorial format matching the homepage voice: short paragraphs,
 * concrete examples, honest caveats. Static Server Component, no
 * data fetching, no JS bundle.
 *
 * Why one page instead of a multi-page docs site:
 *   • The audience (Monad devs) wants to scan + Ctrl-F, not navigate
 *     a tree. One long page is faster to read end-to-end.
 *   • No JS framework overhead, no client hydration, no docs-site
 *     boilerplate. Renders in <200ms.
 *   • Updates land in one PR. No "where do I add this?" problem.
 *
 * Sections (anchored, so /docs#metrics and /docs#api work):
 *   1. What pev is
 *   2. How parallel execution works on Monad
 *   3. Metrics glossary
 *   4. How to use pev (workflow examples)
 *   5. Data coverage and caveats
 *   6. API reference
 *   7. About + contact
 */

import type { Metadata } from "next";
import Link from "next/link";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import {
  breadcrumbSchema,
  docsWebPageSchema,
  docsFaqSchema,
} from "@/lib/seo/schema";

export const metadata: Metadata = {
  // `absolute` bypasses the root layout's "%s · pev" template so we
  // control the full title string. Length 58 chars, comfortably inside
  // Google's 50-60 char sweet spot. Keyword-loaded with "documentation",
  // "metrics", "API reference", "pev" so it ranks for the queries devs
  // actually type when looking for tool docs.
  title: {
    absolute: "Documentation, metrics glossary, and API reference for pev",
  },
  description:
    "How pev works, what each metric means, how to read the contract page, and what the data does and doesn't cover. Plus the public API surface.",
  // Per-page canonical overrides the root canonical so Google sees
  // this URL as its own canonical address rather than a duplicate of
  // the landing page. metadataBase resolves "/docs" to the absolute
  // https://pev.silknodes.io/docs URL.
  alternates: {
    canonical: "/docs",
  },
  openGraph: {
    title: "pev docs",
    description:
      "How pev works, what each metric means, how to read the contract page, and what the data does and doesn't cover.",
    type: "article",
    url: "/docs",
    images: [
      {
        url: "/api/og/docs?v=3",
        width: 1200,
        height: 630,
        alt: "pev docs, the manual: metrics, methodology, API reference",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "pev docs",
    description:
      "How pev works, what each metric means, how to read the contract page.",
    images: ["/api/og/docs?v=3"],
  },
};

export default function DocsPage() {
  return (
    <main
      style={{
        padding: "32px clamp(20px, 4vw, 64px) 80px",
        // Match the width of every other detail page (1280px), so the
        // header lockup, search box, and footer line up. Prose readability
        // is still preserved because each inner element (P, Term, Caveat,
        // Endpoint, Workflow) caps itself at 64-70ch independently.
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      {/* Per-page JSON-LD: BreadcrumbList for the pev > docs trail,
          and WebPage tying this URL to the SoftwareApplication entity
          declared in the root layout. See src/lib/seo/schema.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbSchema([
              { name: "pev", url: "/" },
              { name: "docs", url: "/docs" },
            ]),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(docsWebPageSchema()),
        }}
      />
      {/* FAQPage JSON-LD: 8 Q&A pairs drawn from the visible page content
          (metrics glossary + intro). Validates as structured data even
          though Google currently restricts FAQ rich-result rendering
          to authoritative gov/health sites. Worth shipping for the
          structure-understanding benefit + future policy reversals. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(docsFaqSchema()),
        }}
      />

      <SiteHeader
        variant="internal"
        tagline="How pev works, what each metric means"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>docs</Crumb>
          </>
        }
      />

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 56 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 16 }}>
          Documentation
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(32px, 5vw, 52px)",
            color: themeA.text,
            margin: "0 0 18px",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          The manual.
        </h1>
        <p
          style={{
            fontSize: 16,
            color: themeA.muted,
            lineHeight: 1.7,
            maxWidth: "72ch",
            margin: 0,
          }}
        >
          Everything you need to read pev correctly: how the metrics are
          computed, what they mean for your contract, what the data covers,
          and where the limits are. No marketing prose; just the manual.
        </p>
      </section>

      {/* ─── Table of contents ───────────────────────────────────── */}
      <section
        style={{
          marginBottom: 64,
          padding: "16px 20px",
          background: palette.surface03,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
        }}
      >
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
          Contents
        </div>
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "6px 24px",
            fontSize: 13,
          }}
        >
          {[
            ["#what-pev-is", "What pev is"],
            ["#how-parallel", "How parallel execution works"],
            ["#metrics", "Metrics glossary"],
            ["#workflows", "How to use pev"],
            ["#coverage", "Data coverage and caveats"],
            ["#api", "API reference"],
            ["#about", "About + contact"],
          ].map(([href, label], i) => (
            <li key={href}>
              <a
                href={href}
                className="pev-link"
                style={{
                  color: themeA.muted,
                  textDecoration: "none",
                  display: "flex",
                  gap: 10,
                }}
              >
                <span
                  className="pev-mono"
                  style={{ color: themeA.subtle, fontSize: 11 }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{label}</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 1. What pev is ─────────────────────────────────────── */}
      <SectionHeader id="what-pev-is" eyebrow="01" title="What pev is" />
      <P>
        pev (Parallel Execution Visualizer) is a free developer tool for
        Monad mainnet. It traces every block as it lands and reconstructs
        what would have happened if the txs had run in true parallel:
        which transactions touch the same storage slots, which ones blocked
        which, and how many sequential rounds were forced by contention.
      </P>
      <P>
        Built by{" "}
        <a
          href="https://silknodes.io"
          target="_blank"
          rel="noreferrer"
          className="pev-link"
        >
          Silk Nodes
        </a>
        . The data is{" "}
        <em style={{ fontFamily: themeA.serif, fontStyle: "italic" }}>
          theoretical
        </em>{" "}
        parallelism: we compute what the conflict graph allows, not what
        Monad's actual scheduler picked. That's intentional. The scheduler
        decisions are internal and not exposed via RPC; the conflict
        structure is observable and reproducible, and it's what you can
        actually fix in your contract.
      </P>

      {/* ─── 2. How parallel execution works ────────────────────── */}
      <SectionHeader
        id="how-parallel"
        eyebrow="02"
        title="How parallel execution works on Monad"
      />
      <P>
        Monad doesn't process transactions one at a time. It runs them in
        parallel, many at once, across separate execution lanes. The
        catch: when two transactions touch the same storage slot in the
        same block, the chain has to run one first and re-execute the
        other once it finishes.
      </P>
      <P>
        That re-execution is the cost of contention. A block with 30 txs
        that all touch distinct state can finish in one round. A block
        with 30 txs all writing to the same global counter has to run
        sequentially, 30 rounds deep, because each tx invalidates the
        next. Real workloads sit between those extremes.
      </P>
      <P>
        The shape of your contract decides where on that spectrum you
        land. Contracts with{" "}
        <span style={{ color: themeA.status.clean }}>isolated state</span>{" "}
        (per-user balances, sharded counters) parallelize cleanly.
        Contracts with{" "}
        <span style={{ color: themeA.status.source }}>hot shared state</span>{" "}
        (a single global counter, a shared queue, a contended AMM pool)
        become the chokepoint everyone else waits on.
      </P>
      <P>
        pev's job is to make that shape visible. Every block page, every
        contract page, every analytics view is downstream of one question:
        which transactions blocked which, and on what slot.
      </P>

      {/* ─── 3. Metrics glossary ────────────────────────────────── */}
      <SectionHeader id="metrics" eyebrow="03" title="Metrics glossary" />

      <Term name="Parallelism Score">
        A 0-100 measure of how parallel-friendly a block is.{" "}
        <span style={{ color: themeA.text }}>100</span> means every
        transaction could have run in parallel; no contention.{" "}
        <span style={{ color: themeA.text }}>0</span> would be every
        transaction blocking the next one, fully serial. Real Monad blocks
        typically land between 60 and 95. Computed as the ratio of tx
        count to required execution waves: a 30-tx block that fits in 2
        waves scores around 93; the same block forced into 10 waves scores
        around 70.
      </Term>

      <Term name="Execution Waves">
        The minimum number of sequential rounds the block needs because of
        conflicts. Wave 1 runs everything that has no upstream dependency.
        Wave 2 runs everything blocked only by Wave 1 results. And so on.
        A block with depth 1 is fully parallel. A block with depth 5 had
        a chain of 5 transactions where each one couldn't start until the
        previous finished. Useful for spotting{" "}
        <em style={{ fontFamily: themeA.serif, fontStyle: "italic" }}>
          stack-of-dependent-writes
        </em>{" "}
        patterns vs. broad parallel work.
      </Term>

      <Term name="Hot Storage Slot">
        A storage slot (a specific 32-byte location at a specific
        contract) touched by 2 or more transactions in the same block.
        Hot slots are the literal bottleneck: every tx that wants to read
        or write a hot slot has to wait for the txs that already wrote it
        in this block to commit. pev ranks hot slots by{" "}
        <em style={{ fontFamily: themeA.serif, fontStyle: "italic" }}>
          conflicts caused
        </em>{" "}
        (how many tx-pair conflict edges in this block share this slot),
        then by{" "}
        <em style={{ fontFamily: themeA.serif, fontStyle: "italic" }}>
          touches
        </em>{" "}
        (how many txs touched it at all). The top slot on a contract page
        is usually the line of Solidity worth re-architecting.
      </Term>

      <Term name="Write-Write Conflict">
        Two transactions in the same block both wrote the same storage
        slot. One has to win the race, the other is re-executed. About
        94% of all conflicts we observe on Monad mainnet are
        write-write, dominated by hot counters and shared pool state.
      </Term>

      <Term name="Read-Write Conflict">
        One transaction read a slot that another transaction in the same
        block wrote. The reader has to retry after the writer commits.
        About 1% of observed conflicts. Rare because most reads are of
        slots that don't get written in the same block.
      </Term>

      <Term name="Mixed Conflict">
        A pair of transactions that conflict on multiple slots, with at
        least one write-write and at least one read-write among them.
        About 5% of conflicts. Common in transactions that touch several
        pieces of shared state at once (router contracts, complex AMM
        paths).
      </Term>

      <Term name="Conflicts Caused">
        On the contract page, the count of conflict edges where this
        contract owned the hot slot. A contract with high "conflicts
        caused" is putting load on the execution lane, regardless of how
        many of its own txs were the ones blocked.
      </Term>

      {/* ─── 4. How to use pev ──────────────────────────────────── */}
      <SectionHeader id="workflows" eyebrow="04" title="How to use pev" />

      <Workflow
        title="I have a contract on Monad and want to know if it's a bottleneck"
        steps={[
          "Open /contract/<your-address>. Default view is the last 7 days.",
          'Read the verdict line at the top: Healthy, Bottlenecked, or Throughput-killer. That\'s pev\'s one-line take.',
          "Scroll to Hot Storage Slots. The top entry is the most contested location in your contract. If you can refactor that one slot, you'll move the score.",
          "Scroll to Methods Causing Conflicts. Groups conflicts by 4-byte selector so you can see which function (mint, swap, claim, etc.) is responsible for what share.",
          "If you've made a change and want to compare, use the window selector at the top: 1h, 24h, 7d, 30d, all-time. Each window queries fresh.",
        ]}
      />

      <Workflow
        title="I want to know what the busiest contracts on Monad look like"
        steps={[
          "Open /analytics. The page is refreshed every 5 minutes from a pre-aggregated cache, so it loads in <1s.",
          "The Top conflict-causing contracts list ranks contracts by total conflicts in the window. Click any one to see the per-contract breakdown.",
          "Top hot slots ranks specific (contract, slot) pairs, useful for finding the single 32-byte location creating the most contention chain-wide.",
          "Methods, Conflict kinds, and Wave depth distribution let you see the chain's overall shape.",
        ]}
      />

      <Workflow
        title="I have a transaction hash from my dapp and want to debug it"
        steps={[
          "Open /tx/<hash>. We show you the block it landed in, the wave it executed in, what other txs it conflicted with, and which storage slots it touched.",
          "Click any conflict edge to jump to the other transaction. The conflict graph lets you trace the chain of dependencies.",
        ]}
      />

      <Workflow
        title="I want to share a finding with my team"
        steps={[
          "Every page generates a dynamic OG card. Paste the URL into Twitter, Discord, Slack, Telegram and the preview shows the real numbers.",
          "Per-block, per-contract, per-tx, and the landing page all have their own card variants.",
        ]}
      />

      {/* ─── 5. Data coverage and caveats ───────────────────────── */}
      <SectionHeader
        id="coverage"
        eyebrow="05"
        title="Data coverage and caveats"
      />
      <P>
        Honest disclosures about what pev does and doesn't see. None of
        these are bugs; they're the cost of operating on live mainnet data
        with public RPCs.
      </P>

      <Caveat title="History depth: ~12 days, growing">
        Our indexer started on Monad mainnet on April 25, 2026 and has
        been live-tailing the chain head since. Older blocks are not
        currently indexed. We may run a backfill if there's demand,
        otherwise the window grows naturally as the indexer runs.
      </Caveat>

      <Caveat title="DELEGATECALL targets may be missing">
        When a tx calls a proxy that DELEGATECALL's to an implementation,
        storage changes happen at the proxy's address, not the impl's.
        prestateTracer (the RPC tracer we use) doesn't surface the impl
        address in that case. So proxy implementations may show as "not
        seen" in pev even when they execute constantly. Custom JS tracers
        would fix this; the RPC we currently use doesn't support them.
        We're tracking this as a known limitation, not a bug.
      </Caveat>

      <Caveat title="Sourcify name coverage is thin">
        We resolve contract names via Sourcify. Coverage on Monad mainnet
        is still early, so most contracts show as short hex (0xab12…cd34)
        rather than human names. If you want yours labeled, verify it at{" "}
        <a
          href="https://sourcify.dev"
          target="_blank"
          rel="noreferrer"
          className="pev-link"
        >
          sourcify.dev
        </a>{" "}
        and pev will pick the name up automatically.
      </Caveat>

      <Caveat title="Aggregates lag real-time by a few minutes">
        The /analytics page reads from a cache refreshed every 5 minutes.
        Per-contract aggregate lookups read from a cache refreshed every
        15 minutes. Live per-block and per-tx pages compute on demand
        from the same data the indexer just wrote, so those are
        real-time. The lag is a fast-page-load trade.
      </Caveat>

      <Caveat title="Parallelism scores are theoretical, not actual">
        Every metric on this site is computed from the conflict graph
        prestateTracer produces. It tells you the maximum speedup the
        block's conflict structure permits. It doesn't tell you what
        Monad's actual scheduler picked, which is an internal decision
        not exposed via RPC. Score 80 means "this block could have run
        80% as parallel as it had transactions to support." The actual
        execution may have been better or worse depending on scheduler
        choices.
      </Caveat>

      <Caveat title="Re-execution cost is reported, not modeled">
        pev counts conflict edges and execution waves. It doesn't model
        the exact gas cost of re-execution under Monad's specific
        re-execution rules. Treat wave count as a relative signal across
        contracts and blocks, not as an absolute throughput dollar
        figure.
      </Caveat>

      {/* ─── 6. API reference ───────────────────────────────────── */}
      <SectionHeader id="api" eyebrow="06" title="API reference" />
      <P>
        pev exposes a handful of read-only JSON endpoints under{" "}
        <code style={{ fontFamily: themeA.mono, color: themeA.text }}>
          /api/v1/
        </code>
        . All endpoints are public, no auth required, no rate limit
        configured today. Stable surface; we'll version-bump if we have
        to break anything.
      </P>

      <Endpoint
        method="GET"
        path="/api/v1/leaderboard/:kind?window=&limit="
        body={
          <>
            Top blocks by{" "}
            <code style={{ fontFamily: themeA.mono, color: themeA.text }}>
              parallel
            </code>
            ,{" "}
            <code style={{ fontFamily: themeA.mono, color: themeA.text }}>
              blocked
            </code>
            ,{" "}
            <code style={{ fontFamily: themeA.mono, color: themeA.text }}>
              busy
            </code>
            , or top hot slots ({" "}
            <code style={{ fontFamily: themeA.mono, color: themeA.text }}>
              hotspots
            </code>
            ) over a time window.{" "}
            <code style={{ fontFamily: themeA.mono, color: themeA.text }}>
              window
            </code>{" "}
            ∈ 1h | 24h | 7d | all. Default 24h, limit 20.
          </>
        }
      />

      <Endpoint
        method="GET"
        path="/api/v1/stats"
        body="Network-wide aggregates: total blocks, total txs, total conflicts, average parallelism. Cached server-side."
      />

      <Endpoint
        method="GET"
        path="/api/v1/block/:number"
        body="Per-block JSON: wave count, conflict count, hot slots, top conflicts, every tx with its read/write counts. Same data the /block/[number] HTML page consumes."
      />

      <Endpoint
        method="GET"
        path="/api/v1/tx/:hash"
        body="Per-tx JSON: which block it landed in, which wave it executed in, what other txs it conflicted with, the storage slots it touched."
      />

      <Endpoint
        method="GET"
        path="/api/v1/debug/contract/:address"
        body='Presence probe. Returns {lastBlock, lastSeenAt, txCount, inWindow1h/24h/7d, hint} for any address. Useful for "is this contract in pev?" without rendering the full page.'
      />

      <Endpoint
        method="GET"
        path="/api/og/landing | /api/og/block/:n | /api/og/contract/:addr | /api/og/analytics"
        body="Dynamic 1200×630 OG card images. Edge-cached. Used by social previews; safe to deep-link if you want a fresh card."
      />

      <P>
        If you're building on this surface and want stability guarantees,
        open a feedback note: <ContactInline />. If you start to see rate
        limits, we'll publish them here.
      </P>

      {/* ─── 7. About + contact ─────────────────────────────────── */}
      <SectionHeader id="about" eyebrow="07" title="About + contact" />
      <P>
        pev is built and operated by{" "}
        <a
          href="https://silknodes.io"
          target="_blank"
          rel="noreferrer"
          className="pev-link"
        >
          Silk Nodes
        </a>
        , a professional blockchain infrastructure provider running
        validators, dedicated RPC nodes, and white-label services on a
        self-owned, globally distributed network with a zero-slashing
        track record. pev runs on the same redundant infrastructure that
        backs our validator and RPC operations, built as a developer
        tool to make Monad mainnet observable for the teams shipping on
        it.
      </P>
      <P>
        Bug reports, feature requests, weird data, "why doesn't my
        contract show up?", all welcome at <ContactInline />. We read
        everything.
      </P>

      <SiteFooter />
    </main>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────── */

function SectionHeader({
  id,
  eyebrow,
  title,
}: {
  id: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header id={id} style={{ marginTop: 40, marginBottom: 18, scrollMarginTop: 24 }}>
      <div
        className="pev-eyebrow"
        style={{ marginBottom: 8 }}
      >
        Section · {eyebrow}
      </div>
      <h2
        className="pev-display-italic"
        style={{
          fontSize: "clamp(24px, 3vw, 32px)",
          color: themeA.text,
          margin: 0,
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </h2>
    </header>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 15,
        color: themeA.muted,
        lineHeight: 1.7,
        marginBottom: 16,
        maxWidth: "72ch",
      }}
    >
      {children}
    </p>
  );
}

function Term({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 24, maxWidth: "72ch" }}>
      <h3
        style={{
          fontFamily: themeA.sans,
          fontSize: 14,
          color: themeA.text,
          margin: "0 0 6px",
          fontWeight: 500,
        }}
      >
        {name}
      </h3>
      <p style={{ fontSize: 14, color: themeA.muted, lineHeight: 1.7, margin: 0 }}>
        {children}
      </p>
    </section>
  );
}

function Workflow({
  title,
  steps,
}: {
  title: string;
  steps: string[];
}) {
  return (
    <section
      style={{
        marginBottom: 24,
        padding: "16px 18px",
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
      }}
    >
      <h3
        style={{
          fontFamily: themeA.serif,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: 18,
          color: themeA.text,
          margin: "0 0 12px",
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </h3>
      <ol
        style={{
          margin: 0,
          paddingLeft: 0,
          listStyle: "none",
          fontSize: 13,
          color: themeA.muted,
          lineHeight: 1.6,
        }}
      >
        {steps.map((s, i) => (
          <li
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr",
              gap: 8,
              padding: "6px 0",
              borderTop: i === 0 ? "none" : `1px solid ${themeA.border}`,
            }}
          >
            <span
              className="pev-mono"
              style={{ color: themeA.subtle, fontSize: 11 }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Caveat({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: 18,
        padding: "12px 16px",
        background: palette.surface03,
        border: `1px dashed ${themeA.border}`,
        borderRadius: themeA.radius,
        maxWidth: "72ch",
      }}
    >
      <h3
        style={{
          fontFamily: themeA.sans,
          fontSize: 13,
          color: themeA.text,
          margin: "0 0 4px",
          fontWeight: 500,
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 13, color: themeA.muted, lineHeight: 1.6, margin: 0 }}>
        {children}
      </p>
    </section>
  );
}

function Endpoint({
  method,
  path,
  body,
}: {
  method: string;
  path: string;
  body: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: 16,
        padding: "12px 16px",
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        maxWidth: "80ch",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          className="pev-mono"
          style={{
            fontSize: 10,
            color: themeA.bg,
            background: themeA.status.clean,
            padding: "2px 8px",
            borderRadius: 3,
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          {method}
        </span>
        <code
          style={{
            fontFamily: themeA.mono,
            fontSize: 12,
            color: themeA.text,
            wordBreak: "break-all",
          }}
        >
          {path}
        </code>
      </div>
      <div style={{ fontSize: 13, color: themeA.muted, lineHeight: 1.5 }}>
        {body}
      </div>
    </section>
  );
}

function ContactInline() {
  return (
    <a
      href="mailto:info@silknodes.io?subject=pev%20feedback"
      className="pev-link"
      style={{ fontFamily: themeA.mono, fontSize: "0.95em" }}
    >
      info@silknodes.io
    </a>
  );
}
