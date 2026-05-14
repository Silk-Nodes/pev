import { getLatestSafeBlockNumber, probeBlock } from "@/lib/parallel-probe";
import { probeToPEV, shortHex } from "@/lib/probe-to-pev";
import { themeA, palette } from "@/components/parallel/theme";
import { PEVLockup, PEVMark } from "@/components/parallel/PEVBrand";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "pev — Parallel Execution Visualizer for Monad",
  description:
    "Is your contract killing parallelism? Paste a block. pev reconstructs the execution graph, surfaces storage contention, and tells you which slots are costing you throughput.",
};

export const revalidate = 30;

/**
 * Landing — masthead, search, latest-block preview, principles.
 * Mirrors the Brand Book "Landing hero" (Chapter 08) and the cover
 * page treatment (warm ember radial glow on top-right).
 */
export default async function PEVLanding() {
  const latest = await getLatestSafeBlockNumber();

  // Find a recent block with at least one tx for the live preview
  let previewProbe = await probeBlock(latest);
  let attempts = 0;
  let blockN = latest;
  while (previewProbe.txCount === 0 && attempts < 10) {
    blockN -= 1;
    attempts += 1;
    previewProbe = await probeBlock(blockN);
  }
  const preview = probeToPEV(previewProbe);

  return (
    <main className="pev-cover-glow" style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px clamp(20px, 4vw, 64px) 80px" }}>
        {/* ─── Top bar: lockup left, kicker right ─────────────────────── */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingBottom: 18,
            marginBottom: 56,
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <PEVLockup markSize={26} wordSize={26} />
          <div
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.muted,
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <span>
              <span style={{ color: themeA.subtle }}>network</span>{" "}
              <span style={{ color: themeA.text }}>monad-testnet</span>
            </span>
            <span>
              <span style={{ color: themeA.subtle }}>build</span>{" "}
              <span style={{ color: themeA.text }}>v0.1</span>
            </span>
          </div>
        </header>

        {/* ─── Hero ───────────────────────────────────────────────────── */}
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

          {/* Search */}
          <form
            action="/go"
            style={{
              display: "flex",
              gap: 10,
              alignItems: "stretch",
              marginTop: 32,
              maxWidth: 640,
            }}
          >
            <input
              type="text"
              name="block"
              placeholder="0x… or block number, e.g. 70191500"
              style={{
                flex: 1,
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
            />
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
                whiteSpace: "nowrap",
              }}
            >
              Analyze →
            </button>
          </form>
        </section>

        {/* ─── Latest block preview ───────────────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
            Latest analyzed block
          </div>
          <a
            href={`/block/${preview.summary.block}`}
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
                #{preview.summary.block.toLocaleString()}
              </span>
              <span
                className="pev-mono"
                style={{ fontSize: 12, color: themeA.muted }}
              >
                {preview.summary.txCount} txs · {preview.summary.statefulTxCount}{" "}
                stateful · {shortHex(preview.summary.blockHash, 8, 6)}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <Stat label="Parallelism" value={`${preview.summary.parallelismScore}/100`} accent />
              <Stat label="Blocked" value={`${preview.summary.blockedPct}%`} />
              <Stat label="Waves" value={String(preview.summary.waves)} />
              <Stat label="Conflicts" value={String(preview.summary.conflictCount)} />
            </div>

            <div
              className="pev-mono"
              style={{ fontSize: 11, color: themeA.subtle, marginTop: 20 }}
            >
              click to inspect →
            </div>
          </a>
        </section>

        {/* ─── Brand Book "Three Principles" ──────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 18 }}>
            Three principles
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <Principle
              n="01"
              title="Clarity before aesthetics."
              body="The design defers to the data. Decoration exists only where it helps a developer see cause and effect faster."
            />
            <Principle
              n="02"
              title="Causality over summary."
              body="A dashboard shows what is. pev shows what caused what. The brand should feel investigative, not reportorial."
            />
            <Principle
              n="03"
              title="Technical, but literate."
              body="Monospace for the truth — hashes, slots, gas. Serif for the voice. Sans for the interface. A three-voice system that stays distinct."
            />
          </div>
        </section>

        {/* ─── What we measure ─────────────────────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 14 }}>
            What we measure
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <Card
              title="Parallelism Score"
              body="Theoretical speedup vs. serial execution, on a 0–100 scale. Higher means the same work could finish in fewer rounds."
            />
            <Card
              title="Execution Waves"
              body="Minimum number of sequential rounds the block needs because of storage conflicts. Lower is more parallel."
            />
            <Card
              title="Hot Storage Slots"
              body="Storage slots touched by multiple txs in the same block — the bottlenecks."
            />
          </div>
        </section>

        {/* ─── Honesty ─────────────────────────────────────────────────── */}
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
            What this is — and isn't
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
            parallelism — the maximum speedup the block's conflict structure
            allows — not what Monad's scheduler actually decided. That's
            internal and not exposed via RPC, so we don't fake it. Method
            names and contract labels coming soon (4byte + Sourcify).
          </p>
        </section>

        {/* ─── Footer ──────────────────────────────────────────────────── */}
        <footer
          style={{
            paddingTop: 22,
            borderTop: `1px solid ${themeA.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PEVMark size={18} />
            <span
              className="pev-mono"
              style={{ fontSize: 10, color: themeA.subtle, letterSpacing: ".15em" }}
            >
              PEV · EDITION 01 · SPRING 2026
            </span>
          </div>
          <span
            className="pev-mono"
            style={{ fontSize: 10, color: themeA.subtle, letterSpacing: ".05em" }}
          >
            Built by Silk Nodes · RPC <span style={{ color: themeA.text }}>rpc.silknodes.io/monad</span>
          </span>
        </footer>
      </div>
    </main>
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
      <div
        className="pev-display-italic"
        style={{ fontSize: 18, marginBottom: 8 }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13, color: themeA.muted, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function Principle({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 24,
        alignItems: "baseline",
      }}
    >
      <span
        className="pev-mono"
        style={{ fontSize: 11, color: themeA.subtle, letterSpacing: ".15em" }}
      >
        {n}
      </span>
      <div>
        <div
          className="pev-display-italic"
          style={{ fontSize: 24, color: themeA.text, marginBottom: 4 }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: themeA.muted,
            lineHeight: 1.55,
            maxWidth: "58ch",
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}
