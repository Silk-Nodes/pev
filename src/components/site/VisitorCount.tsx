"use client";

/**
 * VisitorCount, the small "1,234 visits" counter rendered in SiteFooter.
 *
 * Two distinct behaviors that are deliberately decoupled:
 *
 *   1. ALWAYS counts. On mount, this component POSTs /api/v1/visit (deduped
 *      per browser tab via sessionStorage) so the counter increments
 *      regardless of whether anyone's looking at the displayed number.
 *      That way, when we flip the display flag on, the value already
 *      reflects real history, no "Day 1: 0 visits" embarrassment.
 *
 *   2. CONDITIONALLY displays. Renders nothing unless the env var
 *      NEXT_PUBLIC_SHOW_VISITOR_COUNT === "true". So we can keep
 *      counting in the dark for a few weeks, then flip the flag once
 *      the number is decent (whatever "decent" means to you).
 *
 * To enable display: set NEXT_PUBLIC_SHOW_VISITOR_COUNT=true in
 * .env.production.local on the VM, rebuild + redeploy. NEXT_PUBLIC_*
 * env vars are inlined at build time by Next.js, so a runtime restart
 * alone won't pick up the change.
 */

import { useEffect, useState } from "react";
import { themeA } from "@/components/parallel/theme";

const SESSION_FLAG_KEY = "pev:visit-counted";

interface VisitResponse {
  count: number | null;
}

export default function VisitorCount() {
  const showDisplay = process.env.NEXT_PUBLIC_SHOW_VISITOR_COUNT === "true";

  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Per-tab dedupe. sessionStorage clears when the tab closes, so
      // refreshing the same tab counts as one visit, opening a new tab
      // counts as another. That's the cleanest "session" definition that
      // doesn't require cookies or persistent identifiers.
      let alreadyCounted = false;
      try {
        alreadyCounted = sessionStorage.getItem(SESSION_FLAG_KEY) === "1";
      } catch {
        /* sessionStorage blocked (private browsing/iframe), count anyway,
           the cost is some inflation but the number is still useful */
      }

      try {
        const res = await fetch("/api/v1/visit", {
          method: alreadyCounted ? "GET" : "POST",
          // We don't send any body or credentials, the endpoint just
          // increments a single counter row. No cookies, no IDs.
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as VisitResponse;
        if (!cancelled && typeof data.count === "number") {
          setCount(data.count);
        }
        if (!alreadyCounted) {
          try {
            sessionStorage.setItem(SESSION_FLAG_KEY, "1");
          } catch {
            /* see above */
          }
        }
      } catch {
        /* network blip, leave count as null, we just don't render */
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Display gate. Counting still happened above regardless.
  if (!showDisplay) return null;

  // Don't show "0" or a skeleton while loading, feels like an unloaded
  // widget. Render nothing until we have a real number.
  if (count === null) return null;

  return (
    <span
      className="pev-mono"
      style={{
        fontSize: 10,
        // Bumped from subtle → muted for footer-readability, matches
        // SiteFooter's "Built by Silk Nodes" treatment.
        color: themeA.muted,
        letterSpacing: ".05em",
      }}
    >
      {count.toLocaleString()} visits
    </span>
  );
}
