/**
 * not-found.tsx, the branded 404 fallback.
 *
 * Next.js renders this whenever:
 *   • A route doesn't match (user typed /blah)
 *   • A page calls notFound() explicitly (e.g. invalid block number,
 *     malformed address, etc.)
 *
 * Replaces the generic Next.js default 404 page so the moment a user
 * hits a broken link still feels like pev. Same SiteHeader / SiteFooter,
 * editorial copy in the brand voice, with a small set of useful jumps
 * out (home, analytics, docs) instead of leaving them stranded.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { themeA } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

export const metadata: Metadata = {
  title: "Not found",
  description:
    "This page doesn't exist on pev. Try the homepage, analytics, or paste a block number, contract address, or transaction hash.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main
      style={{
        padding: "32px clamp(20px, 4vw, 64px) 80px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <SiteHeader
        variant="internal"
        tagline="That page doesn't exist"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>not found</Crumb>
          </>
        }
      />

      <section style={{ marginTop: 48, marginBottom: 32 }}>
        <div
          className="pev-eyebrow"
          style={{ color: themeA.muted, marginBottom: 12 }}
        >
          404
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(36px, 5vw, 56px)",
            color: themeA.text,
            lineHeight: 1.05,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          That page isn&apos;t here.
        </h1>
        <p
          style={{
            color: themeA.muted,
            lineHeight: 1.7,
            fontSize: 16,
            marginTop: 18,
            maxWidth: "60ch",
          }}
        >
          The URL might be mistyped, the contract or transaction may not be in
          pev&apos;s indexed history, or the page may simply not exist. None of
          those are your fault.
        </p>
      </section>

      <section style={{ marginBottom: 40 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
          Try one of these
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <NavCard
            href="/"
            title="Home"
            body="Recent blocks, live chain head, top conflict-causing contracts."
          />
          <NavCard
            href="/analytics"
            title="Analytics"
            body="Chain-wide stats, hot slots, methods, conflict-kind breakdown."
          />
          <NavCard
            href="/docs"
            title="Docs"
            body="What each metric means, API reference, data coverage."
          />
        </div>
      </section>

      <section
        style={{
          padding: "16px 18px",
          background: themeA.panel,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          fontSize: 13,
          color: themeA.muted,
          lineHeight: 1.6,
          maxWidth: "60ch",
        }}
      >
        <span
          className="pev-eyebrow"
          style={{ color: themeA.subtle, display: "block", marginBottom: 6 }}
        >
          Looking for a specific block or contract?
        </span>
        Paste a block number, a contract address, or a transaction hash into
        the search bar on the{" "}
        <Link href="/" className="pev-link">
          homepage
        </Link>
        . pev recognizes all three.
      </section>

      <SiteFooter />
    </main>
  );
}

function NavCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: 16,
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        textDecoration: "none",
        color: themeA.text,
      }}
    >
      <div
        className="pev-display-italic"
        style={{ fontSize: 18, marginBottom: 6 }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: themeA.muted, lineHeight: 1.5 }}>
        {body}
      </div>
    </Link>
  );
}
