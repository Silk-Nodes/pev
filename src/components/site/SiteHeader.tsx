import type { ReactNode } from "react";
import LiveStatus from "@/components/parallel/LiveStatus";
import { PEVLockup } from "@/components/parallel/PEVBrand";
import { themeA } from "@/components/parallel/theme";
import SearchBox from "./SearchBox";
import Link from "next/link";

/**
 * SiteHeader, shared masthead used on every route.
 *
 * Two variants:
 *   • "home"    , lockup + tagline + LiveStatus + Silk Nodes link.
 *                  No search box (the home hero owns its own larger one).
 *   • "internal", adds a global search input that submits to /go, the
 *                  smart-routing endpoint that auto-detects block #,
 *                  contract address, or tx hash.
 *
 * Below the masthead, an optional breadcrumb row gives deep-linked
 * visitors (Twitter shares, Google long-tail) a second "back to home"
 * affordance, the wordmark click alone is too easy to miss.
 *
 * The component is a Server Component. The only client-side concern
 * is LiveStatus, which is itself a client component; React happily
 * lets us compose it from here without flipping this file to client.
 */

interface Props {
  variant?: "home" | "internal";
  /** Eyebrow caption rendered next to the lockup. Each page sets its own. */
  tagline?: string;
  /** Optional breadcrumb row (composed JSX from the page). */
  breadcrumb?: ReactNode;
}

export default function SiteHeader({
  variant = "internal",
  tagline,
  breadcrumb,
}: Props) {
  const showSearch = variant === "internal";

  return (
    <>
      <header
        role="banner"
        style={{
          display: "flex",
          alignItems: "center",
          // 28px gap (was 18) gives the search form's orange submit
          // button visible breathing room from the right-cluster nav,
          // which on long-tagline pages (contract page especially) was
          // butting the button up against the "analytics" link.
          gap: 28,
          flexWrap: "wrap",
          paddingBottom: 18,
          borderBottom: `1px solid ${themeA.border}`,
          marginBottom: breadcrumb ? 14 : 28,
        }}
      >
        {/* Lockup + tagline, the brand half of the masthead. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          <Link href="/" style={{ textDecoration: "none" }} aria-label="pev, home">
            <PEVLockup markSize={26} wordSize={26} />
          </Link>
          {tagline && (
            <span
              className="pev-eyebrow"
              style={{
                letterSpacing: ".18em",
                color: themeA.subtle,
              }}
            >
              {tagline}
            </span>
          )}
        </div>

        {/* Spacer that doubles as the search slot. When search is hidden
            (home variant) we still want flex space here so LiveStatus +
            Silk Nodes float to the right edge.

            flex-basis: 260px makes this slot demand at least 260px of
            ideal space, which in practice means when the lockup+tagline
            and right-cluster together would squeeze the spacer below
            that, the whole search wraps to a new row instead of
            cramming up against the nav links. */}
        <div style={{ flex: "1 1 260px", display: "flex", justifyContent: "center", minWidth: 0 }}>
          {showSearch && <SearchBox variant="header" />}
        </div>

        {/* Right cluster, nav + liveness signal + Silk Nodes attribution.
            The analytics link is the only top-level nav slot (we keep
            navigation minimal on purpose). LiveStatus stays prominent so
            real-time visitors trust the data. Silk Nodes is the soft
            conversion for non-dev visitors. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <Link
            href="/analytics"
            className="pev-link"
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.subtle,
              textDecoration: "none",
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
            }}
          >
            analytics
          </Link>
          <Link
            href="/docs"
            className="pev-link"
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.subtle,
              textDecoration: "none",
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
            }}
          >
            docs
          </Link>
          <Link
            href="/feedback"
            className="pev-link"
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.subtle,
              textDecoration: "none",
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
            }}
          >
            feedback
          </Link>
          <LiveStatus />
          <a
            href="https://silknodes.io"
            target="_blank"
            rel="noreferrer"
            className="pev-link"
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.subtle,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            by Silk Nodes →
          </a>
        </div>
      </header>

      {breadcrumb && (
        <nav
          aria-label="Breadcrumb"
          style={{
            fontFamily: themeA.mono,
            fontSize: 11,
            color: themeA.subtle,
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {breadcrumb}
        </nav>
      )}
    </>
  );
}

/**
 * Crumb, small inline helper for breadcrumb segments. Pages compose
 * their own breadcrumb JSX using these so each page controls labels
 * and links explicitly.
 *
 *   <SiteHeader breadcrumb={
 *     <>
 *       <Crumb href="/">pev</Crumb>
 *       <CrumbSep />
 *       <Crumb href="/">block</Crumb>
 *       <CrumbSep />
 *       <Crumb current>#70,443,192</Crumb>
 *     </>
 *   } />
 */
export function Crumb({
  href,
  current,
  title,
  children,
}: {
  href?: string;
  current?: boolean;
  title?: string;
  children: ReactNode;
}) {
  if (current || !href) {
    return (
      <span title={title} style={{ color: themeA.text }}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      title={title}
      className="pev-link"
      style={{ color: themeA.subtle, textDecoration: "none" }}
    >
      {children}
    </a>
  );
}

export function CrumbSep() {
  return <span style={{ color: themeA.subtle, opacity: 0.6 }}>/</span>;
}
