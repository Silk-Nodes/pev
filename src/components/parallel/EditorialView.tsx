"use client";

/**
 * EditorialView — the root client component for a single block analysis.
 *
 * Layout matches variation-a.jsx exactly:
 *   1. Masthead   — eyebrow + serif title + network/build pills
 *   2. Query bar  — block search input (replaces tx-hash/contract input for now)
 *   3. Summary    — "Analyzing #N" + 4-metric strip (PARALLELISM / BLOCKED / AVG / LONGEST)
 *   4. Timeline   — wave gantt (full-width card)
 *   5. Two-up     — Conflict graph (1.1fr) + Hot slots card (1fr)
 *   6. Why panel  — full-width
 *   7. Footer     — interaction hints + tagline
 *
 * The whole thing is wrapped in a PEVProvider so all panels share selection
 * state (hover, click, mode).
 */

import { PEVProvider } from "./PEVContext";
import { themeA } from "./theme";
import { PEVLockup } from "./PEVBrand";
import Timeline from "./Timeline";
import ConflictGraph from "./ConflictGraph";
import HotSlots from "./HotSlots";
import WhyPanel from "./WhyPanel";
import SummaryMetrics from "./SummaryMetrics";
import ModeToggle from "./ModeToggle";
import type { PEVData } from "@/lib/probe-to-pev";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  data: PEVData;
}

export default function EditorialView({ data }: Props) {
  return (
    <PEVProvider data={data}>
      <Inner data={data} />
    </PEVProvider>
  );
}

function Inner({ data }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(String(data.summary.block));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = query.trim();
    if (!raw) return;
    const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return;
    router.push(`/block/${n}`);
  };

  const ts = new Date(data.summary.timestamp * 1000);
  const tsLabel = ts.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <div
      style={{
        padding: "28px clamp(20px, 3vw, 40px) 56px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      {/* Masthead — pev. lockup left, Monad kicker + meta right */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
          paddingBottom: 22,
          borderBottom: `1px solid ${themeA.border}`,
          marginBottom: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <a href="/" style={{ textDecoration: "none" }}>
            <PEVLockup markSize={26} wordSize={26} />
          </a>
          <span
            className="pev-eyebrow"
            style={{ letterSpacing: ".18em", color: themeA.subtle }}
          >
            Parallel Execution Visualizer
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            fontFamily: themeA.mono,
            fontSize: 11,
            color: themeA.muted,
            whiteSpace: "nowrap",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <span>
            <span style={{ color: themeA.subtle }}>network</span>{" "}
            <span style={{ color: themeA.text }}>monad-testnet</span>
          </span>
          <span>
            <span style={{ color: themeA.subtle }}>rpc</span>{" "}
            <span style={{ color: themeA.text }}>silknodes.io</span>
          </span>
          <span>
            <span style={{ color: themeA.subtle }}>build</span>{" "}
            <span style={{ color: themeA.text }}>v0.1</span>
          </span>
        </div>
      </header>

      {/* Query */}
      <section style={{ marginBottom: 28 }}>
        <div className="pev-eyebrow" style={{ letterSpacing: ".12em", marginBottom: 8 }}>
          block number
        </div>
        <form onSubmit={submit} style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <div style={{ flex: 1 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 70191500"
              style={{
                width: "100%",
                background: themeA.panel,
                border: `1px solid ${themeA.border}`,
                borderRadius: themeA.radius,
                padding: "14px 16px",
                color: themeA.text,
                fontFamily: themeA.mono,
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => (e.target.style.borderColor = themeA.accent)}
              onBlur={(e) => (e.target.style.borderColor = themeA.border)}
            />
          </div>
          <button
            type="submit"
            style={{
              background: themeA.accent,
              color: themeA.onAccent,
              border: "none",
              borderRadius: themeA.radius,
              padding: "0 22px",
              fontSize: 13,
              fontFamily: themeA.sans,
              fontWeight: 500,
              cursor: "pointer",
              letterSpacing: ".01em",
            }}
          >
            Analyze parallel execution →
          </button>
        </form>
        <div
          style={{
            marginTop: 10,
            fontFamily: themeA.mono,
            fontSize: 10,
            color: themeA.subtle,
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <span>Try:</span>
          <a href={`/block/${data.summary.block - 1}`} className="pev-link">
            previous block
          </a>
          <a href={`/block/${data.summary.block + 1}`} className="pev-link">
            next block
          </a>
          <a href="/" className="pev-link">
            recent activity
          </a>
        </div>
      </section>

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

      {/* Section title + mode toggle */}
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
        <div className="pev-display-italic" style={{ fontSize: 20 }}>
          Execution timeline
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="pev-eyebrow" style={{ letterSpacing: ".08em" }}>view</span>
          <ModeToggle />
        </div>
      </section>

      {/* Timeline card */}
      <section
        style={{
          background: themeA.panel,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          padding: "20px 24px 24px",
          marginBottom: 20,
        }}
      >
        <Timeline height={Math.max(220, Math.min(440, 80 + data.waveTxs.length * 56))} />
        <Legend />
      </section>

      {/* Two-up: graph + hot slots */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Card eyebrow="Conflict graph" title="Blocked by">
          <ConflictGraph height={300} />
        </Card>
        <Card eyebrow="Hot storage slots" title="Contention">
          <HotSlots />
        </Card>
      </section>

      {/* Why panel */}
      <section style={{ marginBottom: 4 }}>
        <WhyPanel />
      </section>

      {/* Footer */}
      <section
        style={{
          marginTop: 28,
          paddingTop: 18,
          borderTop: `1px solid ${themeA.border}`,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: themeA.mono,
          fontSize: 10,
          color: themeA.subtle,
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>click any tx to inspect · hover to highlight relations</div>
        <div>parallelism · contention · causality</div>
      </section>
    </div>
  );
}

function Card({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "14px 16px",
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

function Legend() {
  const Item = ({ swatch, label }: { swatch: React.ReactNode; label: string }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {swatch}
      {label}
    </span>
  );
  const swatchSize = { width: 10, height: 10, borderRadius: 2, display: "inline-block" } as const;
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
      <Item
        swatch={<span style={{ ...swatchSize, background: themeA.status.clean }} />}
        label="parallel · wave 0, no conflicts"
      />
      <Item
        swatch={<span style={{ ...swatchSize, background: themeA.status.delayed }} />}
        label="delayed · forced to wait"
      />
      <Item
        swatch={
          <span
            style={{
              ...swatchSize,
              background: `repeating-linear-gradient(135deg, ${themeA.status.source}, ${themeA.status.source} 2px, ${themeA.reexecStripe} 2px, ${themeA.reexecStripe} 4px)`,
            }}
          />
        }
        label="conflict source · blocks others"
      />
    </div>
  );
}
