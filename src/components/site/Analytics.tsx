"use client";

/**
 * Analytics, loads Google Analytics ONLY after the user accepts via the
 * ConsentBanner. Until then, no third-party requests are made.
 *
 * Pairs with components/site/ConsentBanner.tsx, that component owns the
 * "ask the user" UI and writes the decision to localStorage. This one
 * just listens for the decision and conditionally renders the gtag
 * script tags.
 *
 * Why conditional load instead of Google Consent Mode v2:
 *   Consent Mode v2 loads gtag immediately with `default: denied` and
 *   activates on consent. More compliant for pre-consent measurement
 *   but adds a third-party request even for users who never accept.
 *   Conditional load is simpler and stricter: zero data exfil pre-consent.
 *
 * To revoke consent later: clear localStorage['pev:analytics-consent']
 * in DevTools, refresh, banner reappears. (We don't expose a UI for
 * this yet because nobody's asked for it.)
 */

import Script from "next/script";
import { useEffect, useState } from "react";
import {
  CONSENT_KEY,
  CONSENT_EVENT_ACCEPTED,
  CONSENT_EVENT_DECLINED,
  type ConsentDecision,
} from "./consent-shared";

const GA_MEASUREMENT_ID = "G-LJBQ3W2GNC";

export default function Analytics() {
  const [consent, setConsent] = useState<ConsentDecision>(null);

  useEffect(() => {
    // Read the stored decision on first mount (SSR-safe, only runs client-side).
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored === "accepted" || stored === "declined") {
        setConsent(stored);
      }
    } catch {
      /* localStorage blocked (private browsing, etc.), treat as no decision */
    }

    // Live-react to the banner's decision events so the gtag tags load
    // immediately on accept, no page refresh needed.
    const onAccepted = () => setConsent("accepted");
    const onDeclined = () => setConsent("declined");
    window.addEventListener(CONSENT_EVENT_ACCEPTED, onAccepted);
    window.addEventListener(CONSENT_EVENT_DECLINED, onDeclined);
    return () => {
      window.removeEventListener(CONSENT_EVENT_ACCEPTED, onAccepted);
      window.removeEventListener(CONSENT_EVENT_DECLINED, onDeclined);
    };
  }, []);

  if (consent !== "accepted") return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            anonymize_ip: true
          });
        `}
      </Script>
    </>
  );
}
