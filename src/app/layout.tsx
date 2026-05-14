import type { Metadata } from "next";
import { Inter_Tight, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
    default: "pev — Parallel Execution Visualizer for Monad",
    template: "%s · pev",
  },
  description:
    "Is your contract killing parallelism? Paste a transaction or block. pev reconstructs the execution graph, surfaces storage contention, and tells you exactly which slots are costing you throughput.",
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
  icons: {
    icon: [{ url: "/pev-icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    title: "pev — Is your contract killing parallelism?",
    description:
      "A developer tool for Monad. See exactly which storage slots are contended, and why.",
    siteName: "pev",
    images: [
      {
        url: "/og-pev.png",
        width: 1200,
        height: 630,
        alt: "pev — Is your contract killing parallelism?",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "pev — Is your contract killing parallelism?",
    description: "A parallel-execution visualizer for Monad. By Silk Nodes.",
    images: ["/og-pev.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
