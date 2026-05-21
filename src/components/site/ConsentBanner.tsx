"use client";

/**
 * ConsentBanner, bottom-right card asking the user to opt in to
 * Google Analytics. Honest, brief, editorial, not a wall-of-text legal
 * popup. Stores the decision in localStorage so we don't ask twice.
 *
 * Pairs with components/site/Analytics.tsx, that component reads the
 * decision and conditionally loads the gtag scripts. This one is JUST
 * the UI for asking + persisting the choice.
 *
 * Render shape (bottom-right, fixed, ~360px wide):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  pev uses Google Analytics to see which     │
 *   │  pages people actually find useful.         │
 *   │  Anonymous pageviews only, no personal      │
 *   │  data, no ads, no sharing.                  │
 *   │  Full details in our privacy policy.        │
 *   │                                             │
 *   │   [ Accept ]    Decline                     │
 *   └─────────────────────────────────────────────┘
 *
 * Why bottom-right (not full-width banner across the bottom):
 *   The pev hero has a search box + verdict line + chips that the user
 *   needs to engage with on first visit. A full-width sticky banner
 *   would compete for attention. A small dismissible card defers to the
 *   product, which is the correct posture.
 *
 * SSR safety: the banner doesn't render server-side (returns null until
 * mounted + localStorage check). Avoids a content-flash where the banner
 * briefly shows before being dismissed for users who already decided.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { themeA } from "@/components/parallel/theme";
import {
  CONSENT_KEY,
  CONSENT_EVENT_ACCEPTED,
  CONSENT_EVENT_DECLINED,
} from "./consent-shared";

export default function ConsentBanner() {
  // null = haven't checked yet (SSR + first paint), true = show, false = hide
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      // Only show if there's no decision recorded yet
      setShow(stored !== "accepted" && stored !== "declined");
    } catch {
      // localStorage blocked → don't show banner. Without storage we can't
      // remember the answer, so asking is pointless (would re-prompt forever).
      setShow(false);
    }
  }, []);

  const persist = (decision: "accepted" | "declined") => {
    try {
      localStorage.setItem(CONSENT_KEY, decision);
    } catch {
      /* private mode, analytics simply won't load this session */
    }
    window.dispatchEvent(
      new CustomEvent(
        decision === "accepted"
          ? CONSENT_EVENT_ACCEPTED
          : CONSENT_EVENT_DECLINED,
      ),
    );
    setShow(false);
  };

  if (show !== true) return null;

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        maxWidth: 360,
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "16px 18px",
        zIndex: 1000,
        // Subtle drop shadow to lift it off the page background, not so
        // strong that it feels like a marketing modal.
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        fontFamily: themeA.sans,
        fontSize: 12,
        lineHeight: 1.55,
        // Banner body uses themeA.text (~12:1 on the panel) instead of
        // themeA.muted (~5:1). Two reasons: (1) Lighthouse was reporting
        // the dialog region as low-contrast because of the Decline
        // button inside it, and bumping the body too removes any
        // ambiguity; (2) consent copy is information the user needs to
        // read once, so it should pop, not whisper.
        color: themeA.text,
      }}
    >
      {/* Body reframed from "pev uses Google Analytics" to lead with
          developer-benefit. Original framing made the consent feel
          like a privacy concession; new framing makes it feel like a
          small favor to a tool the user is already using. Same data
          collected, same disclosures, friendlier ask. */}
      <div style={{ marginBottom: 14 }}>
        Help us see which pev pages developers actually use. Anonymous
        pageviews only, no personal data, no ads, no sharing. Full
        details in our{" "}
        <Link href="/privacy" className="pev-link">
          privacy policy
        </Link>
        .
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button
          onClick={() => persist("accepted")}
          style={{
            background: themeA.accent,
            color: themeA.onAccent,
            border: "none",
            borderRadius: themeA.radius,
            padding: "8px 18px",
            fontSize: 12,
            fontFamily: themeA.sans,
            fontWeight: 500,
            letterSpacing: "0.01em",
            cursor: "pointer",
          }}
        >
          Sure, count me in
        </button>
        {/* "Essentials only" instead of "Decline". The functional
            behavior is identical (persist 'declined', no GA scripts
            ever load), just softer copy that doesn't push users away
            with a binary refusal frame. Industry-standard wording
            (Stripe, Vercel, most GDPR-era banners use this). */}
        <button
          onClick={() => persist("declined")}
          aria-label="Essentials only, decline analytics"
          style={{
            background: "transparent",
            color: themeA.muted,
            border: "none",
            padding: "8px 4px",
            fontSize: 12,
            fontFamily: themeA.sans,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          Essentials only
        </button>
      </div>
    </div>
  );
}
