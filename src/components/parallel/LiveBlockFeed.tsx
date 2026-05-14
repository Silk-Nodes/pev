"use client";

/**
 * LiveBlockFeed, drop-in replacement for the static "Recent activity"
 * list. Hydrates with server-rendered initial blocks (no flash), then
 * subscribes to /api/v1/live and prepends new rows as the indexer
 * commits them.
 *
 * Visual cues:
 *   • New rows fade in with an ember-tinted background, then settle to
 *     the normal panel color over 1.5s
 *   • A small live-status pill above the list shows: connected (sage
 *     pulse), reconnecting (amber), offline (terracotta)
 *   • List is capped at MAX_ROWS (default 20), older rows fall off
 *
 * Why client-side EventSource (not server push):
 *   • SSE is the simplest "server → many clients" pattern
 *   • Auto-reconnects via the browser's built-in EventSource semantics
 *   • Plays nice with Next.js's dynamic route handlers
 */

import { useEffect, useRef, useState } from "react";
import { themeA } from "./theme";
import { shortHex } from "@/lib/probe-to-pev";
import type { BlockSummaryRow } from "@/lib/indexer/store";
import Link from "next/link";

interface Props {
  initial: BlockSummaryRow[];
  /** how many rows to keep on screen */
  maxRows?: number;
}

/**
 * The shape pushed by /api/v1/live `event: block`. Slightly different
 * from BlockSummaryRow (timestamp is ISO string from JSON), so we
 * normalize when prepending.
 */
interface LiveBlockEvent {
  number: number;
  hash: string;
  timestamp: string;
  txCount: number;
  parallelismScore: number;
  blockedPct: number;
  conflictCount: number;
  executionDepth: number;
}

type Status = "connecting" | "live" | "offline";

export default function LiveBlockFeed({ initial, maxRows = 20 }: Props) {
  const [blocks, setBlocks] = useState<BlockSummaryRow[]>(initial);
  const [status, setStatus] = useState<Status>("connecting");
  // Track which numbers are "fresh" so we can highlight them briefly
  const freshRef = useRef<Set<number>>(new Set());
  const [, force] = useState(0);

  useEffect(() => {
    const es = new EventSource("/api/v1/live");

    es.addEventListener("hello", () => setStatus("live"));

    es.addEventListener("block", (raw) => {
      try {
        const ev = JSON.parse((raw as MessageEvent).data) as LiveBlockEvent;
        const newRow: BlockSummaryRow = {
          number: ev.number,
          hash: ev.hash,
          timestamp: new Date(ev.timestamp),
          txCount: ev.txCount,
          parallelismScore: ev.parallelismScore,
          blockedPct: ev.blockedPct,
          conflictCount: ev.conflictCount,
          executionDepth: ev.executionDepth,
        };
        setBlocks((prev) => {
          // Skip dupes (the indexer can re-emit if we re-process)
          if (prev.some((b) => b.number === newRow.number)) return prev;
          // Newest first; cap length
          return [newRow, ...prev].slice(0, maxRows);
        });
        // Mark as fresh, then unmark after the highlight transition
        freshRef.current.add(ev.number);
        force((n) => n + 1);
        setTimeout(() => {
          freshRef.current.delete(ev.number);
          force((n) => n + 1);
        }, 1600);
      } catch (e) {
        console.warn("[live-feed] bad block event", e);
      }
    });

    es.onopen = () => setStatus("live");
    es.onerror = () => {
      // EventSource auto-reconnects with built-in backoff
      setStatus("offline");
      // If/when it recovers, the next 'hello' or 'open' will flip us back
    };

    return () => {
      es.close();
    };
  }, [maxRows]);

  return (
    <div>
      {/* Status pill, small and quiet */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <div className="pev-eyebrow">Recent activity</div>
        <StatusPill status={status} />
      </div>

      <div
        style={{
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          overflow: "hidden",
        }}
      >
        {blocks.length === 0 ? (
          <div
            style={{
              padding: "20px 16px",
              fontFamily: themeA.mono,
              fontSize: 12,
              color: themeA.muted,
              textAlign: "center",
            }}
          >
            no blocks indexed yet, start the indexer with{" "}
            <span style={{ color: themeA.text }}>npm run indexer</span>
          </div>
        ) : (
          blocks.map((b, i) => (
            <Row
              key={b.number}
              block={b}
              isLast={i === blocks.length - 1}
              fresh={freshRef.current.has(b.number)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const labels: Record<Status, { dot: string; text: string }> = {
    connecting: { dot: themeA.subtle, text: "connecting" },
    live: { dot: themeA.status.clean, text: "live" },
    offline: { dot: themeA.status.source, text: "reconnecting" },
  };
  const s = labels[status];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: themeA.mono,
        fontSize: 10,
        color: themeA.muted,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: s.dot,
          // Pulse on live
          animation: status === "live" ? "pev-pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      {s.text}
    </div>
  );
}

function Row({
  block,
  isLast,
  fresh,
}: {
  block: BlockSummaryRow;
  isLast: boolean;
  fresh: boolean;
}) {
  const color =
    block.parallelismScore >= 70
      ? themeA.status.clean
      : block.parallelismScore >= 40
        ? themeA.status.delayed
        : themeA.status.source;

  // age relative to now (re-renders are infrequent so this is approximate)
  const ts = block.timestamp instanceof Date ? block.timestamp : new Date(block.timestamp);
  const ageSec = Math.max(0, Math.round((Date.now() - ts.getTime()) / 1000));
  const ageLabel =
    ageSec < 60
      ? `${ageSec}s`
      : ageSec < 3600
        ? `${Math.round(ageSec / 60)}m`
        : `${Math.round(ageSec / 3600)}h`;

  return (
    <Link
      href={`/block/${block.number}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto auto auto",
        gap: 18,
        alignItems: "center",
        padding: "12px 18px",
        borderBottom: isLast ? "none" : `1px solid ${themeA.border}`,
        textDecoration: "none",
        color: themeA.text,
        fontFamily: themeA.mono,
        fontSize: 12,
        background: fresh ? "rgba(226, 140, 82, 0.10)" : "transparent",
        transition: "background 1.4s ease-out",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span style={{ color: themeA.text }}>
        #{block.number.toLocaleString()}
        <span style={{ color: themeA.subtle, marginLeft: 10 }}>{shortHex(block.hash, 6, 4)}</span>
      </span>
      <span style={{ color: themeA.muted, whiteSpace: "nowrap" }}>{block.txCount} tx</span>
      <span style={{ color, whiteSpace: "nowrap" }}>{block.parallelismScore}/100</span>
      <span style={{ color: themeA.muted, whiteSpace: "nowrap" }}>
        {block.conflictCount} conf
      </span>
      <span style={{ color: themeA.subtle, whiteSpace: "nowrap" }}>{ageLabel} ago</span>
    </Link>
  );
}
