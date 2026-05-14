import { notFound } from "next/navigation";
import { probeBlock } from "@/lib/parallel-probe";
import { probeToPEV } from "@/lib/probe-to-pev";
import EditorialView from "@/components/parallel/EditorialView";
import { themeA } from "@/components/parallel/theme";
import type { Metadata } from "next";

interface PageParams {
  params: Promise<{ number: string }>;
}

function parseBlockNumber(raw: string): number | null {
  if (!raw) return null;
  const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { number } = await params;
  const n = parseBlockNumber(number);
  if (n === null) return { title: "Block not found" };
  return {
    title: `Block #${n.toLocaleString()}`,
    description: `Parallel execution analysis for Monad block ${n}: wave depth, storage conflicts, hot slots.`,
    openGraph: {
      title: `Monad block #${n.toLocaleString()} — parallel execution`,
      description:
        "See which transactions ran in parallel, which conflicted, and where the storage hotspots are.",
    },
  };
}

// Finalized blocks are immutable → cache hard at the route level.
// Phase 3b will replace the live trace with a Postgres read.
export const revalidate = 3600;

export default async function BlockPage({ params }: PageParams) {
  const { number } = await params;
  const n = parseBlockNumber(number);
  if (n === null) notFound();

  let probe;
  try {
    probe = await probeBlock(n);
  } catch (e) {
    return (
      <div
        style={{
          padding: 48,
          fontFamily: "var(--pev-font-mono), ui-monospace, monospace",
          color: themeA.text,
          background: themeA.bg,
          minHeight: "100vh",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            marginBottom: 12,
            fontFamily: "var(--pev-font-serif), Georgia, serif",
            fontStyle: "italic",
            color: themeA.text,
          }}
        >
          Could not trace block #{n}
        </h1>
        <p style={{ color: themeA.muted }}>{(e as Error).message}</p>
        <p style={{ marginTop: 16 }}>
          <a href="/" className="pev-link">← back to recent blocks</a>
        </p>
      </div>
    );
  }

  const data = probeToPEV(probe);
  return <EditorialView data={data} />;
}
