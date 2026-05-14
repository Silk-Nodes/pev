"use client";

/**
 * EditorialView, the root client component for a single block analysis.
 *
 * Layout matches variation-a.jsx exactly:
 *   1. Masthead  , eyebrow + serif title + network/build pills
 *   2. Query bar , block search input (replaces tx-hash/contract input for now)
 *   3. Summary   , "Analyzing #N" + 4-metric strip (PARALLELISM / BLOCKED / AVG / LONGEST)
 *   4. Timeline  , wave gantt (full-width card)
 *   5. Two-up    , Conflict graph (1.1fr) + Hot slots card (1fr)
 *   6. Why panel , full-width
 *   7. Footer    , interaction hints + tagline
 *
 * The whole thing is wrapped in a PEVProvider so all panels share selection
 * state (hover, click, mode).
 */

import { PEVProvider, usePEV } from "./PEVContext";
import { themeA } from "./theme";
import Timeline from "./Timeline";
import ConflictGraph from "./ConflictGraph";
import HotSlots from "./HotSlots";
import WhyPanel from "./WhyPanel";
import SummaryMetrics from "./SummaryMetrics";
import ModeToggle from "./ModeToggle";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { shortHex } from "@/lib/probe-to-pev";
import type { PEVData } from "@/lib/probe-to-pev";
import Link from "next/link";

interface Props {
  data: PEVData;
  /**
   * Closes the dead-end. The block page used to terminate at the WhyPanel
   * with no obvious next click, users had to either scroll back to the
   * top breadcrumb (small, easy to miss) or hit the browser back button.
   *
   * The next-action band sits above the SiteFooter and offers two pulls:
   *   • "Audit this contract", when the block had a real bottleneck,
   *     extends the verdict line into a click-through to the contract
   *     page for the worst offender.
   *   • Prev/next block chips, keep devs flipping through the chain
   *     without re-routing through the landing page.
   *
   * The contract name is resolved server-side (Sourcify cache lookup) and
   * passed in; the contract address itself comes from `data.hotSlots[0]`
   * which is already on the client.
   */
  nextAction?: {
    bottleneckContractName: string | null;
  };
}

export default function EditorialView({ data, nextAction }: Props) {
  return (
    <PEVProvider data={data}>
      <Inner data={data} nextAction={nextAction} />
    </PEVProvider>
  );
}

function Inner({ data, nextAction }: Props) {
  const ts = new Date(data.summary.timestamp * 1000);
  const tsLabel = ts.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const blockLabel = `#${data.summary.block.toLocaleString()}`;

  return (
    <div
      style={{
        padding: "32px clamp(20px, 4vw, 64px) 80px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <SiteHeader
        variant="internal"
        tagline="One block, wave by wave"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/">block</Crumb>
            <CrumbSep />
            <Crumb current>{blockLabel}</Crumb>
          </>
        }
      />

      {/* Inline navigation between adjacent blocks. Contextual, earns its
          own line, keeps devs scanning the chain without going to /. */}
      <div
        style={{
          marginBottom: 22,
          fontFamily: themeA.mono,
          fontSize: 11,
          color: themeA.subtle,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Link href={`/block/${data.summary.block - 1}`} className="pev-link">
          ← previous block
        </Link>
        <Link href={`/block/${data.summary.block + 1}`} className="pev-link">
          next block →
        </Link>
        <Link href="/" className="pev-link">
          recent activity
        </Link>
      </div>

      {/* Analyzing + 4-metric strip */}
      <section
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="pev-eyebrow">Analyzing</div>
          <div
            className="pev-display-italic"
            style={{
              fontSize: 24,
              marginTop: 4,
            }}
          >
            {data.query.label}
          </div>
          <div
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.muted,
              marginTop: 4,
            }}
          >
            {data.summary.txCount} transactions ·{" "}
            {data.summary.statefulTxCount} stateful · {tsLabel}
          </div>
        </div>
        <SummaryMetrics />
      </section>

      {/* Section title + mode toggle (with helper hint that updates with mode) */}
      <ModeSwitcher data={data} />

      {/* The mode-aware analysis layout, Timeline / ConflictGraph / HotSlots
          re-arrange based on the active view so devs land on the visual
          that answers their question. */}
      <ModeLayout data={data} />

      {/* Why panel, always visible regardless of mode. The selected-tx
          drilldown is useful in every view. */}
      <section style={{ marginBottom: 4 }}>
        <WhyPanel />
      </section>

      {/* Next-action band, closes the dead-end at the bottom of the page.
          See the EditorialView Props comment for the rationale. */}
      <NextActionBand
        block={data.summary.block}
        topHotSlot={data.hotSlots[0] ?? null}
        bottleneckContractName={nextAction?.bottleneckContractName ?? null}
      />

      <SiteFooter />
    </div>
  );
}

/**
 * NextActionBand, the bottom-of-page bridge from "I just read this block"
 * to "I know what to click next." Renders one of two shapes:
 *
 *   1. With a bottleneck (data.hotSlots[0] exists, conflictsCaused > 0):
 *      a warm card pulling the user toward the contract page for the
 *      worst-offending contract. This is the most useful next step for
 *      a developer who came to debug parallelism, the verdict line at
 *      the top says WHO is to blame, this says GO LOOK.
 *
 *   2. With no bottleneck (clean block): just the prev/next nav, since
 *      there's no contract worth singling out.
 *
 * In both cases we mirror the prev/next chips so devs at the bottom of
 * the page don't have to scroll back up to the breadcrumb to keep
 * scanning the chain.
 */
function NextActionBand({
  block,
  topHotSlot,
  bottleneckContractName,
}: {
  block: number;
  topHotSlot: PEVData["hotSlots"][0] | null;
  bottleneckContractName: string | null;
}) {
  const hasBottleneck = topHotSlot !== null && topHotSlot.conflictsCaused > 0;
  const contractLabel =
    bottleneckContractName ??
    (topHotSlot ? shortHex(topHotSlot.contract, 8, 6) : "");

  return (
    <section
      style={{
        marginTop: 32,
        paddingTop: 28,
        borderTop: `1px solid ${themeA.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {hasBottleneck && topHotSlot && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "20px 24px",
            background: "rgba(226, 140, 82, 0.05)",
            border: `1px solid ${themeA.border}`,
            borderRadius: themeA.radius,
          }}
        >
          <div className="pev-eyebrow">The bottleneck</div>
          <div
            className="pev-display-italic"
            style={{
              fontSize: 22,
              lineHeight: 1.25,
              color: themeA.text,
            }}
          >
            <span style={{ color: themeA.status.source }}>
              Throughput-killer:
            </span>{" "}
            <span
              className={bottleneckContractName ? undefined : "pev-mono"}
              style={{ fontSize: bottleneckContractName ? 22 : 18 }}
            >
              {contractLabel}
            </span>
          </div>
          <div
            className="pev-mono"
            style={{
              fontSize: 11,
              color: themeA.muted,
              marginBottom: 4,
            }}
          >
            {topHotSlot.conflictsCaused} conflict
            {topHotSlot.conflictsCaused === 1 ? "" : "s"} on slot{" "}
            <span style={{ color: themeA.text }}>
              {shortHex(topHotSlot.slot, 10, 6)}
            </span>
          </div>
          <div>
            <Link
              href={`/contract/${topHotSlot.contract}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                background: themeA.accent,
                color: themeA.onAccent,
                borderRadius: themeA.radius,
                fontFamily: themeA.sans,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                letterSpacing: ".01em",
              }}
            >
              Audit this contract →
            </Link>
          </div>
        </div>
      )}

      {/* Prev/next nav chips, mirrored at the bottom so devs don't have
          to scroll back up. The "recent activity" link is the safety net
          for users who are done scanning blocks and want to go home. */}
      <div
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "center",
          fontFamily: themeA.mono,
          fontSize: 12,
          color: themeA.subtle,
        }}
      >
        <Link href={`/block/${block - 1}`} className="pev-link">
          ← previous block
        </Link>
        <span>·</span>
        <Link href={`/block/${block + 1}`} className="pev-link">
          next block →
        </Link>
        <span style={{ marginLeft: "auto" }}>
          <Link href="/" className="pev-link">
            recent activity
          </Link>
        </span>
      </div>
    </section>
  );
}

/**
 * ModeSwitcher, the section title + ModeToggle row, with a small
 * mode-specific subtitle that tells the dev what they're looking at.
 *
 * The subtitle is the "you are here" cue, without it, devs flipping
 * modes have to guess what changed. With it, every mode announces its
 * purpose in one clause.
 */
function ModeSwitcher({ data }: { data: PEVData }) {
  const { mode } = usePEV();
  const subtitle: Record<typeof mode, { title: string; hint: string }> = {
    execution: {
      title: "Execution timeline",
      hint: "did this block parallelize well?",
    },
    conflict: {
      title: "Conflict graph",
      hint: "who blocked who, and why?",
    },
    heatmap: {
      title: "Storage hotspots",
      hint: "which slots are causing contention?",
    },
  };
  const s = subtitle[mode];
  return (
    <section
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 14,
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="pev-display-italic" style={{ fontSize: 20 }}>
          {s.title}
        </div>
        <div
          className="pev-mono"
          style={{ fontSize: 11, color: themeA.subtle, marginTop: 2 }}
        >
          {s.hint}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="pev-eyebrow" style={{ letterSpacing: ".08em" }}>
          view
        </span>
        <ModeToggle />
      </div>
    </section>
  );
}

/**
 * ModeLayout, re-arranges Timeline / ConflictGraph / HotSlots based on
 * the active mode. The wave structure is always visible (Timeline never
 * disappears) so devs keep their position context, but the eye lands on
 * the primary visual for the current question.
 *
 * Sizing math:
 *   • Timeline height in non-execution modes is capped to ~180px so it
 *     functions as a position-reference strip without dominating
 *   • Conflict graph in conflict mode goes to 460px (vs 300 default)
 *   • Hot slots in heatmap mode shows 20 rows (vs 8)
 */
function ModeLayout({ data }: { data: PEVData }) {
  const { mode } = usePEV();

  const fullTimelineHeight = Math.max(220, Math.min(440, 80 + data.waveTxs.length * 56));
  const compactTimelineHeight = Math.max(140, Math.min(220, 60 + data.waveTxs.length * 28));

  const timelineCard = (height: number, label = "Timeline") => (
    <section
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "20px 24px 24px",
        marginBottom: 20,
      }}
    >
      {label !== "Timeline" && (
        <div className="pev-eyebrow" style={{ marginBottom: 10 }}>
          {label}
        </div>
      )}
      <Timeline height={height} />
      <Legend />
    </section>
  );

  if (mode === "conflict") {
    return (
      <>
        {/* Big graph first, the point of this mode */}
        <Card eyebrow="Conflict graph" title="Who blocked who" marginBottom={20}>
          <ConflictGraph height={460} />
        </Card>
        {/* Compressed timeline below for context */}
        {timelineCard(compactTimelineHeight, "Position context")}
      </>
    );
  }

  if (mode === "heatmap") {
    return (
      <>
        {/* Big hot-slots view, the point of this mode */}
        <Card
          eyebrow="Hot storage slots"
          title="Contention by slot"
          marginBottom={20}
        >
          <HotSlots limit={20} />
        </Card>
        {/* Compressed timeline below for context */}
        {timelineCard(compactTimelineHeight, "Position context")}
      </>
    );
  }

  // Default: execution, the original 1+2 layout
  return (
    <>
      {timelineCard(fullTimelineHeight)}
      <section
        className="pev-grid-hero"
        style={{ gap: 20, marginBottom: 20 }}
      >
        <Card eyebrow="Conflict graph" title="Blocked by">
          <ConflictGraph height={300} />
        </Card>
        <Card eyebrow="Hot storage slots" title="Contention">
          <HotSlots />
        </Card>
      </section>
    </>
  );
}

function Card({
  eyebrow,
  title,
  marginBottom,
  children,
}: {
  eyebrow: string;
  title: string;
  marginBottom?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "14px 16px",
        marginBottom: marginBottom,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="pev-eyebrow" style={{ whiteSpace: "nowrap" }}>{eyebrow}</div>
          <div
            className="pev-display-italic"
            style={{
              fontSize: 17,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Mode-aware legend that swaps its swatch + label vocabulary every time
 * the user flips the ModeToggle. Lives inside the Timeline card so it's
 * always next to the colours it's explaining.
 */
function Legend() {
  const { mode } = usePEV();
  const Item = ({ swatch, label }: { swatch: React.ReactNode; label: string }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {swatch}
      {label}
    </span>
  );
  const swatchSize = { width: 10, height: 10, borderRadius: 2, display: "inline-block" } as const;
  const stripeBg = (color: string) =>
    `repeating-linear-gradient(135deg, ${color}, ${color} 2px, ${themeA.reexecStripe} 2px, ${themeA.reexecStripe} 4px)`;

  return (
    <div
      style={{
        marginTop: 14,
        display: "flex",
        gap: 22,
        fontFamily: themeA.mono,
        fontSize: 10,
        color: themeA.muted,
        flexWrap: "wrap",
      }}
    >
      {mode === "execution" && (
        <>
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.status.clean }} />}
            label="parallel · wave 0, no conflicts"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.status.delayed }} />}
            label="delayed · forced to wait"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: stripeBg(themeA.status.source) }} />}
            label="conflict source · blocks others"
          />
        </>
      )}

      {mode === "conflict" && (
        <>
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.dim, opacity: 0.5 }} />}
            label="no conflicts · dimmed"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.status.delayed }} />}
            label="1-2 conflicts"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: stripeBg(themeA.status.source) }} />}
            label="3+ conflicts (striped if causing)"
          />
        </>
      )}

      {mode === "heatmap" && (
        <>
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.dim, opacity: 0.5 }} />}
            label="no storage I/O"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.status.clean }} />}
            label="< 5 ops"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.status.delayed }} />}
            label="< 20 ops"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.accent }} />}
            label="< 60 ops"
          />
          <Item
            swatch={<span style={{ ...swatchSize, background: themeA.status.source }} />}
            label="60+ ops · hot"
          />
        </>
      )}
    </div>
  );
}
