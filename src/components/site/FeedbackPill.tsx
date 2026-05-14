/**
 * FeedbackPill, fixed-position CTA in the bottom-left that links to
 * /feedback.
 *
 * Modeled after the Featurebase-style floating button: small,
 * persistent, doesn't compete with page content. Uses brand tokens
 * (mono font, accent dot, panel background) so it reads as part of
 * pev rather than a third-party widget overlay.
 *
 * No JS state, no client component. The whole element is a single
 * Link with a small pulse animation defined in globals.css
 * (pev-pulse, already used by the contract loading skeleton).
 *
 * Positioning notes:
 *   • Fixed bottom-left so it's always reachable on long pages
 *   • z-index high enough to sit above ordinary content but below
 *     ConsentBanner (which is bottom-centered, no collision)
 *   • Hidden on mobile to avoid covering the floating SearchBox area;
 *     on screens <600px wide the footer link to /feedback is enough
 */

import Link from "next/link";
import { themeA } from "@/components/parallel/theme";

export default function FeedbackPill() {
  return (
    <Link
      href="/feedback"
      aria-label="Submit a feature request or vote on existing ones"
      style={{
        position: "fixed",
        bottom: 20,
        left: 20,
        zIndex: 50,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: themeA.bg,
        border: `1px solid ${themeA.border}`,
        borderRadius: 999,
        padding: "8px 14px 8px 12px",
        fontFamily: themeA.mono,
        fontSize: 11,
        color: themeA.text,
        letterSpacing: ".04em",
        textDecoration: "none",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
        // Hide on narrow viewports where it would collide with content.
        // The footer also has a "Feedback" link so the entry point is
        // still reachable from phones.
      }}
      className="pev-feedback-pill"
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: themeA.accent,
          boxShadow: `0 0 8px ${themeA.accent}`,
          animation: "pev-pulse 1.8s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <span>Feature requests</span>
      <span style={{ color: themeA.subtle, marginLeft: 2 }}>→</span>
    </Link>
  );
}
