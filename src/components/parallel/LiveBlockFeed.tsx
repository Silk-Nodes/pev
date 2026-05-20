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
 *   • Fresh rows also slide down from the top of the list with a short
 *     translate-Y animation so the arrival reads as motion, not a jump
 *   • A small live-status pill above the list shows: connected (sage
 *     pulse), reconnecting (amber), offline (terracotta)
 *   • List is capped at maxRows (default 10), older rows fall off
 *
 * Pause-on-hover: when the cursor enters the feed, incoming blocks go
 * into a hidden queue instead of pushing visible rows around. A chip
 * appears at the top reading "N new blocks, click to load" so the user
 * always knows fresh data is waiting. The queued blocks flow in when
 * the cursor leaves OR the user clicks the chip. This lets readers
 * actually read a row without it scrolling out from under them, while
 * the feed remains genuinely live (status pill stays green, queue
 * fills in real time).
 *
 * Why client-side EventSource (not server push):
 *   • SSE is the simplest "server → many clients" pattern
 *   • Auto-reconnects via the browser's built-in EventSource semantics
 *   • Plays nice with Next.js's dynamic route handlers
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { themeA } from "./theme";
import { shortHex } from "@/lib/probe-to-pev";
import type { BlockSummaryRow } from "@/lib/indexer/store";
import Link from "next/link";

interface Props {
  initial: BlockSummaryRow[];
  /**
   * How many rows to keep on screen. Default 10 (was 20): Monad blocks
   * arrive every ~0.5-1s, and with 20 visible rows the constant
   * shifting made the feed hard to read. 10 is enough recency without
   * the visual footprint dominating the page.
   */
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

export default function LiveBlockFeed({ initial, maxRows = 10 }: Props) {
  const [blocks, setBlocks] = useState<BlockSummaryRow[]>(initial.slice(0, maxRows));
  // Blocks that arrived while the user was hovering the feed. They live
  // here until the user moves away or clicks the chip; then they flow
  // into `blocks` all at once with the fresh-highlight animation.
  const [queue, setQueue] = useState<BlockSummaryRow[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  // Track which numbers are "fresh" so we can highlight them briefly.
  const freshRef = useRef<Set<number>>(new Set());
  const [, force] = useState(0);
  // pausedRef mirrors the paused state for the SSE handler, which is
  // set up once in useEffect and would otherwise capture a stale
  // closure of the React state value. Updating the ref synchronously
  // in onMouseEnter/onMouseLeave avoids the brief race where a block
  // arrives between setPaused(false) and React's re-render.
  const pausedRef = useRef(false);

  // Mark a set of block numbers as fresh, schedule cleanup. Used by
  // both the live-prepend path (single block) and the flush-on-resume
  // path (potentially many at once).
  const markFresh = useCallback((numbers: number[]) => {
    for (const n of numbers) freshRef.current.add(n);
    force((x) => x + 1);
    setTimeout(() => {
      for (const n of numbers) freshRef.current.delete(n);
      force((x) => x + 1);
    }, 1600);
  }, []);

  // Drain the queue into the visible list. Called on mouse-leave and
  // on chip click. Idempotent: empty queue is a no-op.
  const flushQueue = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) return q;
      setBlocks((prev) => {
        const seen = new Set(prev.map((b) => b.number));
        const incoming = q.filter((b) => !seen.has(b.number));
        if (incoming.length === 0) return prev;
        const merged = [...incoming, ...prev].slice(0, maxRows);
        markFresh(incoming.map((b) => b.number));
        return merged;
      });
      return [];
    });
  }, [maxRows, markFresh]);

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

        if (pausedRef.current) {
          // User is hovering, queue silently. The chip count updates
          // in the UI but the visible list stays still.
          setQueue((prev) => {
            if (prev.some((b) => b.number === newRow.number)) return prev;
            // Cap queue at maxRows; if more arrive while hovering,
            // drop the oldest queued block (the user can't see it
            // anyway, and capping keeps memory bounded).
            return [newRow, ...prev].slice(0, maxRows);
          });
          return;
        }

        setBlocks((prev) => {
          // Skip dupes (the indexer can re-emit if we re-process)
          if (prev.some((b) => b.number === newRow.number)) return prev;
          // Newest first; cap length
          return [newRow, ...prev].slice(0, maxRows);
        });
        markFresh([ev.number]);
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
  }, [maxRows, markFresh]);

  return (
    <div
      // Hover anywhere on the feed (including the header row, so users
      // glancing at the status pill don't accidentally unpause) pauses
      // the live prepend. Mouse-leave flushes any queued blocks.
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
        flushQueue();
      }}
    >
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

      {/* Queue indicator: only renders when blocks are waiting. Click
          to flush immediately without moving the cursor off the feed.
          The mouse-leave handler on the wrapper also flushes, so the
          chip is more "you can also click here" than the only way out. */}
      {queue.length > 0 && (
        <button
          type="button"
          onClick={flushQueue}
          aria-label={`Load ${queue.length} new block${queue.length === 1 ? "" : "s"}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "8px 12px",
            marginBottom: 8,
            background: "rgba(226, 140, 82, 0.08)",
            border: `1px dashed ${themeA.accent}`,
            borderRadius: themeA.radius,
            color: themeA.accent,
            fontFamily: themeA.mono,
            fontSize: 11,
            letterSpacing: "0.05em",
            cursor: "pointer",
            // Pulse just the background to draw the eye without becoming
            // a visual nag. Subtle enough not to compete with the rest
            // of the editorial layout.
            animation: "pev-pulse 2.4s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>↑</span>
          <span>
            {queue.length} new block{queue.length === 1 ? "" : "s"}, click or move away to load
          </span>
        </button>
      )}

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
        // Slide the row in from above when it's a fresh arrival. The
        // ember tint + slide together communicate "new" as motion
        // rather than as an abrupt position change. Other rows still
        // jump down by one row's height (a full FLIP animation across
        // siblings would need a 3rd-party lib); the slide on just the
        // entering row is enough to make the arrival read as smooth.
        animation: fresh ? "pev-row-slide-in 260ms ease-out" : undefined,
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
