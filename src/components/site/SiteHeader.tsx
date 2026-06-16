"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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
 * Smart-sticky behavior:
 *   The header uses `position: sticky` with a scroll-direction effect.
 *   At the top of the page it sits in normal flow. Scrolling DOWN
 *   translates it -100% off-screen so the content area takes the full
 *   viewport (better for reading long pages like /docs and /analytics).
 *   Scrolling UP at all brings it straight back into view (search and
 *   nav are one upward flick away). This matches YouTube/Medium/Twitter
 *   mobile and gives the user navigation control without compromising
 *   pev's editorial brand: the chrome is present when wanted, invisible
 *   when not.
 *
 * Why "use client": the scroll-direction tracking requires useEffect +
 * window.scrollY, which are client-only. The component still SSRs (its
 * JSX renders to HTML for crawlers / first paint), it just hydrates on
 * the client to attach the scroll listener. LiveStatus inside was already
 * client-only, so this is a marginal change in the bundle topology.
 */

interface Props {
  variant?: "home" | "internal";
  /**
   * Eyebrow caption rendered next to the lockup. Each page sets its own.
   *
   * Keep this under ~35 characters. The lockup section is `flex-shrink: 0`,
   * so a long tagline directly steals horizontal space from the search
   * slot and pushes the orange submit button up against the right-cluster
   * nav. Compare:
   *   "How Monad parallelizes"           (22 chars, comfortable)
   *   "How this contract parallelizes"   (30 chars, comfortable)
   *   "How this contract behaves under parallel load"  (45 chars, cramped)
   */
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

  // hidden=true → translateY(-100%), off-screen above the viewport.
  // Toggled by scroll direction with a small threshold to avoid jitter.
  const [hidden, setHidden] = useState(false);
  // scrolled=true once the user has moved past the very top of the
  // page. Used to swap the header between "transparent, part of the
  // page" (at top) and "opaque with a separator" (when stuck), so the
  // header doesn't read as a separate box floating above the content
  // when at the top of the page.
  const [scrolled, setScrolled] = useState(false);
  const lastYRef = useRef(0);

  useEffect(() => {
    // requestAnimationFrame-coalesced scroll handler. Browsers fire
    // scroll events much faster than we need to react; this caps the
    // update rate at ~60fps and keeps the handler off the main thread's
    // critical path.
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastYRef.current;

        // 12px threshold for "scrolled" avoids the bg/border flickering
        // on micro-scrolls at the very top of the page (e.g. someone
        // bumping the trackpad). Once they're clearly past the top, we
        // commit to the opaque state.
        setScrolled(y > 12);

        // Always visible inside the first 100px of scroll. The header
        // is in its natural position there, no point hiding it. This
        // also handles the page-load case (y=0) so the header is
        // visible immediately on first paint.
        if (y < 100) {
          if (hidden) setHidden(false);
          lastYRef.current = y;
          ticking = false;
          return;
        }

        // 6px direction-change threshold filters out trackpad inertia
        // and sub-pixel scroll noise that would otherwise flicker the
        // header. Real intentional scrolls easily clear 6px.
        if (Math.abs(delta) < 6) {
          ticking = false;
          return;
        }

        setHidden(delta > 0); // scrolling down → hide; scrolling up → show
        lastYRef.current = y;
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hidden]);

  return (
    <>
      <header
        role="banner"
        className="pev-site-header"
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
          // 16px paddingTop balances the layout when the header is
          // stuck at the viewport top: without it, the brand mark sat
          // flush against the very edge of the screen, which read as
          // jarring. Sets a "comfortable height" for the sticky band.
          paddingTop: 16,
          // Border only when scrolled past the top. At the top of the
          // page the header is part of the layout (no separator); once
          // stuck it gets a quiet line so it reads as a defined band
          // over the scrolling content.
          borderBottom: scrolled ? `1px solid ${themeA.border}` : "1px solid transparent",
          marginBottom: breadcrumb ? 14 : 28,

          // Smart-sticky: pinned to the top, slides up when scrolling
          // down, slides back when scrolling up. The transform-based
          // hide doesn't take the element out of flow, so the breadcrumb
          // and page content below don't reshuffle on toggle.
          position: "sticky",
          top: 0,
          // Above page content (default z=0), below the consent banner
          // (z=1000) and any future modals.
          zIndex: 100,
          // Background only when scrolled. At the top of the page the
          // header has no background, so it reads as part of the page
          // rather than a floating box stuck above it. Once stuck, the
          // opaque bg prevents content scrolling underneath from
          // bleeding through. The transition smooths the swap.
          background: scrolled ? themeA.bg : "transparent",
          transform: hidden ? "translateY(-100%)" : "translateY(0)",
          // 240ms ease-out: fast enough not to feel laggy, slow enough
          // for the eye to register it as a deliberate motion.
          transition: "transform 240ms ease-out, background 180ms ease-out, border-color 180ms ease-out",
          // Tell the browser this element's transform will change so it
          // can promote to a compositor layer and animate on the GPU.
          willChange: "transform",
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
              className="pev-eyebrow pev-header-tagline"
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

            flex: 1 (flex-basis 0%) lets this slot take whatever space
            is left over without demanding a minimum. The orange button's
            visual breathing room from the right cluster is enforced by
            the header's gap (28px) and the form's maxWidth (360px in
            SearchBox), not by trying to reserve space here, which would
            force the right cluster to wrap to a new row on otherwise-
            fine viewports. */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
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
            href="/graph"
            className="pev-link"
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.accent,
              textDecoration: "none",
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
            }}
          >
            graph
          </Link>
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
            className="pev-link pev-header-silknodes"
            style={{
              fontFamily: themeA.mono,
              fontSize: 11,
              color: themeA.subtle,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            by Silk Nodes
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
