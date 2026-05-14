import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  getContractDetail,
  getContractLastSeen,
  DEFAULT_CONTRACT_WINDOW,
  type ContractDetail,
  type ContractMethod,
  type ContractWindowKey,
} from "@/lib/indexer/store";
import { PG_QUERY_CANCELED } from "@/lib/db";
import { breadcrumbSchema } from "@/lib/seo/schema";
import { resolveContract, resolveManyMethods } from "@/lib/enrichment";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { shortHex } from "@/lib/probe-to-pev";
import Link from "next/link";

/**
 * Social-preview crawlers we want to short-circuit the heavy render for.
 *
 * These bots fetch the page only to parse the <head>'s og: meta tags
 * and download the og:image URL. They have tight crawl timeouts
 * (Twitter ~15s, Telegram ~5s, Facebook ~10s, Discord ~5s) and don't
 * need the page body for their preview cards.
 *
 * We deliberately exclude Googlebot, Bingbot, and other search engines
 * because those want to index the real page content. Search bots
 * tolerate slow pages (re-crawl later) so they get the full render.
 */
const SOCIAL_CRAWLER_REGEX =
  /Twitterbot|TelegramBot|facebookexternalhit|Facebot|Slackbot|Discordbot|LinkedInBot|WhatsApp|Pinterestbot|redditbot|Skype|vkShare|W3C_Validator/i;

interface PageParams {
  params: Promise<{ address: string }>;
  // ?window= controls the time horizon for the per-contract aggregates.
  // Validated against VALID_WINDOWS; falls back to DEFAULT_CONTRACT_WINDOW.
  searchParams: Promise<{ window?: string }>;
}

const VALID_WINDOWS: ContractWindowKey[] = ["1h", "24h", "7d", "30d", "all"];

const WINDOW_LABEL: Record<ContractWindowKey, string> = {
  "1h": "1h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "All time",
};

function parseWindow(s: string | undefined): ContractWindowKey {
  if (s && (VALID_WINDOWS as readonly string[]).includes(s)) {
    return s as ContractWindowKey;
  }
  return DEFAULT_CONTRACT_WINDOW;
}

/**
 * Build a clean URL for a window selection. We omit the query string for
 * the default window so the canonical address URL stays clean (and the
 * default page caches well at the edge).
 */
function urlForWindow(addr: string, w: ContractWindowKey): string {
  if (w === DEFAULT_CONTRACT_WINDOW) return `/contract/${addr}`;
  return `/contract/${addr}?window=${w}`;
}

/**
 * Ordered narrowest → widest. Used for the auto-fallback ladder when a
 * requested window times out: we step back one rung at a time. Stopping
 * at "1h" because anything below that should never time out, and if it
 * does, something else is wrong.
 */
const WINDOW_LADDER: ContractWindowKey[] = ["1h", "24h", "7d", "30d", "all"];

function narrowerWindow(w: ContractWindowKey): ContractWindowKey | null {
  const i = WINDOW_LADDER.indexOf(w);
  return i > 0 ? WINDOW_LADDER[i - 1] : null;
}

interface PgLikeError {
  code?: string;
}

function isQueryTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as PgLikeError).code === PG_QUERY_CANCELED
  );
}

/**
 * Run getContractDetail with an automatic fallback ladder. If the
 * requested window times out (Postgres cancels via statement_timeout),
 * step down to the next-narrower window and retry. Returns the
 * resolved detail plus the window we ended up serving and the window
 * the user originally asked for, so the page can show a notice when
 * they don't match.
 *
 * Why a ladder (1h ← 24h ← 7d ← 30d ← all) rather than always falling
 * back to the smallest: most popular contracts are still fine on `7d`
 * even when `all` chokes, and we'd rather show a week of data than an
 * hour.
 *
 * Budget math (Cloudflare edge ceiling = 30s):
 *   per-rung budgets: 7 + 6 + 5 + 3 + 2 = 23s worst case across all 5 rungs
 *   plus other in-flight work (resolveContract, getContractLastSeen,
 *   render, network) ≈ 4s
 *   total ≈ 27s, comfortably under the 30s ceiling.
 *
 * Earlier versions passed `remaining - 800ms` as the per-statement
 * timeout, which gave the first rung ~23s and starved the rest of the
 * ladder. The fixed per-rung budgets below ensure the ladder actually
 * runs end-to-end if needed.
 */
const FALLBACK_TOTAL_BUDGET_MS = 26_000;

// Per-rung budgets, tuned so even very heavy contracts (popular DEX
// routers, top tokens) get a chance at the narrow rungs after the wide
// ones time out. Total worst-case ladder = 4+5+6+6+6 = 27s, which fits
// inside the 26s budget cap (we'll bail one rung short rather than blow
// past Cloudflare's 30s edge ceiling).
//
// 30d and all share a budget because for our ~7-day-old index they
// touch the same data. If indexer history grows past 30 days we'll
// want to give `all` more room or pre-aggregate.
const PER_RUNG_TIMEOUT_MS: Record<ContractWindowKey, number> = {
  "1h": 4_000,
  "24h": 5_000,
  "7d": 6_000,
  "30d": 6_000,
  all: 6_000,
};

async function getContractDetailWithFallback(
  addr: string,
  requested: ContractWindowKey,
): Promise<{
  detail: ContractDetail | null;
  resolvedWindow: ContractWindowKey;
  fellBackFrom: ContractWindowKey | null;
}> {
  const start = Date.now();
  let current: ContractWindowKey | null = requested;
  while (current !== null) {
    const remaining = FALLBACK_TOTAL_BUDGET_MS - (Date.now() - start);
    // Cap this rung's timeout at the smaller of (a) the rung's ideal
    // budget and (b) what's left of the total. The 1500ms minimum is the
    // smallest window where we'd still expect a meaningful result; below
    // that the query barely has time to plan, so we bail to NotSeen.
    const ideal = PER_RUNG_TIMEOUT_MS[current];
    const stmtTimeout = Math.min(ideal, remaining - 500);
    if (stmtTimeout < 1_500) {
      return {
        detail: null,
        resolvedWindow: current,
        fellBackFrom: requested === current ? null : requested,
      };
    }
    try {
      const detail = await getContractDetail(addr, current, stmtTimeout);
      return {
        detail,
        resolvedWindow: current,
        fellBackFrom: current === requested ? null : requested,
      };
    } catch (err) {
      if (isQueryTimeout(err)) {
        const next = narrowerWindow(current);
        if (next === null) {
          // Bottomed out; surface as no-data so NotSeen renders cleanly.
          return {
            detail: null,
            resolvedWindow: current,
            fellBackFrom: requested === current ? null : requested,
          };
        }
        current = next;
        continue;
      }
      throw err;
    }
  }
  return { detail: null, resolvedWindow: requested, fellBackFrom: null };
}

/**
 * `getContractLastSeen` does a GIN bitmap scan + sort on a popular
 * contract, which can take several seconds. After the fallback above
 * has potentially burned 22s, an unbounded last-seen lookup could
 * push the response past Cloudflare's 30s ceiling and return 504. We
 * wrap it in a short statement_timeout and treat any timeout as "no
 * info available". Better to show a less-informative NotSeen than to
 * blow the budget.
 */
async function getLastSeenSafe(
  addr: string,
): Promise<{ block: number; at: Date } | null> {
  try {
    return await getContractLastSeen(addr);
  } catch (err) {
    if (isQueryTimeout(err)) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { address } = await params;
  const lower = address.toLowerCase();

  // Per-contract OG card. ?v=N is the design-version cache-bust.
  const ogImageUrl = `/api/og/contract/${lower}?v=5`;
  const shortLabel = `${lower.slice(0, 8)}…${lower.slice(-4)}`;
  const title = `Contract ${shortLabel} · pev`;
  const description = `Parallel-execution profile for contract ${lower}: avg parallelism, hot storage slots, conflicts caused.`;
  // Always use lowercase address in the canonical so Google doesn't
  // see /contract/0xABC… and /contract/0xabc… as separate pages.
  const canonicalPath = `/contract/${lower}`;

  return {
    title: `Contract ${shortLabel}`,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonicalPath,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `pev, contract ${shortLabel} parallelism profile`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export const revalidate = 60;

export default async function ContractPage({ params, searchParams }: PageParams) {
  const { address } = await params;
  const { window: windowParam } = await searchParams;
  const lower = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) notFound();

  // Social-preview crawler short-circuit. Bots like Twitterbot,
  // TelegramBot, and facebookexternalhit only fetch this page to read
  // the og: meta tags from <head> (set in generateMetadata, which has
  // already run before this component executes). They have tight crawl
  // timeouts (5-15s) and don't render the body. For popular contracts
  // the heavy data load below can take longer than that window and
  // make the crawler give up, breaking link previews everywhere.
  //
  // We render a minimal body for crawlers: the OG meta tags in <head>
  // are unchanged, the body is just placeholder text. Real users and
  // search engines (Googlebot, Bingbot) still get the full render.
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
          {`Contract ${shortHex(lower, 6, 4)}`}
        </h1>
        <p style={{ color: themeA.muted, marginTop: 16 }}>
          Parallel-execution profile on Monad mainnet. Open this page in a
          browser to see the live metrics.
        </p>
      </main>
    );
  }

  const windowKey = parseWindow(windowParam);

  const [{ detail: contract, resolvedWindow, fellBackFrom }, label] =
    await Promise.all([
      getContractDetailWithFallback(lower, windowKey),
      resolveContract(lower),
    ]);
  if (!contract) {
    // Two distinct empty states:
    //   • lastSeen === null  ⇒ never indexed (truly unknown address)
    //                          OR the cheap probe also timed out, in
    //                          which case we still render the "never
    //                          indexed" message rather than 504.
    //   • lastSeen !== null  ⇒ indexed at some point, but no rows fell
    //                          inside the requested window. The user
    //                          probably wants a wider window; the NotSeen
    //                          page surfaces a "try all-time" link.
    const lastSeen = await getLastSeenSafe(lower);
    return (
      <NotSeen addr={lower} lastSeen={lastSeen} windowKey={resolvedWindow} />
    );
  }

  // Resolve human-readable method signatures for the per-method breakdown.
  // Cache-first; only the rare unresolved selector hits 4byte. Empty-set
  // safe so contracts that only see plain ETH transfers skip this.
  const methodNames = await resolveManyMethods(
    contract.methods.map((m) => m.selector),
  );

  const scoreColor =
    contract.avgParallelismScore >= 70
      ? themeA.status.clean
      : contract.avgParallelismScore >= 40
        ? themeA.status.delayed
        // sourceText (lighter terracotta) for AA contrast when this
        // computed color is consumed as text downstream.
        : themeA.status.sourceText;

  const verdict = computeVerdict(contract, methodNames);

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 64px) 80px", maxWidth: 1280, margin: "0 auto" }}>
      {/* BreadcrumbList JSON-LD for "pev > contract > 0xabcd…1234".
          Helps Google render breadcrumb trails in search results
          when this URL is indexed. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbSchema([
              { name: "pev", url: "/" },
              { name: "contract", url: "/" },
              {
                name: label ?? shortHex(contract.address, 6, 4),
                url: `/contract/${contract.address}`,
              },
            ]),
          ),
        }}
      />
      <SiteHeader
        variant="internal"
        tagline="How this contract behaves under parallel load"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/">contract</Crumb>
            <CrumbSep />
            <Crumb current title={contract.address}>
              {shortHex(contract.address, 6, 4)}
            </Crumb>
          </>
        }
      />

      {/* Hero, show decoded label if Sourcify knew it, otherwise short hex */}
      <section style={{ marginBottom: 32 }}>
        <div
          className="pev-eyebrow"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <span>Contract</span>
          {label && (
            <span
              style={{
                color: themeA.subtle,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              · verified by Sourcify
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
          {label ?? shortHex(contract.address, 14, 10)}
        </div>
        <div
          className="pev-mono"
          style={{ fontSize: 11, color: themeA.muted, marginTop: 8, wordBreak: "break-all" }}
        >
          {contract.address}
        </div>
      </section>

      {/* Plain-English verdict, single sentence in the brand voice that
          tells you in one read whether this contract is healthy, bottlenecked,
          or a throughput-killer. Mirrors the per-block verdict on the
          landing page so the editorial style is consistent across the app. */}
      <VerdictBlock verdict={verdict} />

      {/* 4-stat strip, responsive: 4-up desktop → 2-up tablet → 1-up phone */}
      <section
        className="pev-grid-stats-4"
        style={{ gap: 16, marginBottom: 32 }}
      >
        <Stat
          label="Avg parallelism"
          value={`${contract.avgParallelismScore}/100`}
          color={scoreColor}
        />
        <Stat label="Blocks appeared in" value={contract.blocksAppeared.toLocaleString()} />
        <Stat label="Total transactions" value={contract.txsTouched.toLocaleString()} />
        <Stat
          label="Conflicts caused"
          value={contract.conflictsCaused.toLocaleString()}
          color={contract.conflictsCaused > 0 ? themeA.status.sourceText : themeA.text}
        />
      </section>

      {/* Window selector + disclosure band. The pills let the reader
          retarget the aggregates over different time horizons (1h, 24h,
          7d, 30d, all-time). The disclosure shows the actual block range
          backing the current numbers, so they're never confused with
          all-time history when they're not. */}
      <WindowDisclosure
        addr={contract.address}
        contract={contract}
        fellBackFrom={fellBackFrom}
      />

      {/* Methods causing conflicts. THE killer feature for devs: groups
          this contract's txs by 4-byte method selector and shows which
          method is responsible for what share of total contention.
          Answers the "where in my code do I look?" question directly.
          Filtered to methods that actually caused contention so the card
          stays focused on the question its title asks. */}
      {contract.methods.some((m) => m.conflictsCaused > 0) && (
        <section style={{ marginBottom: 32 }}>
          <Card
            eyebrow="Methods causing conflicts"
            title="Where the contention comes from"
          >
            <MethodList
              methods={contract.methods.filter((m) => m.conflictsCaused > 0)}
              methodNames={methodNames}
            />
          </Card>
        </section>
      )}

      {/* Worst recent block, the directional pull. Closes the page's
          dead-end by giving the user one obvious next click instead of
          a flat list to scan. We only render when the worst block is
          meaningfully contended (score < 70) and at least one tx
          conflicted, otherwise calling a 90/100 block "worst" would be
          misleading. */}
      <WorstBlockCallout recent={contract.recentBlocks} />

      {/* Two-column: hot slots + recent blocks. Stacks to 1 column on
          phone/small-tablet so each card has enough width to be readable. */}
      <section
        className="pev-grid-two-col"
        style={{ gap: 20, marginBottom: 32 }}
      >
        <Card eyebrow="Hot storage slots" title="Contention by slot">
          {contract.hotSlots.length === 0 ? (
            <div style={{ color: themeA.muted, fontSize: 12 }}>
              No hot slots, every storage location was touched by ≤1 tx per block.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {contract.hotSlots.map((s, i) => (
                <div
                  key={s.slot}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom:
                      i < contract.hotSlots.length - 1
                        ? `1px solid ${themeA.border}`
                        : "none",
                    fontFamily: themeA.mono,
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: themeA.text,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                    }}
                    title={s.slot}
                  >
                    <span>{decodeSlot(s.slot).display}</span>
                    <span
                      style={{
                        color: themeA.subtle,
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: ".05em",
                      }}
                    >
                      {decodeSlot(s.slot).hint}
                    </span>
                  </span>
                  <span style={{ textAlign: "right", color: themeA.muted, whiteSpace: "nowrap" }}>
                    <span style={{ color: themeA.text }}>{s.appearances}</span> blocks ·{" "}
                    <span style={{ color: themeA.text }}>{s.totalTouches}</span> touches ·{" "}
                    <span style={{ color: s.totalConflicts > 0 ? themeA.status.sourceText : themeA.subtle }}>
                      {s.totalConflicts} conf
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card eyebrow="Recent blocks" title="Where it appeared">
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {contract.recentBlocks.map((b, i) => {
              const c =
                b.parallelismScore >= 70
                  ? themeA.status.clean
                  : b.parallelismScore >= 40
                    ? themeA.status.delayed
                    // sourceText: consumed as a text color in the
                    // adjacent score number, not a fill.
                    : themeA.status.sourceText;
              return (
                <Link
                  key={b.number}
                  href={`/block/${b.number}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom:
                      i < contract.recentBlocks.length - 1
                        ? `1px solid ${themeA.border}`
                        : "none",
                    textDecoration: "none",
                    color: themeA.text,
                    fontFamily: themeA.mono,
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: c,
                    }}
                  />
                  <span>#{b.number.toLocaleString()}</span>
                  <span style={{ color: themeA.muted, whiteSpace: "nowrap" }}>
                    {b.txCount} tx
                  </span>
                  <span style={{ color: c, whiteSpace: "nowrap" }}>
                    {b.parallelismScore}/100
                  </span>
                </Link>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Honesty footer */}
      <section
        style={{
          padding: 18,
          border: `1px dashed ${themeA.border}`,
          borderRadius: themeA.radius,
          marginBottom: 32,
          background: palette.surface03,
          fontSize: 12,
          color: themeA.muted,
          lineHeight: 1.6,
        }}
      >
        <span className="pev-eyebrow">Caveat</span>
        <br />
        Stats are aggregated over the time window selected at the top of
        the page. The default is the last 7 days; switch to "All time" to
        cover every block pev has indexed, or narrow to 1h / 24h to see
        only recent behavior. The "avg parallelism" is the average score
        of every block this contract appeared in within that window (not
        a per-tx measurement). The contract name is shown when verified
        on Sourcify (rare on Monad mainnet right now); otherwise we show
        the short hex. To get yours labeled, verify it at{" "}
        <a href="https://sourcify.dev/" className="pev-link" target="_blank" rel="noreferrer">
          sourcify.dev
        </a>.
      </section>

      <SiteFooter />
    </main>
  );
}

/**
 * WorstBlockCallout, the directional pull on the contract page.
 *
 * Picks the worst-parallelism block from the recent list and surfaces
 * it as a single click target above the flat list. Without this, the
 * "Recent blocks" card was just a sorted-by-recency rolodex with no
 * guidance on where to look first.
 *
 * Threshold: only render when score < 70 AND there's at least one
 * conflict. A contract whose worst recent block scored 95/100 has no
 * meaningful "worst" to highlight, calling that out would mislead.
 */
/**
 * Window selector + range disclosure. Two visual rows:
 *
 *   1. Pill row, the active window is solid; the rest are outline links
 *      to the same path with a different `?window=` query string. We omit
 *      the param for the default window so the canonical URL stays clean.
 *
 *   2. Range disclosure, "stats over blocks #X to #Y (~N hours)". Computed
 *      from the actual windowFromBlock/windowToBlock the query covered, so
 *      it matches reality (rather than the nominal window the user picked).
 *      For all-time we show "all indexed history" and only link the high end.
 *
 * Both rows live in the same panel so they read as one unit: "you picked
 * 7d, here's what 7d means in concrete block numbers."
 */
function WindowDisclosure({
  addr,
  contract,
  fellBackFrom,
}: {
  addr: string;
  contract: ContractDetail;
  /** Set when we asked for a wider window but had to narrow. */
  fellBackFrom: ContractWindowKey | null;
}) {
  const isAllTime = contract.windowKey === "all";
  const blockSpan = contract.windowToBlock - contract.windowFromBlock;
  // ~0.5s/block on Monad mainnet, current cadence. Update if it shifts.
  const minutes = (blockSpan * 0.5) / 60;
  const durationLabel = isAllTime
    ? "all indexed history"
    : minutes < 60
      ? `~${Math.round(minutes)} minutes of mainnet`
      : minutes < 1440
        ? `~${Math.round(minutes / 60)} hours of mainnet`
        : `~${Math.round(minutes / 1440)} days of mainnet`;

  return (
    <section
      style={{
        padding: "12px 18px 14px",
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        marginBottom: 32,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: themeA.mono,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            color: themeA.subtle,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            fontSize: 10,
            marginRight: 4,
          }}
        >
          Window
        </span>
        {VALID_WINDOWS.map((w) => {
          const active = w === contract.windowKey;
          return (
            <Link
              key={w}
              href={urlForWindow(addr, w)}
              prefetch={false}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? themeA.text : themeA.border}`,
                background: active ? themeA.text : "transparent",
                color: active ? themeA.bg : themeA.muted,
                textDecoration: "none",
                fontSize: 11,
                lineHeight: 1.2,
              }}
            >
              {WINDOW_LABEL[w]}
            </Link>
          );
        })}
      </div>

      {fellBackFrom && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: themeA.hintBg,
            border: `1px solid ${themeA.border}`,
            color: themeA.muted,
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <span style={{ color: themeA.text }}>
            {WINDOW_LABEL[fellBackFrom]}
          </span>{" "}
          was too active for live aggregation here, so we narrowed to{" "}
          <span style={{ color: themeA.text }}>
            {WINDOW_LABEL[contract.windowKey]}
          </span>
          . This is the widest window we can serve fast for this contract
          right now. A pre-aggregated all-time view is on the roadmap.
        </div>
      )}

      <div>
        <span style={{ color: themeA.subtle }}>stats over blocks</span>{" "}
        {isAllTime ? (
          <>
            <span style={{ color: themeA.text }}>indexed history</span>{" "}
            <span style={{ color: themeA.subtle }}>through</span>{" "}
            <Link href={`/block/${contract.windowToBlock}`} className="pev-link">
              #{contract.windowToBlock.toLocaleString()}
            </Link>
          </>
        ) : (
          <>
            <Link href={`/block/${contract.windowFromBlock}`} className="pev-link">
              #{contract.windowFromBlock.toLocaleString()}
            </Link>{" "}
            <span style={{ color: themeA.subtle }}>to</span>{" "}
            <Link href={`/block/${contract.windowToBlock}`} className="pev-link">
              #{contract.windowToBlock.toLocaleString()}
            </Link>
          </>
        )}
        <span style={{ color: themeA.muted }}> ({durationLabel})</span>
      </div>
    </section>
  );
}

function WorstBlockCallout({
  recent,
}: {
  recent: Array<{
    number: number;
    parallelismScore: number;
    conflictCount: number;
    txCount: number;
  }>;
}) {
  if (recent.length === 0) return null;
  // Sort a copy by score asc, conflicts desc, take the first.
  const worst = [...recent]
    .sort(
      (a, b) =>
        a.parallelismScore - b.parallelismScore ||
        b.conflictCount - a.conflictCount,
    )[0];
  if (worst.parallelismScore >= 70 || worst.conflictCount === 0) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <Link
        href={`/block/${worst.number}`}
        style={{
          display: "block",
          padding: "18px 22px",
          background: "rgba(200, 85, 61, 0.06)",
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          textDecoration: "none",
          color: themeA.text,
          transition: "border-color 120ms ease",
        }}
        className="pev-chip-bottleneck"
      >
        <div className="pev-eyebrow" style={{ marginBottom: 6 }}>
          Worst recent block
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div
            className="pev-display-italic"
            style={{ fontSize: 22, color: themeA.text }}
          >
            #{worst.number.toLocaleString()}
            <span
              style={{
                color: themeA.muted,
                fontFamily: themeA.mono,
                fontStyle: "normal",
                fontSize: 12,
                marginLeft: 14,
              }}
            >
              {worst.txCount} tx · {worst.conflictCount} conflict
              {worst.conflictCount === 1 ? "" : "s"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: themeA.mono,
                fontSize: 18,
                color: themeA.status.sourceText,
              }}
            >
              {worst.parallelismScore}/100
            </span>
            <span
              style={{
                fontFamily: themeA.sans,
                fontSize: 12,
                color: themeA.accent,
                letterSpacing: ".01em",
              }}
            >
              Inspect this block →
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ borderLeft: `2px solid ${themeA.border}`, paddingLeft: 14 }}>
      <div className="pev-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: themeA.mono,
          fontSize: 22,
          color: color ?? themeA.text,
          marginTop: 4,
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Card({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        padding: "14px 16px",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div className="pev-eyebrow" style={{ whiteSpace: "nowrap" }}>{eyebrow}</div>
        <div
          className="pev-display-italic"
          style={{
            fontSize: 17,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function NotSeen({
  addr,
  lastSeen,
  windowKey,
}: {
  addr: string;
  lastSeen: { block: number; at: Date } | null;
  windowKey: ContractWindowKey;
}) {
  // Two failure modes; one component, two voices.
  //
  //  1. Never seen     , lastSeen === null. Contract address pev has no
  //                      record of. Brand-new deploy, wrong network,
  //                      pre-genesis address, or a typo.
  //
  //  2. Seen, gone quiet, lastSeen !== null. pev has indexed this contract
  //                      at some point but it hasn't been active inside
  //                      the requested window. Common when checking a
  //                      third-party leaderboard: a contract can have
  //                      24h activity yet none in the last hour, or have
  //                      a week of activity yet none in the last day. We
  //                      surface a one-click "broaden to All time" link.
  const heading = lastSeen ? "Contract is quiet in this window" : "Contract not seen yet";
  const ageSeconds = lastSeen ? Math.max(0, Math.round((Date.now() - lastSeen.at.getTime()) / 1000)) : 0;
  const ageLabel = formatAge(ageSeconds);

  return (
    <main style={{ padding: "48px clamp(20px, 4vw, 64px)", maxWidth: 720, margin: "0 auto" }}>
      <SiteHeader
        variant="internal"
        tagline="How this contract behaves under parallel load"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb href="/">contract</Crumb>
            <CrumbSep />
            <Crumb current title={addr}>{shortHex(addr, 6, 4)}</Crumb>
          </>
        }
      />
      <h1
        className="pev-display-italic"
        style={{
          fontSize: 32,
          marginBottom: 12,
          color: themeA.text,
          marginTop: 32,
        }}
      >
        {heading}
      </h1>

      {lastSeen ? (
        <>
          <p style={{ color: themeA.muted, lineHeight: 1.6 }}>
            pev has indexed transactions for{" "}
            <span className="pev-mono" style={{ color: themeA.text }}>{shortHex(addr, 8, 6)}</span>
            , just not inside the{" "}
            <span className="pev-mono" style={{ color: themeA.text }}>
              {WINDOW_LABEL[windowKey]}
            </span>{" "}
            window you're viewing.
          </p>
          <p style={{ color: themeA.muted, lineHeight: 1.6, marginTop: 14 }}>
            Last seen at block{" "}
            <Link
              href={`/block/${lastSeen.block}`}
              className="pev-link pev-mono"
            >
              #{lastSeen.block.toLocaleString()}
            </Link>
            {" "}, about <span style={{ color: themeA.text }}>{ageLabel} ago</span>.
          </p>
          {windowKey !== "all" && (
            <p style={{ marginTop: 22 }}>
              <Link
                href={urlForWindow(addr, "all")}
                className="pev-link"
                style={{ fontWeight: 500 }}
              >
                → broaden to All time
              </Link>
              <span style={{ color: themeA.subtle, marginLeft: 12 }}>
                or jump to that block
              </span>{" "}
              <Link
                href={`/block/${lastSeen.block}`}
                className="pev-link pev-mono"
              >
                #{lastSeen.block.toLocaleString()}
              </Link>
            </p>
          )}
        </>
      ) : (
        <p style={{ color: themeA.muted, lineHeight: 1.6 }}>
          Address{" "}
          <span className="pev-mono" style={{ color: themeA.text }}>{shortHex(addr, 8, 6)}</span>{" "}
          hasn't appeared in any of the blocks pev has indexed. It may be a
          brand-new contract, an address that has never transacted, or
          deployed before our backfill window starts.
        </p>
      )}

      <p style={{ marginTop: 22 }}>
        <Link href="/" className="pev-link">← back to recent activity</Link>
      </p>
    </main>
  );
}

/**
 * Compact "time-ago" label for the NotSeen subtitle. Tuned for the typical
 * range we expect (minutes to a few days); over a week we just say "1+ week"
 * because precision past that doesn't help the reader.
 */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return "1+ week";
}

// ─── verdict + per-method analysis helpers ──────────────────────

interface Verdict {
  tier: "healthy" | "bottlenecked" | "killer";
  color: string;
  label: string;
  message: string;
}

/**
 * computeVerdict, single-sentence editorial summary of how this contract
 * behaves under parallel load. Mirrors the per-block Verdict component on
 * the landing page so the brand voice stays consistent across the app.
 *
 * Tiers are based on two signals: average block parallelism score and
 * conflicts-per-block ratio. Both have to be soft so we don't mislabel
 * a contract that's heavy-traffic-but-clean as "bottlenecked".
 */
function computeVerdict(
  contract: ContractDetail,
  methodNames: Map<string, string | null>,
): Verdict {
  const conflictsPerBlock =
    contract.blocksAppeared > 0
      ? contract.conflictsCaused / contract.blocksAppeared
      : 0;

  const avgWaves =
    contract.recentBlocks.length > 0
      ? Math.round(
          (contract.recentBlocks.reduce((sum, b) => sum + b.executionDepth, 0) /
            contract.recentBlocks.length) *
            10,
        ) / 10
      : null;

  const wavesPhrase =
    avgWaves !== null
      ? `runs in ${avgWaves} wave${avgWaves === 1 ? "" : "s"} on average`
      : null;

  // Top method is the highest-conflict one. Only surface it in the verdict
  // when it actually caused conflicts, otherwise we'd say things like
  // "Top conflict source: foo (0 conflicts)" on edge-case tiers.
  const topMethod = contract.methods[0];
  const topMethodLabel =
    topMethod && topMethod.conflictsCaused > 0
      ? humanizeMethod(topMethod.selector, methodNames)
      : null;

  if (contract.avgParallelismScore >= 70 && conflictsPerBlock < 1) {
    return {
      tier: "healthy",
      color: themeA.status.clean,
      label: "Healthy",
      message: wavesPhrase
        ? `${wavesPhrase}, fully parallel.`
        : "Fully parallel.",
    };
  }

  if (contract.avgParallelismScore >= 40 && conflictsPerBlock < 3) {
    const methodPart = topMethodLabel
      ? ` Top conflict source: ${topMethodLabel} (${topMethod.conflictsCaused.toLocaleString()} conflicts).`
      : "";
    return {
      tier: "bottlenecked",
      color: themeA.status.delayed,
      label: "Bottlenecked",
      message: `${wavesPhrase ? wavesPhrase[0].toUpperCase() + wavesPhrase.slice(1) + "." : ""}${methodPart}`.trim(),
    };
  }

  const slotPart =
    contract.hotSlots.length > 0
      ? ` ${contract.conflictsCaused.toLocaleString()} conflicts across ${contract.hotSlots.length} hot storage slot${contract.hotSlots.length === 1 ? "" : "s"}.`
      : ` ${contract.conflictsCaused.toLocaleString()} conflicts caused.`;
  const methodPart = topMethodLabel ? ` Worst method: ${topMethodLabel}.` : "";
  return {
    tier: "killer",
    // sourceText: this color renders as the verdict label text.
    color: themeA.status.sourceText,
    label: "Throughput-killer",
    message: `${slotPart}${methodPart}`.trim(),
  };
}

/**
 * humanizeMethod, returns a display label for a 4-byte selector.
 * Resolved → just the function name ("transfer").
 * Unresolved → "fn 0x98717539" so it reads as a function and not
 * as a contract address (both are 0x-prefixed hex).
 */
function humanizeMethod(
  selector: string,
  methodNames: Map<string, string | null>,
): string {
  const sig = methodNames.get(selector.toLowerCase());
  if (sig) {
    return sig.split("(")[0];
  }
  return `fn ${selector}`;
}

function VerdictBlock({ verdict }: { verdict: Verdict }) {
  return (
    <section
      style={{
        marginBottom: 32,
        paddingTop: 18,
        paddingBottom: 18,
        borderTop: `1px solid ${themeA.border}`,
        borderBottom: `1px solid ${themeA.border}`,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: 12,
        lineHeight: 1.4,
      }}
    >
      <span
        className="pev-display-italic"
        style={{ fontSize: 22, color: verdict.color }}
      >
        {verdict.label}.
      </span>
      <span
        style={{
          fontFamily: themeA.serif,
          fontSize: 16,
          color: themeA.text,
          fontStyle: "italic",
        }}
      >
        {verdict.message}
      </span>
    </section>
  );
}

/**
 * MethodList, per-method conflict breakdown. Each row has a horizontal
 * bar visualising what share of total contract conflicts this method
 * is responsible for. The point is to make "your swap() does 73% of
 * the damage" obvious at a glance, not to show another table of numbers.
 */
function MethodList({
  methods,
  methodNames,
}: {
  methods: ContractMethod[];
  methodNames: Map<string, string | null>;
}) {
  const totalConflicts = methods.reduce((s, m) => s + m.conflictsCaused, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {methods.map((m, i) => {
        const sig = methodNames.get(m.selector.toLowerCase());
        const resolved = sig !== null && sig !== undefined;
        const name = resolved ? sig.split("(")[0] : m.selector;
        const argsTail = resolved ? sig.slice(name.length) : null;
        const pct =
          totalConflicts > 0 ? (m.conflictsCaused / totalConflicts) * 100 : 0;
        // conflictColor renders as inline text on the methods table
        // (the count next to each function). sourceText gives the AA
        // contrast that source can't on dark surfaces. The bar fill
        // below stays on the saturated `source` because it's a
        // background, not text.
        const conflictColor =
          m.conflictsCaused > 0 ? themeA.status.sourceText : themeA.subtle;
        return (
          <div
            key={m.selector}
            style={{
              padding: "12px 0",
              borderBottom:
                i < methods.length - 1
                  ? `1px solid ${themeA.border}`
                  : "none",
              fontFamily: themeA.mono,
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  color: themeA.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={
                  resolved
                    ? sig
                    : `Function selector ${m.selector}, not in 4byte directory yet`
                }
              >
                {/* Unresolved selectors get a muted "fn" prefix so they read
                    as functions instead of looking like contract addresses
                    (both are 0x-hex). Resolved methods skip the prefix
                    because the human name already signals "this is a function". */}
                {!resolved && (
                  <span
                    style={{
                      color: themeA.subtle,
                      marginRight: 6,
                      textTransform: "uppercase",
                      fontSize: 10,
                      letterSpacing: ".05em",
                    }}
                  >
                    fn
                  </span>
                )}
                <span style={{ fontWeight: 500 }}>{name}</span>
                {argsTail && (
                  <span
                    style={{
                      color: themeA.subtle,
                      marginLeft: 8,
                      fontSize: 11,
                    }}
                  >
                    {argsTail}
                  </span>
                )}
              </span>
              <span style={{ color: themeA.muted, whiteSpace: "nowrap" }}>
                <span style={{ color: themeA.text }}>
                  {m.txCount.toLocaleString()}
                </span>{" "}
                tx ·{" "}
                <span style={{ color: conflictColor }}>
                  {m.conflictsCaused.toLocaleString()} conf
                </span>{" "}
                ·{" "}
                <span style={{ color: themeA.text }}>
                  {pct.toFixed(0)}%
                </span>{" "}
                of total
              </span>
            </div>
            {/* Conflict-share bar. Width is the % this method contributed to
                total conflicts on this contract. Visual quickly communicates
                "this method is the problem" without the user reading numbers. */}
            <div
              style={{
                height: 4,
                background: themeA.dim,
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: m.conflictsCaused > 0 ? themeA.status.source : themeA.subtle,
                  transition: "width .3s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * decodeSlot, easy-mode storage slot interpretation.
 *
 * In Solidity, the first N state variables map to slots 0, 1, 2... directly.
 * Mappings and dynamic arrays produce slots that are keccak256 hashes of
 * their key + parent slot, so they look like high-entropy 256-bit numbers.
 *
 * We use this to give devs a quick orientation: a low-numbered slot is
 * almost certainly a declared state variable at that index; a hash-looking
 * slot is almost certainly a mapping or array entry. v2 will use the
 * Sourcify storage layout (when verified) to name them precisely.
 */
function decodeSlot(slotHex: string): { display: string; hint: string } {
  try {
    const n = BigInt(slotHex);
    if (n < 1000n) {
      return { display: `slot #${n}`, hint: "state var" };
    }
  } catch {
    // Fall through to mapping/array case
  }
  return { display: shortHex(slotHex, 10, 6), hint: "mapping/array" };
}

