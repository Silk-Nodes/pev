"use client";

/**
 * error.tsx, the branded error boundary for unhandled exceptions in
 * any route under the root layout.
 *
 * Why "use client": Next.js error boundaries must be Client Components
 * because they use React's error-boundary mechanism + the `reset()`
 * function returned by Next.js to clear the error state and re-attempt
 * the failed render.
 *
 * What triggers this:
 *   • A Server Component throws (DB unreachable, RPC down, etc.)
 *   • A Client Component throws during render
 *   • An async data fetch in a page rejects without being caught
 *
 * Intentionally minimal: this page is shown when something already
 * went wrong, so we don't want to depend on the SiteHeader (which
 * pulls LiveStatus + search + lots of imports). If error.tsx itself
 * threw, the user would see a blank screen with no recovery. Keep
 * the imports tight, no DB or RPC calls.
 */

import { useEffect } from "react";
import Link from "next/link";
import { themeA } from "@/components/parallel/theme";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to browser console so the user (or whoever's debugging) can
    // grab the stack trace from DevTools. A production setup would send
    // this to Sentry / Datadog / similar; for now console is enough.
    console.error("[pev] unhandled render error:", error);
  }, [error]);

  return (
    <main
      style={{
        padding: "48px clamp(20px, 4vw, 64px)",
        maxWidth: 640,
        margin: "0 auto",
        minHeight: "60vh",
      }}
    >
      <div
        className="pev-eyebrow"
        style={{ color: themeA.muted, marginBottom: 12 }}
      >
        Something broke
      </div>
      <h1
        className="pev-display-italic"
        style={{
          fontSize: "clamp(32px, 5vw, 48px)",
          color: themeA.text,
          lineHeight: 1.05,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        That request didn&apos;t complete.
      </h1>
      <p
        style={{
          color: themeA.muted,
          lineHeight: 1.7,
          fontSize: 15,
          marginTop: 18,
          maxWidth: "60ch",
        }}
      >
        pev hit an unexpected error rendering this page. Could be a transient
        database hiccup, an RPC blip, or a real bug. You can try again or head
        back home.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 24,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => reset()}
          style={{
            background: themeA.accent,
            color: "#1a0f08",
            border: "none",
            borderRadius: 3,
            padding: "10px 18px",
            fontSize: 13,
            fontFamily: themeA.sans,
            fontWeight: 500,
            cursor: "pointer",
            letterSpacing: ".01em",
          }}
        >
          Try again
        </button>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 18px",
            border: `1px solid ${themeA.border}`,
            borderRadius: 3,
            color: themeA.text,
            textDecoration: "none",
            fontSize: 13,
            fontFamily: themeA.sans,
          }}
        >
          Back to home
        </Link>
      </div>

      {/*
        Error reference shown only when Next.js generated a digest hash
        for this render. Useful when someone emails feedback so we can
        cross-reference server logs. No PII, just an opaque short id.
      */}
      {error.digest && (
        <p
          style={{
            marginTop: 32,
            fontSize: 11,
            color: themeA.subtle,
            fontFamily: themeA.mono,
            letterSpacing: ".05em",
          }}
        >
          {`reference: ${error.digest}`}
        </p>
      )}

      <p
        style={{
          marginTop: 28,
          fontSize: 12,
          color: themeA.muted,
          lineHeight: 1.6,
        }}
      >
        If this keeps happening, send the reference id and what you were
        doing to{" "}
        <a
          href="mailto:info@silknodes.io?subject=pev%20error%20report"
          className="pev-link"
        >
          info@silknodes.io
        </a>
        .
      </p>
    </main>
  );
}
