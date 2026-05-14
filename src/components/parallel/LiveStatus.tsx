"use client";

/**
 * LiveStatus, small status pill in the top-right of the landing page.
 *
 * Two data sources, deliberately decoupled:
 *
 *   1. /api/v1/chain-head  (SSE) , chain head, pushed in real time on
 *      every Monad newHeads event (~0.5s cadence). Drives the visible
 *      "chain #X" number, which TICKS LIVE so the pill feels alive.
 *
 *   2. /api/health         (poll, 4 s), indexer cursor, db block count,
 *      lag computation. Slower-moving data; a 4s poll is plenty.
 *
 * Why two pipes? Because the most valuable number on the page is the
 * chain head, and a 4s poll makes it feel dead. The /api/health endpoint
 * does a Postgres COUNT plus an RPC call, too expensive to hit 5×/sec
 * from every visitor's browser. Splitting the pipes lets the head tick
 * fast (push, near-zero server cost via a single upstream WS) while the
 * heavier health data refreshes at a sane rate.
 *
 * Display shape (when everything is live):
 *
 *   ● live · chain #70,442,943
 *
 * Stripped to the bone on purpose. The chain head is the only number
 * worth animating, every other count (indexed cursor, lag, total
 * analyzed) was either redundant with the status word or made the pill
 * width re-flow on every tick. All of that data still lives in
 * /api/health for ops + debugging, just not in this masthead chip.
 *
 * Status colors (the dot + label):
 *   green  "live"           lag ≤ 20 blocks AND last indexed < 30s ago
 *   amber  "lagging"        lag 20-100 OR last indexed 30-300s ago
 *   red    "stalled"        lag > 100 OR last indexed > 300s ago
 *   red    "db unreachable" health endpoint reports DB error
 *   gray   "offline"        health endpoint not responding
 *
 * Threshold history: the "live" cutoff was originally 5 blocks, set when
 * the DB was small and the pipeline was tight. After scaling to 1.5M+
 * blocks with the pg-boss queue (0.5s polling floor) plus our 2-block
 * finality buffer plus trace+write latency, the steady-state lag for a
 * healthy indexer settles around 7-15 blocks. 5 was making the pill
 * misreport normal operation as "lagging"; 20 reflects what "actually
 * keeping up" looks like at our current architecture.
 *
 * Replaced the older server-rendered IndexerStatus, which showed a
 * stale "10 indexed" count derived from recent-feed length.
 */

import { useEffect, useState } from "react";
import { themeA } from "./theme";

interface HealthShape {
  ok: boolean;
  indexer: {
    lastIndexedBlock: number;
    lastIndexedAt: string | null;
    secondsSinceLastIndex: number | null;
  };
  chain: {
    currentHead: number | null;
    lagBlocks: number | null;
  };
  database: {
    reachable: boolean;
    blocks: number;
    txExecutions: number;
    conflicts: number;
  };
}

type StatusKind = "live" | "lagging" | "stalled" | "db" | "offline";

function classify(h: HealthShape | null): {
  kind: StatusKind;
  label: string;
  dot: string;
} {
  if (!h) return { kind: "offline", label: "offline", dot: themeA.subtle };
  if (!h.database?.reachable)
    return { kind: "db", label: "db unreachable", dot: themeA.status.source };
  const lag = h.chain.lagBlocks;
  const age = h.indexer.secondsSinceLastIndex;
  // "live", keeping up at normal pipeline latency.
  // 20 = comfortable bound around our steady-state ~7-15 block lag.
  if ((lag === null || lag <= 20) && age !== null && age < 30) {
    return { kind: "live", label: "live", dot: themeA.status.clean };
  }
  // "lagging", falling behind but still moving
  if ((lag !== null && lag <= 100) || (age !== null && age < 300)) {
    return { kind: "lagging", label: "lagging", dot: themeA.status.delayed };
  }
  return { kind: "stalled", label: "stalled", dot: themeA.status.source };
}

export default function LiveStatus() {
  // Slow pipe: poll /api/health every 4s for indexer cursor + db stats.
  const [health, setHealth] = useState<HealthShape | null>(null);

  // Fast pipe: SSE pushes the chain head on every Monad block (~0.5s).
  // This is what makes the "chain #X" number tick visibly. We reuse
  // health.chain.currentHead as a cold-start fallback.
  const [liveHead, setLiveHead] = useState<number | null>(null);
  // Subtle visual pulse on each new head, see the JSX below for the
  // CSS animation hook (`headFlashKey` re-mounts a tiny span so its
  // animation re-triggers per tick).
  const [headFlashKey, setHeadFlashKey] = useState(0);

  // ── slow pipe: /api/health poll ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as HealthShape;
        if (!cancelled) setHealth(data);
      } catch {
        // network blip, keep last good state, don't flip to offline yet
      }
    };
    tick(); // immediate
    const interval = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ── fast pipe: /api/v1/chain-head SSE ─────────────────────────
  // EventSource auto-reconnects on transient errors, so we don't need
  // our own backoff loop. Only worry: if the SSE endpoint never works
  // (e.g. MONAD_WS_URL not set on server), we silently fall back to the
  // /api/health chain head, still correct, just slower.
  useEffect(() => {
    const es = new EventSource("/api/v1/chain-head");
    es.addEventListener("head", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { head: number };
        if (typeof data.head === "number" && data.head > 0) {
          setLiveHead((prev) =>
            prev === null || data.head > prev ? data.head : prev,
          );
          setHeadFlashKey((k) => k + 1);
        }
      } catch {
        /* malformed event, drop */
      }
    });
    return () => es.close();
  }, []);

  const status = classify(health);

  // Chain head: SSE wins (sub-second), /api/health poll is the cold-start
  // fallback. We don't display anything else from `health`, only the
  // status label, which classify() derives from `lagBlocks` + last-index
  // age. (See header comment for the rationale on the minimal display.)
  const chainHead = liveHead ?? health?.chain.currentHead ?? null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: themeA.mono,
        fontSize: 11,
        color: themeA.muted,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: status.dot,
          display: "inline-block",
          // Pulse only when truly live, otherwise it'd feel dishonest
          animation:
            status.kind === "live"
              ? "pev-pulse 2s ease-in-out infinite"
              : undefined,
        }}
      />
      <span style={{ color: themeA.text }}>{status.label}</span>

      {/* Chain head, the live heartbeat that ticks up. Always show when
          we have a value, regardless of status (it's the most useful
          single number on the page). The `key={headFlashKey}` trick
          re-mounts the inner span on each new head, re-triggering the
          `pev-head-flash` animation, a brief warm-text glow that makes
          the tick visible without being annoying. */}
      {chainHead !== null && (
        <span style={{ color: themeA.subtle }}>
          · chain{" "}
          <span
            key={headFlashKey}
            style={{
              color: themeA.text,
              animation: "pev-head-flash 600ms ease-out",
              // tabular-nums keeps the digits at fixed widths so the
              // number doesn't jiggle horizontally as it ticks
              fontVariantNumeric: "tabular-nums",
              display: "inline-block",
            }}
          >
            #{chainHead.toLocaleString()}
          </span>
        </span>
      )}

    </div>
  );
}
