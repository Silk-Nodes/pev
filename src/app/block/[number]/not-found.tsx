/**
 * Shown for /block/<n> when the block is older than the retention window
 * (see src/lib/indexer/retention.ts) or the number is not a block at all.
 * Served with a 404 status so search engines drop the URL.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { themeA } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

export const metadata: Metadata = {
  title: "Block not available",
  description:
    "pev keeps the last 7 days of Monad blocks. This block is older than that, or is not a block number.",
  robots: { index: false, follow: true },
};

export default function BlockNotFound() {
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
        tagline="Outside the 7-day window"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>block</Crumb>
          </>
        }
      />

      <section style={{ marginTop: 48, marginBottom: 32 }}>
        <div className="pev-eyebrow" style={{ color: themeA.muted, marginBottom: 12 }}>
          Last 7 days only
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
          This block isn&apos;t kept anymore.
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
          pev keeps the full parallel-execution analysis for the last 7 days
          of Monad blocks. Older blocks are removed as new ones arrive, and
          the address may also simply not be a block number.
        </p>
        <p style={{ marginTop: 22, fontSize: 16 }}>
          <Link href="/" className="pev-link" style={{ fontWeight: 500 }}>
            → see the latest blocks
          </Link>
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
