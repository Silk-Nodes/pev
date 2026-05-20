import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTxDetail } from "@/lib/indexer/store";
import { resolveManyContracts, resolveMethod, labelFor } from "@/lib/enrichment";
import { themeA } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import SearchBox from "@/components/site/SearchBox";
import { shortHex } from "@/lib/probe-to-pev";
import type { ConflictKind } from "@/lib/parallel-probe";
import Link from "next/link";
import { headers } from "next/headers";
import { breadcrumbSchema } from "@/lib/seo/schema";

/**
 * Social-preview crawlers short-circuited so previews don't time out
 * while we wait on the tx + conflict-graph queries. Same pattern as
 * /contract and /block. Search bots (Googlebot etc.) get the full
 * render so the page stays indexable.
 */
const SOCIAL_CRAWLER_REGEX =
  /Twitterbot|TelegramBot|facebookexternalhit|Facebot|Slackbot|Discordbot|LinkedInBot|WhatsApp|Pinterestbot|redditbot|Skype|vkShare|W3C_Validator/i;

interface PageParams {
  params: Promise<{ hash: string }>;
}

const KIND_LABEL: Record<ConflictKind, string> = {
  "write-write": "write/write",
  "read-write": "read/write",
  mixed: "mixed",
};

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { hash } = await params;
  return {
    title: `Tx ${hash.slice(0, 10)}…${hash.slice(-6)}`,
    description: `Per-transaction parallel-execution analysis for tx ${hash}.`,
  };
}

export const revalidate = 3600;

export default async function TxPage({ params }: PageParams) {
  const { hash } = await params;
  const lower = hash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(lower)) notFound();

  // Crawler short-circuit. Social bots only need <head> for preview.
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (SOCIAL_CRAWLER_REGEX.test(userAgent)) {
    return (
      <main
        style={{
          padding: "48px clamp(20px, 4vw, 64px)",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h1
          className="pev-display-italic"
          style={{ fontSize: 32, color: themeA.text, margin: 0 }}
        >
          {`Transaction ${lower.slice(0, 10)}…${lower.slice(-6)}`}
        </h1>
        <p style={{ color: themeA.muted, marginTop: 16 }}>
          Per-transaction parallel-execution analysis. Open this page in a
          browser to see the conflict graph and storage touches.
        </p>
      </main>
    );
  }

  const tx = await getTxDetail(lower);

  if (!tx) {
    // Before showing a generic "not in index" page, distinguish the
    // two reasons a tx can be missing:
    //   • The hash isn't a real Monad transaction at all (typo, copy
    //     from a different chain, etc.)
    //   • The hash IS on Monad but in a block outside our indexed
    //     window (older than backfill start, or newer than the
    //     indexer has reached)
    // The error message we show should match reality so users don't
    // wait around for a tx that doesn't exist, or assume pev is broken
    // when actually they pasted the wrong hash.
    const chainStatus = await checkTxOnChain(lower);
    return <NotIndexed hash={lower} chainStatus={chainStatus} />;
  }

  // Bulk-resolve all contract labels in one cache hit (and any missing
  // ones in parallel via Sourcify). Pages render with names where known,
  // hex fallback otherwise. Negative-cached for 1h so repeat views don't
  // re-hammer Sourcify for unverified contracts. Method also resolved
  // in parallel via 4byte directory.
  const [contractLabels, methodSig] = await Promise.all([
    resolveManyContracts(tx.contracts),
    tx.selector ? resolveMethod(tx.selector) : Promise.resolve(null),
  ]);

  // Bucket conflicts by relation for the two-section layout
  const blockedBy = tx.conflicts.filter((c) => c.relation === "blocked-by");
  const blocking = tx.conflicts.filter((c) => c.relation === "blocks");

  const statusBadge =
    tx.status === "source"
      ? { label: `Blocks ${tx.outboundConflicts} later tx${tx.outboundConflicts === 1 ? "" : "s"}`, color: themeA.status.sourceText }
      : tx.status === "delayed"
        ? { label: `Delayed · waits on wave ${tx.wave}`, color: themeA.status.delayed }
        : { label: "Parallel · executed independently", color: themeA.status.clean };

  const ts = new Date(tx.blockTimestamp);
  const tsLabel = ts.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 80px", maxWidth: 1280, margin: "0 auto" }}>
      {/* BreadcrumbList JSON-LD for "pev > tx > 0x…" search-result trail. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbSchema([
              { name: "pev", url: "/" },
              { name: "tx", url: "/" },
              { name: shortHex(tx.hash, 6, 4), url: `/tx/${tx.hash}` },
            ]),
          ),
        }}
      />
      <SiteHeader
        variant="internal"
        tagline="This tx in the parallel graph"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/">tx</Crumb>
            <CrumbSep />
            <Crumb current title={tx.hash}>{shortHex(tx.hash, 6, 4)}</Crumb>
          </>
        }
      />

      {/* Status row */}
      <section style={{ marginBottom: 28 }}>
        <div
          className="pev-eyebrow"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <span>Transaction</span>
          {methodSig && (
            <span
              style={{
                color: themeA.subtle,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              · 4byte
            </span>
          )}
        </div>
        <div
          className="pev-display-italic"
          style={{
            fontSize: "clamp(28px, 4vw, 44px)",
            color: themeA.text,
            margin: "8px 0 0",
            wordBreak: "break-all",
          }}
        >
          {methodSig ? methodSig.split("(")[0] + "()" : shortHex(tx.hash, 12, 8)}
        </div>
        {methodSig && (
          <div
            className="pev-mono"
            style={{
              fontSize: 12,
              color: themeA.muted,
              marginTop: 6,
              wordBreak: "break-all",
            }}
          >
            {methodSig}
          </div>
        )}
        <div
          className="pev-mono"
          style={{
            fontSize: 11,
            color: themeA.muted,
            marginTop: 8,
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span>
            <span style={{ color: themeA.subtle }}>block</span>{" "}
            <Link href={`/block/${tx.blockNumber}`} className="pev-link">
              #{tx.blockNumber.toLocaleString()}
            </Link>
          </span>
          <span>
            <span style={{ color: themeA.subtle }}>position</span>{" "}
            <span style={{ color: themeA.text }}>{tx.position}</span>
          </span>
          <span>
            <span style={{ color: themeA.subtle }}>wave</span>{" "}
            <span style={{ color: themeA.text }}>{tx.wave}</span>
          </span>
          <span>
            <span style={{ color: themeA.subtle }}>r/w</span>{" "}
            <span style={{ color: themeA.text }}>
              {tx.readCount}/{tx.writeCount}
            </span>
          </span>
          <span>
            <span style={{ color: themeA.subtle }}>at</span>{" "}
            <span style={{ color: themeA.text }}>{tsLabel}</span>
          </span>
        </div>
        <div
          className="pev-mono"
          style={{
            fontSize: 11,
            color: statusBadge.color,
            marginTop: 14,
          }}
        >
          ● {statusBadge.label}
        </div>
      </section>

      {/* Full hash for copying */}
      <section
        style={{
          padding: "14px 18px",
          background: themeA.panel,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          fontFamily: themeA.mono,
          fontSize: 12,
          color: themeA.text,
          marginBottom: 28,
          wordBreak: "break-all",
        }}
      >
        <div className="pev-eyebrow" style={{ marginBottom: 6 }}>
          Full hash
        </div>
        {tx.hash}
      </section>

      {/* Contracts touched (with Sourcify decoding when verified) */}
      {tx.contracts.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div className="pev-eyebrow" style={{ marginBottom: 10 }}>
            Contracts touched ({tx.contracts.length})
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: `1px solid ${themeA.border}`,
              borderRadius: themeA.radius,
              overflow: "hidden",
            }}
          >
            {tx.contracts.map((c, i) => {
              const name = contractLabels.get(c.toLowerCase());
              return (
                <Link
                  key={c}
                  href={`/contract/${c}`}
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 14,
                    fontSize: 12,
                    color: themeA.text,
                    textDecoration: "none",
                    background: themeA.panel,
                    borderBottom:
                      i < tx.contracts.length - 1 ? `1px solid ${themeA.border}` : "none",
                  }}
                >
                  <span
                    style={{
                      fontFamily: name ? themeA.serif : themeA.mono,
                      fontStyle: name ? "italic" : "normal",
                      fontSize: name ? 14 : 12,
                      color: themeA.text,
                    }}
                  >
                    {labelFor(name, c, 8, 6)}
                  </span>
                  <span
                    className="pev-mono"
                    style={{
                      fontSize: 10,
                      color: themeA.subtle,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name && (
                      <span
                        style={{
                          color: themeA.status.clean,
                          marginRight: 8,
                        }}
                        title="verified by Sourcify"
                      >
                        ✓
                      </span>
                    )}
                    {shortHex(c, 6, 4)}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Forced to wait for */}
      {blockedBy.length > 0 && (
        <ConflictsSection
          title={`Waited for ${blockedBy.length} earlier tx${blockedBy.length === 1 ? "" : "s"}`}
          conflicts={blockedBy}
          arrow="←"
          peerKey="from"
        />
      )}

      {/* Blocked these later txs */}
      {blocking.length > 0 && (
        <ConflictsSection
          title={`Blocked ${blocking.length} later tx${blocking.length === 1 ? "" : "s"}`}
          conflicts={blocking}
          arrow="→"
          peerKey="to"
        />
      )}

      {tx.conflicts.length === 0 && (
        <section
          style={{
            padding: 22,
            border: `1px dashed ${themeA.border}`,
            borderRadius: themeA.radius,
            color: themeA.muted,
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 28,
          }}
        >
          This tx ran in parallel wave 0 with no detected storage conflicts -
          it neither waited for nor blocked any other tx in this block.
        </section>
      )}

      <SiteFooter />
    </main>
  );
}

function ConflictsSection({
  title,
  conflicts,
  arrow,
  peerKey,
}: {
  title: string;
  conflicts: Array<{
    fromHash: string;
    toHash: string;
    fromPosition: number;
    toPosition: number;
    kind: ConflictKind;
    sharedSlots: string[];
  }>;
  arrow: string;
  peerKey: "from" | "to";
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div className="pev-eyebrow" style={{ marginBottom: 10 }}>
        {title}
      </div>
      <div
        style={{
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          overflow: "hidden",
        }}
      >
        {conflicts.map((c, i) => {
          const peerHash = peerKey === "from" ? c.fromHash : c.toHash;
          const peerPos = peerKey === "from" ? c.fromPosition : c.toPosition;
          const slot0 = c.sharedSlots[0]?.split(":")[1];
          return (
            <div
              key={`${c.fromHash}-${c.toHash}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "12px 16px",
                fontFamily: themeA.mono,
                fontSize: 12,
                background: themeA.panel,
                borderBottom: i < conflicts.length - 1 ? `1px solid ${themeA.border}` : "none",
              }}
            >
              <span style={{ color: themeA.subtle }}>{arrow} #{peerPos}</span>
              <Link
                href={`/tx/${peerHash}`}
                style={{ color: themeA.text, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                {shortHex(peerHash, 8, 6)}
              </Link>
              <span style={{ color: themeA.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {slot0 ? shortHex(slot0, 8, 4) : ""}
                {c.sharedSlots.length > 1 && (
                  <span style={{ color: themeA.subtle, marginLeft: 8 }}>
                    +{c.sharedSlots.length - 1} more
                  </span>
                )}
              </span>
              <span style={{ color: themeA.subtle, fontSize: 10, whiteSpace: "nowrap" }}>
                {KIND_LABEL[c.kind]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * checkTxOnChain, asks the Monad RPC whether this hash is a real
 * transaction on the chain at all. Used by the NotIndexed branch to
 * distinguish "this hash isn't on Monad" (user typo / wrong chain)
 * from "this tx exists but isn't in pev's window yet" (indexing gap).
 *
 * Returns:
 *   • "not-on-chain"     , eth_getTransactionByHash returned null
 *   • { onChain: true, blockNumber } , tx exists in block N
 *   • "rpc-error"        , the RPC was unreachable or returned junk
 *
 * The RPC error case is treated separately: we don't want to lie to
 * the user by saying "tx not found on chain" if the truth is "we
 * couldn't ask the chain right now". On error we fall back to the
 * generic "not in index" message.
 */
type ChainStatus =
  | "not-on-chain"
  | "rpc-error"
  | { onChain: true; blockNumber: number };

async function checkTxOnChain(hash: string): Promise<ChainStatus> {
  const rpcUrl = process.env.MONAD_RPC_URL ?? "https://rpc.silknodes.io/monad";
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [hash],
      }),
      // Don't let this hang the page render if the RPC is slow.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return "rpc-error";
    const json = (await res.json()) as {
      result?: { blockNumber?: string } | null;
    };
    if (json.result === null || json.result === undefined) return "not-on-chain";
    if (typeof json.result.blockNumber === "string") {
      return {
        onChain: true,
        blockNumber: parseInt(json.result.blockNumber, 16),
      };
    }
    // Result exists but no blockNumber means pending tx, also "exists"
    return { onChain: true, blockNumber: 0 };
  } catch {
    return "rpc-error";
  }
}

function NotIndexed({
  hash,
  chainStatus,
}: {
  hash: string;
  chainStatus: ChainStatus;
}) {
  // Compose the editorial copy based on what we actually found.
  // Three honest framings, one per branch:
  let title: string;
  let body: React.ReactNode;
  if (chainStatus === "not-on-chain") {
    title = "Tx not found on Monad";
    body = (
      <>
        <p style={{ color: themeA.muted, lineHeight: 1.7, marginBottom: 12 }}>
          The hash{" "}
          <span className="pev-mono" style={{ color: themeA.text }}>
            {shortHex(hash, 10, 8)}
          </span>{" "}
          isn&apos;t a transaction on Monad mainnet. The RPC has no record
          of it.
        </p>
        <p style={{ color: themeA.muted, lineHeight: 1.7 }}>
          A few common causes: the hash is from a different EVM chain
          (Ethereum, Base, an L2), the hash is from Monad testnet, or
          there&apos;s a typo or truncation. Double-check the source
          you copied it from.
        </p>
      </>
    );
  } else if (
    typeof chainStatus === "object" &&
    chainStatus.onChain
  ) {
    const blockLabel =
      chainStatus.blockNumber > 0
        ? `block #${chainStatus.blockNumber.toLocaleString()}`
        : "a pending block";
    title = "Tx exists, but isn't indexed";
    body = (
      <>
        <p style={{ color: themeA.muted, lineHeight: 1.7, marginBottom: 12 }}>
          Monad has{" "}
          <span className="pev-mono" style={{ color: themeA.text }}>
            {shortHex(hash, 10, 8)}
          </span>{" "}
          in {blockLabel}, but pev hasn&apos;t analyzed that block yet.
        </p>
        <p style={{ color: themeA.muted, lineHeight: 1.7 }}>
          Most likely cause: the block is older than our indexing window
          (we started on April 25, 2026) or just newer than the indexer
          has reached this second. The latter usually resolves within
          seconds, the former needs a backfill we haven&apos;t run yet.
        </p>
      </>
    );
  } else {
    // "rpc-error" or anything unexpected. Honest framing: we don't
    // know whether the tx exists, so don't pretend either way.
    title = "Tx not in index";
    body = (
      <>
        <p style={{ color: themeA.muted, lineHeight: 1.7, marginBottom: 12 }}>
          We don&apos;t have{" "}
          <span className="pev-mono" style={{ color: themeA.text }}>
            {shortHex(hash, 10, 8)}
          </span>{" "}
          in our index. Either the block containing it isn&apos;t
          covered by pev (outside our April 25, 2026 backfill window),
          or the chain RPC wasn&apos;t reachable just now to confirm.
        </p>
      </>
    );
  }

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 80px", maxWidth: 720, margin: "0 auto" }}>
      <SiteHeader
        variant="internal"
        tagline="This tx in the parallel graph"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/">tx</Crumb>
            <CrumbSep />
            <Crumb current title={hash}>{shortHex(hash, 6, 4)}</Crumb>
          </>
        }
      />
      <h1
        className="pev-display-italic"
        style={{
          fontSize: 32,
          marginBottom: 16,
          color: themeA.text,
          marginTop: 24,
        }}
      >
        {title}
      </h1>
      {body}
      {/* Hand the user the next action directly. A search box on the
          not-found page is much friendlier than a "← back" link, the
          most common reason someone lands here is a fat-fingered hash
          and they want to retry, not navigate back to the home page. */}
      <div
        style={{
          marginTop: 32,
          paddingTop: 24,
          borderTop: `1px solid ${themeA.border}`,
        }}
      >
        <div
          className="pev-eyebrow"
          style={{ marginBottom: 12, color: themeA.muted }}
        >
          Try another search
        </div>
        <SearchBox variant="hero" />
      </div>
      <p style={{ marginTop: 28 }}>
        <Link href="/" className="pev-link">
          ← back to recent activity
        </Link>
      </p>
    </main>
  );
}

