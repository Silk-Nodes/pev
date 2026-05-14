import { PEVMark } from "@/components/parallel/PEVBrand";
import { themeA } from "@/components/parallel/theme";
import VisitorCount from "./VisitorCount";
import Link from "next/link";

/**
 * SiteFooter, shared footer used on every route.
 *
 * Identical on all pages by design. Headers vary because the masthead
 * carries page-specific search; footers don't have that pressure, and
 * keeping them consistent is what makes every internal page feel like
 * the same product instead of four different products that share a logo.
 *
 * Contents:
 *   • Left: small PEVMark + edition stamp (brand book voice)
 *   • Right: optional <VisitorCount /> + "Built by Silk Nodes" attribution
 *
 * <VisitorCount /> is currently hidden (renders null) until we flip the
 * NEXT_PUBLIC_SHOW_VISITOR_COUNT env var on. The component still POSTs
 * to /api/v1/visit on mount so the counter fills with real history in
 * the background. See VisitorCount.tsx for the details.
 */

export default function SiteFooter() {
  return (
    <footer
      style={{
        marginTop: 28,
        paddingTop: 22,
        borderTop: `1px solid ${themeA.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 18,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PEVMark size={18} />
        <span
          className="pev-mono"
          style={{
            fontSize: 10,
            color: themeA.muted,
            letterSpacing: ".15em",
          }}
        >
          PEV · EDITION 01 · SPRING 2026
        </span>
      </div>
      {/* Right group: feedback channel + optional visitor count +
          attribution. The feedback link is the only outbound action in
          the footer , kept editorial-quiet so it reads as a service
          line, not a CTA. */}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <Link
          href="/feedback"
          className="pev-mono"
          style={{
            fontSize: 10,
            color: themeA.muted,
            letterSpacing: ".05em",
            textDecoration: "none",
          }}
        >
          Feedback
        </Link>
        <span style={{ color: themeA.subtle, fontSize: 10 }}>·</span>
        <Link
          href="/privacy"
          className="pev-mono"
          style={{
            fontSize: 10,
            color: themeA.muted,
            letterSpacing: ".05em",
            textDecoration: "none",
          }}
        >
          Privacy
        </Link>
        <span style={{ color: themeA.subtle, fontSize: 10 }}>·</span>
        <a
          href="https://github.com/Silk-Nodes/pev"
          target="_blank"
          rel="noreferrer"
          className="pev-mono"
          style={{
            fontSize: 10,
            color: themeA.muted,
            letterSpacing: ".05em",
            textDecoration: "none",
          }}
        >
          Source ↗
        </a>
        <span style={{ color: themeA.subtle, fontSize: 10 }}>·</span>
        <VisitorCount />
        <span
          className="pev-mono"
          style={{
            fontSize: 10,
            color: themeA.muted,
            letterSpacing: ".05em",
          }}
        >
          Built by Silk Nodes
        </span>
      </span>
    </footer>
  );
}
