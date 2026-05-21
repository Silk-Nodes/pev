import type { Metadata, Viewport } from "next";
import { Inter_Tight, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Analytics from "@/components/site/Analytics";
import ConsentBanner from "@/components/site/ConsentBanner";
import { rootGraph } from "@/lib/seo/schema";

/**
 * Viewport export (Next.js 15+ pattern). Sets the mobile browser chrome
 * color to pev's primary ink so the browser toolbar matches the page
 * background instead of defaulting to white. Also pins the default
 * width so the editorial layout doesn't auto-zoom on first paint.
 *
 * Brand token used: --pev-ink (#0e0d0b), the same base background that
 * every page renders on. Same color in both light and dark UA preferences
 * because pev is dark-only.
 */
export const viewport: Viewport = {
  themeColor: "#0e0d0b",
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout for pev. Loads the three brand voices (per Brand Book Ch. 05):
 *   - Inter Tight     → interface
 *   - Instrument Serif → display + editorial pull (italic accents)
 *   - JetBrains Mono  → data (hashes, slots, gas, captions)
 */

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-pev-sans",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-pev-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-pev-mono",
  display: "swap",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pev.silknodes.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "pev: Parallel Execution Visualizer for Monad",
    template: "%s · pev",
  },
  description:
    "Is your contract killing parallelism? pev surfaces storage conflicts, hot slots, and per-contract parallelism scores from live Monad mainnet traces.",
  applicationName: "pev",
  authors: [{ name: "Silk Nodes", url: "https://silknodes.io" }],
  creator: "Silk Nodes",
  publisher: "Silk Nodes",
  keywords: [
    "monad",
    "parallel execution",
    "evm",
    "smart contract",
    "developer tools",
    "storage contention",
    "tx visualization",
    "silk nodes",
  ],
  // Canonical points at the public URL. Per-page generateMetadata
  // (block, contract, tx) can override this for sub-pages. Indexers
  // see one canonical address per page rather than treating www / non-
  // www / preview-tunnel variants as duplicates.
  alternates: {
    canonical: SITE_URL,
  },
  // Explicit robots directive. Default Next.js leaves this off, which
  // is fine for indexable apps but ambiguous to bots; saying it out loud
  // removes any chance of accidental noindex from a misconfigured proxy
  // or CDN header. We allow indexing + link following, with image-
  // preview at large size for the dynamic OG cards we render.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/pev-icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    title: "pev: Is your contract killing parallelism?",
    description:
      "A developer tool for Monad. See exactly which storage slots are contended, and why.",
    siteName: "pev",
    // Dynamic landing card. ?v=N is a cache-bust knob for Twitter/Discord
    // (their preview caches are otherwise unbreakable). Bump when the
    // card design changes OR when a social platform has cached an
    // earlier broken state of the image that won't refresh on its own.
    // History:
    //   v=1, first dynamic landing card
    //   v=4, post-design refresh
    //   v=5, X's image fetcher stuck on a stale/empty cache for v=4 at
    //        launch time, this bump gives X a URL it's never seen
    //        before so it has to re-scrape from scratch
    images: [
      {
        url: "/api/og/landing?v=5",
        width: 1200,
        height: 630,
        alt: "pev: Is your contract killing parallelism?",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "pev: Is your contract killing parallelism?",
    description: "A parallel-execution visualizer for Monad. By Silk Nodes.",
    // Match og:image cache-bust. X reads twitter:image when present and
    // falls back to og:image; keeping them aligned avoids any ambiguity
    // about which URL X will hit.
    images: ["/api/og/landing?v=5"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* Site-wide structured data: Organization (Silk Nodes),
            WebSite (pev), SoftwareApplication (pev). Lives at the
            top of body so crawlers see it immediately. Per-page
            entities (Breadcrumb, WebPage) are emitted by individual
            page components. See src/lib/seo/schema.ts. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(rootGraph()) }}
        />
        {children}
        {/* Privacy-first: <Analytics /> is a no-op until <ConsentBanner />
            stores the user's accept decision in localStorage. So the gtag
            script never loads on a fresh visit, and never loads at all
            for users who decline. See components/site/Analytics.tsx for
            why we chose conditional load over Google Consent Mode v2. */}
        <ConsentBanner />
        <Analytics />
      </body>
    </html>
  );
}
