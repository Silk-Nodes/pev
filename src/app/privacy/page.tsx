/**
 * /privacy, the privacy policy for pev.
 *
 * Editorial format matching /docs. We have a ConsentBanner that asks
 * for permission before loading Google Analytics; this page is the
 * "what does that mean?" explanation users can click into from the
 * banner or footer if we ever link it from there.
 *
 * Honest framing: we collect almost nothing. Default state is no
 * tracking at all. Consent only flips on the GA pixel; consent-decline
 * means the gtag script never loads. No emails, no accounts, no PII.
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
    "pev collects almost nothing. No accounts, no emails, no tracking by default. If you accept the consent banner, Google Analytics tracks anonymous pageviews. That's it.",
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
          no tracking pixels by default. If you accept the consent banner,
          Google Analytics 4 tracks anonymous pageviews. If you decline, even
          that doesn&apos;t happen. The rest of this page is the long version.
        </p>
      </section>

      <Section title="What pev tracks by default">
        Nothing. No cookies, no analytics, no fingerprinting. The page loads,
        you read it, you leave. We don&apos;t see it on our end.
      </Section>

      <Section title="What changes if you accept the consent banner">
        Google Analytics 4 loads in your browser and records:
        <ul style={listStyle}>
          <li>The URL of each page you visit on pev.silknodes.io</li>
          <li>How long you stay on each page</li>
          <li>Your browser type and operating system</li>
          <li>Your country, sometimes city-level (never your IP address)</li>
          <li>Whether you arrived via a link, a search, or directly</li>
        </ul>
        That&apos;s it. We don&apos;t link any of this to a real person; Google
        Analytics shows us aggregate dashboards, not individual sessions.
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

      <Section title="Where your consent choice is stored">
        Locally, in your browser&apos;s{" "}
        <span className="pev-mono" style={{ color: themeA.text }}>
          localStorage
        </span>
        , under a key called{" "}
        <span className="pev-mono" style={{ color: themeA.text }}>
          pev-consent
        </span>
        . It never leaves your machine. We don&apos;t have a server-side
        record of your choice. Clearing your browser data resets it, and the
        banner will ask again next visit.
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
        Clear the{" "}
        <span className="pev-mono" style={{ color: themeA.text }}>
          pev-consent
        </span>{" "}
        key from your browser&apos;s localStorage. The banner will reappear
        on your next visit and you can decline. Google Analytics keeps its
        own retention rules; we&apos;ve configured the property to delete
        data after 14 months.
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
        last updated: 2026-05-13
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
