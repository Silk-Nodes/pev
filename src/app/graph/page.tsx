import Link from "next/link";
import type { Metadata } from "next";
import {
  getCachedCooccurrenceGraph,
  getCooccurrenceGraph,
  type CooccurrenceGraph as GraphData,
} from "@/lib/indexer/store";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { CooccurrenceGraph } from "@/components/parallel/CooccurrenceGraph";

/**
 * /graph, the contract relationship graph. Shows which Monad contracts
 * co-occur in the same transactions (composability) and which of those
 * pairs actually collide on storage (contention) over a 7-day window.
 *
 * Data source: the cooccurrence_cache row, precomputed by
 * scripts/refresh-cooccurrence-graph.ts from the contract_pair_daily
 * rollup. The page is a single cache read; it never aggregates live.
 * Falls back to a one-off live build only if the cache is empty (fresh
 * deploy before the first refresh).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Contract relationship graph: how Monad contracts connect" },
  description:
    "Which Monad contracts co-occur in the same transactions, and which of those pairs collide on storage. A composability + contention map built from pev's per-block execution traces.",
  alternates: { canonical: "/graph" },
  openGraph: {
    title: "How Monad contracts connect",
    description:
      "Composability + contention graph of Monad mainnet contracts, from pev's execution traces.",
    type: "website",
    url: "/graph",
    images: [{ url: "/og/graph", width: 1200, height: 630, alt: "Monad contract relationship graph" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "How Monad contracts connect",
    description:
      "Composability + contention graph of Monad mainnet contracts, from pev's execution traces.",
    images: ["/og/graph"],
  },
};

const WINDOW_DAYS = 7;

export default async function GraphPage() {
  let data: GraphData | null = null;
  let refreshedAt: Date | null = null;
  try {
    const cached = await getCachedCooccurrenceGraph();
    if (cached) {
      data = cached.data;
      refreshedAt = cached.refreshedAt;
    } else {
      // Cold cache fallback. Light (reads the rollup, not source tables).
      console.warn("[graph] cache empty, falling back to live build");
      data = await getCooccurrenceGraph(WINDOW_DAYS);
    }
  } catch (err) {
    console.warn("[graph] data read failed:", (err as Error).message);
  }

  const namedCount = data?.nodes.filter((n) => n.label != null).length ?? 0;
  const contendedEdges = data?.edges.filter((e) => e.conflicts > 0).length ?? 0;

  // Narrative key findings, computed from the same cached data, so the page
  // answers "what am I looking at?" instead of leaving it to the eye.
  const labelOf = (addr: string) => {
    const n = data?.nodes.find((x) => x.address === addr);
    return n?.label ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };
  const findings =
    data && data.edges.length > 0
      ? {
          mostConnected: [...data.nodes].sort((a, b) => b.degree - a.degree)[0],
          strongest: [...data.edges].sort((a, b) => b.cooccur - a.cooccur)[0],
          mostContended:
            data.edges.filter((e) => e.conflicts > 0).sort((a, b) => b.conflicts - a.conflicts)[0] ?? null,
        }
      : null;

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 80px", maxWidth: 1280, margin: "0 auto" }}>
      <SiteHeader
        variant="internal"
        tagline="How contracts connect"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>graph</Crumb>
          </>
        }
      />

      <section style={{ marginBottom: 28 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
          Relationship graph
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(30px, 4.5vw, 48px)",
            color: themeA.text,
            margin: "0 0 16px",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          Which contracts move together.
        </h1>
        <p style={{ fontSize: 16, color: themeA.muted, lineHeight: 1.7, maxWidth: "64ch", margin: 0 }}>
          Every line links two contracts that appear in the same transactions,
          how Monad&apos;s protocols actually compose at runtime. Thicker lines
          mean they co-occur more often.{" "}
          <span style={{ color: palette.ember }}>Ember lines</span> are pairs
          that often co-occur inside contended transactions, the storage
          contention that costs parallelism. Faint lines are pairs that
          coexist cleanly. Node size is total connection weight; named
          contracts are ember, unlabelled are grey.
        </p>
      </section>

      {data && data.edges.length > 0 ? (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20, fontSize: 13, color: themeA.muted }}>
            <span><strong style={{ color: themeA.text }}>{data.nodes.length}</strong> contracts</span>
            <span><strong style={{ color: themeA.text }}>{data.edges.length}</strong> connections</span>
            <span><strong style={{ color: palette.ember }}>{contendedEdges}</strong> contend on storage</span>
            <span><strong style={{ color: themeA.text }}>{namedCount}</strong> labelled</span>
            <span>{data.totalPairs.toLocaleString()} total pairs in {data.windowDays}d</span>
          </div>

          {/* Key findings: the answers the eye can't extract from the knot. */}
          {findings && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <Finding
                label="Most connected"
                value={findings.mostConnected.label ?? `${findings.mostConnected.address.slice(0, 6)}…${findings.mostConnected.address.slice(-4)}`}
                detail={`${findings.mostConnected.degree} connections`}
              />
              <Finding
                label="Strongest pair"
                value={`${labelOf(findings.strongest.source)} ↔ ${labelOf(findings.strongest.target)}`}
                detail={`${findings.strongest.cooccur.toLocaleString()} co-occurrences`}
              />
              {findings.mostContended ? (
                <Finding
                  label="Most contended"
                  value={`${labelOf(findings.mostContended.source)} ↔ ${labelOf(findings.mostContended.target)}`}
                  detail={`${findings.mostContended.conflicts.toLocaleString()} storage collisions`}
                  warn
                />
              ) : (
                <Finding label="Storage contention" value="None in window" detail="all pairs coexist cleanly" />
              )}
            </div>
          )}

          <CooccurrenceGraph data={data} />

          <p style={{ fontSize: 12, color: themeA.subtle, fontFamily: themeA.mono, marginTop: 16 }}>
            {refreshedAt
              ? `top ${data.nodes.length} contracts by co-occurrence · ${data.windowDays}-day window · updated ${refreshedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
              : `top ${data.nodes.length} contracts by co-occurrence · ${data.windowDays}-day window · live build`}
          </p>
        </>
      ) : (
        <div
          style={{
            padding: "24px 20px",
            background: palette.surface03,
            border: `1px dashed ${themeA.border}`,
            borderRadius: themeA.radius,
            color: themeA.muted,
            fontSize: 14,
            lineHeight: 1.6,
            maxWidth: "60ch",
          }}
        >
          The relationship graph is still warming up. The co-occurrence rollup
          may not be populated yet, or the cache refresh hasn&apos;t run. Check
          back shortly.
        </div>
      )}

      <p style={{ marginTop: 32 }}>
        <Link href="/" className="pev-link">
          ← back to pev
        </Link>
      </p>

      <SiteFooter />
    </main>
  );
}

/**
 * One key-finding card: small mono label, a value, and a detail line.
 * Renders the insights the graph's knot can't convey at a glance.
 */
function Finding({
  label,
  value,
  detail,
  warn = false,
}: {
  label: string;
  value: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: palette.surface02,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
      }}
    >
      <div className="pev-eyebrow" style={{ fontSize: 10, color: warn ? palette.ember : themeA.subtle, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, color: themeA.text, fontWeight: 500, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
      <div style={{ fontFamily: themeA.mono, fontSize: 12, color: themeA.muted, marginTop: 4 }}>
        {detail}
      </div>
    </div>
  );
}
