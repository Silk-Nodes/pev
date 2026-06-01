/**
 * /privacy, the privacy policy for pev.
 *
 * Editorial format matching /docs. We load Google Analytics 4 for
 * every visitor (no consent banner) with anonymize_ip enabled. This
 * page is the "what does that mean?" explanation.
 *
 * Honest framing: we collect anonymous aggregate pageview data via
 * GA4 (URLs, country, browser, referrer). No emails, no accounts, no
 * PII, no wallet addresses, no IP addresses. If you'd rather not
 * share even that, use an ad blocker or browser DNT, both work.
 * On-chain data is public chain data, not personal data.
 *
 * Keep this page minimal and accurate. If we ever change tracking
 * behavior (add Sentry, add a newsletter, add user accounts), update
 * this page and bump the "last updated" date.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: {
    absolute: "Privacy policy: what pev collects and how it's stored",
  },
  description:
    "pev collects almost nothing. No accounts, no emails, no IP addresses, no wallet data. Google Analytics 4 tracks anonymous aggregate pageviews. That's it.",
  alternates: {
    canonical: "/privacy",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Privacy at pev",
    description:
      "pev collects almost nothing. Plain-English summary of what's tracked, what isn't, and how to opt out.",
    type: "article",
    url: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        padding: "32px clamp(20px, 4vw, 64px) 80px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbSchema([
              { name: "pev", url: "/" },
              { name: "privacy", url: "/privacy" },
            ]),
          ),
        }}
      />
      <SiteHeader
        variant="internal"
        tagline="What pev collects, what it doesn't"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>privacy</Crumb>
          </>
        }
      />

      <section style={{ marginBottom: 48 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 16 }}>
          Privacy
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(32px, 5vw, 52px)",
            color: themeA.text,
            margin: "0 0 18px",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          Privacy at pev.
        </h1>
        <p
          style={{
            fontSize: 17,
            color: themeA.muted,
            lineHeight: 1.7,
            maxWidth: "62ch",
            margin: 0,
          }}
        >
          Short version: pev collects almost nothing. No accounts, no emails,
          no wallet addresses. We load Google Analytics 4 for every visitor
          with anonymize_ip enabled, which gives us aggregate pageview counts
          and not much else. If you&apos;d rather not share even that, an ad
          blocker or browser DNT stops the script from loading. The rest of
          this page is the long version.
        </p>
      </section>

      <Section title="What Google Analytics records">
        Google Analytics 4 loads on every page and records:
        <ul style={listStyle}>
          <li>The URL of each page you visit on pev.silknodes.io</li>
          <li>How long you stay on each page</li>
          <li>Your browser type and operating system</li>
          <li>Your country, sometimes city-level (your IP is anonymized before storage)</li>
          <li>Whether you arrived via a link, a search, or directly</li>
        </ul>
        That&apos;s it. We don&apos;t link any of this to a real person; Google
        Analytics shows us aggregate dashboards, not individual sessions.
      </Section>

      <Section title="How to opt out">
        Any of these stop GA from loading on pev:
        <ul style={listStyle}>
          <li>An ad blocker (uBlock Origin, Brave Shields, etc.)</li>
          <li>Your browser&apos;s Do Not Track setting</li>
          <li>The official Google Analytics Opt-out add-on</li>
        </ul>
        We don&apos;t check whether you&apos;ve blocked us. You don&apos;t need
        to ask permission. The site works identically with or without GA.
      </Section>

      <Section title="What pev does NOT collect">
        <ul style={listStyle}>
          <li>Email addresses (you have no way to give us one)</li>
          <li>
            Names, phone numbers, locations, or any personally identifying
            information
          </li>
          <li>
            Wallet addresses you paste into the search bar (those queries run
            server-side without being logged)
          </li>
          <li>Anything from the keyboard while you type into the search bar</li>
          <li>Browser fingerprints or device identifiers</li>
          <li>Behavior on other websites</li>
        </ul>
      </Section>

      <Section title="On-chain data">
        pev displays public Monad mainnet data: contract addresses, transaction
        hashes, block numbers, storage slots. These are public chain
        identifiers, visible to anyone running a Monad node. We index them and
        surface them in readable views; we don&apos;t link them to people, and
        you should assume anyone who can read a chain explorer can see the
        same data.
      </Section>

      <Section title="Third parties">
        When you click an external link in pev (Sourcify for contract
        verification, the 4byte directory for method names, Silk Nodes&apos;
        main site), those services have their own privacy policies and we
        don&apos;t control what they collect. We don&apos;t share data with
        any of them. They only see the request when you click the link.
      </Section>

      <Section title="API access">
        pev exposes read-only JSON endpoints under{" "}
        <span className="pev-mono" style={{ color: themeA.text }}>
          /api/v1/
        </span>{" "}
        for developers. These have no authentication and we don&apos;t log
        identifying info about who calls them, only the standard request
        headers needed to serve the response. If we ever add rate limiting
        we&apos;ll need to log IPs short-term to do it; that change will be
        announced here.
      </Section>

      <Section title="If you want pev to forget you">
        We have nothing to forget. pev itself has no record of you (no
        cookies, no localStorage, no server-side log of who you are).
        Google Analytics keeps aggregate session data on its end; we&apos;ve
        configured the property to delete it after 14 months. If you want
        even the aggregate counts gone, use an ad blocker so GA never loads
        in the first place.
      </Section>

      <Section title="Changes to this policy">
        If we change what pev collects, we&apos;ll update this page and bump
        the date below. There&apos;s no mailing list to subscribe to.
        Re-read whenever.
      </Section>

      <section
        style={{
          marginTop: 40,
          padding: "16px 18px",
          background: palette.surface03,
          border: `1px dashed ${themeA.border}`,
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
          Questions
        </span>
        Email{" "}
        <a
          href="mailto:info@silknodes.io?subject=pev%20privacy"
          className="pev-link"
        >
          info@silknodes.io
        </a>
        . We read everything.
      </section>

      <p
        style={{
          marginTop: 32,
          fontSize: 11,
          color: themeA.subtle,
          fontFamily: themeA.mono,
          letterSpacing: ".05em",
        }}
      >
        last updated: 2026-06-01
      </p>

      <p style={{ marginTop: 16 }}>
        <Link href="/" className="pev-link">
          ← back to pev
        </Link>
      </p>

      <SiteFooter />
    </main>
  );
}

const listStyle: React.CSSProperties = {
  margin: "12px 0 0",
  paddingLeft: 20,
  fontSize: 15,
  color: themeA.muted,
  lineHeight: 1.7,
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32, maxWidth: "70ch" }}>
      <h2
        style={{
          fontFamily: themeA.sans,
          fontSize: 15,
          color: themeA.text,
          margin: "0 0 8px",
          fontWeight: 500,
          letterSpacing: ".01em",
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: 15, color: themeA.muted, lineHeight: 1.7 }}>
        {children}
      </div>
    </section>
  );
}
