"use client";

/**
 * VoteButton, client-side toggle for upvoting a feedback request.
 *
 * Optimistic: flips the UI immediately on click, fires the API in the
 * background, reconciles with the server response. If the server says
 * something different (e.g. count was already +1 from another tab), we
 * use the server value as truth.
 *
 * Disabled state: brief disable during the request to prevent
 * double-click spam. Doesn't matter for correctness (the API is
 * idempotent at the cookie level) but avoids confusing flicker.
 */

import { useState, useTransition } from "react";
import { themeA } from "@/components/parallel/theme";

interface Props {
  requestId: number;
  initialVoted: boolean;
  initialCount: number;
  /** Disable voting entirely (e.g. for shipped/declined items). */
  disabled?: boolean;
}

export default function VoteButton({
  requestId,
  initialVoted,
  initialCount,
  disabled = false,
}: Props) {
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (disabled || pending) return;
    // Optimistic flip
    const nextVoted = !voted;
    const nextCount = nextVoted ? count + 1 : Math.max(0, count - 1);
    setVoted(nextVoted);
    setCount(nextCount);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/v1/feedback/${requestId}/vote`, {
          method: "POST",
        });
        if (!res.ok) {
          // Roll back on failure. 404 means the request disappeared,
          // 5xx means transient server issue; either way revert.
          setVoted(!nextVoted);
          setCount(count);
          return;
        }
        const data = (await res.json()) as {
          voted: boolean;
          voteCount: number;
        };
        // Reconcile with server truth (might differ if multiple tabs).
        setVoted(data.voted);
        setCount(data.voteCount);
      } catch {
        setVoted(!nextVoted);
        setCount(count);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || pending}
      aria-pressed={voted}
      aria-label={voted ? "Remove your vote" : "Upvote this request"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        minWidth: 56,
        padding: "10px 6px",
        background: voted ? themeA.hintBg : "transparent",
        border: `1px solid ${voted ? themeA.accent : themeA.border}`,
        borderRadius: themeA.radius,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms ease, border-color 120ms ease",
        fontFamily: themeA.mono,
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 11,
          lineHeight: 1,
          color: voted ? themeA.accent : themeA.muted,
        }}
      >
        ▲
      </span>
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.1,
          color: voted ? themeA.accent : themeA.text,
          fontWeight: 500,
        }}
      >
        {count}
      </span>
    </button>
  );
}
