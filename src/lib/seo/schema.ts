/**
 * schema.ts, schema.org / JSON-LD builders for pev.
 *
 * Why JSON-LD instead of microdata or RDFa:
 *   • Google explicitly recommends JSON-LD as the preferred format
 *   • Lives in a <script type="application/ld+json"> tag, fully
 *     decoupled from rendered markup so we don't have to thread
 *     itemtype/itemprop attributes through every React component
 *   • Easy to compose: one @graph array can hold multiple entities
 *     (Organization + WebSite + SoftwareApplication) per page
 *
 * Strategy: ship a small set of high-value entities on every page,
 * plus per-route Breadcrumb/WebPage on detail pages. We don't add
 * Article (no blog), FAQPage (docs aren't Q&A-structured), or
 * Product (we don't sell). Those would be noise.
 *
 * Validation tip: paste the rendered page into
 * https://validator.schema.org/ or https://search.google.com/test/rich-results
 * to confirm the JSON-LD parses correctly.
 */

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pev.silknodes.io";

/** Stable @id for the Silk Nodes Organization so other entities can
 *  reference it by URI instead of repeating the object. JSON-LD treats
 *  any IRI as a node identifier; we use silknodes.io#org. */
const SILK_NODES_ID = "https://silknodes.io#org";
const PEV_WEBSITE_ID = `${SITE_URL}#website`;
const PEV_APP_ID = `${SITE_URL}#software`;

/**
 * Silk Nodes as an Organization. Uses the company's own positioning
 * language from silknodes.io ("professional", "validators, RPC,
 * white-label", "self-owned globally distributed network"). Linked
 * via @id from every page so Google sees one consistent publisher.
 */
export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": SILK_NODES_ID,
    name: "Silk Nodes",
    url: "https://silknodes.io",
    description:
      "Professional blockchain infrastructure provider running validators, dedicated RPC nodes, and white-label services on a self-owned, globally distributed network with a zero-slashing track record.",
    sameAs: [
      // Add any verified social profiles here when stable; helps
      // Google merge the entity across sources.
    ],
  } as const;
}

/**
 * pev as a WebSite. Lets Google offer a sitelinks search box if it
 * decides the site is searchable enough. We don't define a search
 * action because pev's "search" is paste-an-address, not a query
 * box (yet); when we add a query API we can add SearchAction here.
 */
export function websiteSchema() {
  return {
    "@type": "WebSite",
    "@id": PEV_WEBSITE_ID,
    name: "pev",
    alternateName: "Parallel Execution Visualizer",
    url: SITE_URL,
    description:
      "Parallel Execution Visualizer for Monad mainnet. Traces every block, surfaces storage contention, and shows per-contract parallelism scores.",
    inLanguage: "en",
    publisher: { "@id": SILK_NODES_ID },
  } as const;
}

/**
 * pev as a SoftwareApplication. Most useful single entity for search:
 * positions pev as a developer tool, free, web-delivered, with a
 * concrete feature list Google can use to populate rich results.
 *
 * applicationCategory taxonomy: "DeveloperApplication" is the closest
 * standard term; sub-category strings are free-form and not used by
 * Google in any documented way, so we keep them descriptive.
 */
export function softwareApplicationSchema() {
  return {
    "@type": "SoftwareApplication",
    "@id": PEV_APP_ID,
    name: "pev",
    alternateName: "Parallel Execution Visualizer for Monad",
    url: SITE_URL,
    description:
      "Free developer tool for Monad mainnet. Traces every block live and shows which contracts are creating contention: storage conflicts, hot slots, and a per-contract parallelism score.",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Blockchain analytics",
    operatingSystem: "Web",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: { "@id": SILK_NODES_ID },
    publisher: { "@id": SILK_NODES_ID },
    featureList: [
      "Live block tracing on Monad mainnet",
      "Per-contract parallelism score (0-100)",
      "Hot storage slot detection",
      "Method-level conflict breakdown",
      "Write-write, read-write, and mixed conflict classification",
      "Network-wide analytics with rolling windows",
      "Dynamic OG cards for shareable links",
    ],
  } as const;
}

/**
 * Root @graph containing every entity that appears on every page.
 * One JSON-LD block in the root layout covers all three. Per-page
 * schemas (Breadcrumb, WebPage) are emitted separately by the
 * relevant page component.
 */
export function rootGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), websiteSchema(), softwareApplicationSchema()],
  };
}

/**
 * BreadcrumbList for a detail page. Pass an ordered array of
 * `{ name, url }`; the function emits the right itemListElement
 * shape with position numbers.
 *
 * Example:
 *   breadcrumbSchema([
 *     { name: "pev",     url: "/" },
 *     { name: "block",   url: "/" },
 *     { name: "#73,000,000", url: "/block/73000000" },
 *   ])
 *
 * Google uses this to render breadcrumb trails in search results,
 * which improves CTR meaningfully on deep-link results.
 */
export function breadcrumbSchema(
  items: Array<{ name: string; url: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url.startsWith("http") ? it.url : `${SITE_URL}${it.url}`,
    })),
  };
}

/**
 * WebPage schema for /docs. The page is editorial reference content,
 * so we tag it with `isPartOf` pointing at the WebSite entity above.
 * Google treats this as a documentation page rather than an Article
 * (which would imply a datePublished + author byline).
 */
export function docsWebPageSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/docs#webpage`,
    url: `${SITE_URL}/docs`,
    name: "pev docs",
    description:
      "How pev works, what each metric means, how to read the contract page, and what the data does and doesn't cover. Plus the public API surface.",
    isPartOf: { "@id": PEV_WEBSITE_ID },
    about: { "@id": PEV_APP_ID },
    inLanguage: "en",
    publisher: { "@id": SILK_NODES_ID },
  };
}

/**
 * FAQPage schema for /docs.
 *
 * Eight Q&A pairs drawn from the visible content on /docs (the metrics
 * glossary and the "what pev is" intro). Each answer is text that
 * appears verbatim or near-verbatim on the page, per Google's
 * requirement that FAQ markup reflects content the user can see.
 *
 * About the actual rich-result behavior: Google narrowed FAQ rich
 * results in Aug 2023 to "authoritative government and health sites"
 * only. For general dev tools, FAQ markup still validates and helps
 * Google understand the page structure, but won't produce the
 * expandable Q&A block in search results today. Worth shipping
 * anyway: it's correct structured data, and policy may broaden again.
 *
 * If the page's prose ever changes meaningfully, regenerate these to
 * keep the markup in sync with what users actually see on the page.
 */
export function docsFaqSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/docs#faq`,
    mainEntity: [
      {
        "@type": "Question",
        name: "What is pev?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "pev (Parallel Execution Visualizer) is a free developer tool for Monad mainnet. It traces every block as it lands and reconstructs what would have happened if the txs had run in true parallel: which transactions touch the same storage slots, which ones blocked which, and how many sequential rounds were forced by contention.",
        },
      },
      {
        "@type": "Question",
        name: "How does parallel execution work on Monad?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "Monad runs transactions in parallel across separate execution lanes. When two transactions touch the same storage slot in the same block, the chain has to run one first and re-execute the other once it finishes. The shape of your contract decides where on the parallel-to-serial spectrum a block lands.",
        },
      },
      {
        "@type": "Question",
        name: "What is the Parallelism Score?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "A 0 to 100 measure of how parallel-friendly a block is. 100 means every transaction could have run in parallel with no contention. 0 would be every transaction blocking the next one, fully serial. Real Monad blocks typically land between 60 and 95. Computed as the ratio of tx count to required execution waves.",
        },
      },
      {
        "@type": "Question",
        name: "What are Execution Waves?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "The minimum number of sequential rounds the block needs because of conflicts. Wave 1 runs everything that has no upstream dependency. Wave 2 runs everything blocked only by Wave 1 results. A block with depth 1 is fully parallel; depth 5 means a chain of 5 transactions where each one waited for the previous.",
        },
      },
      {
        "@type": "Question",
        name: "What is a Hot Storage Slot?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "A storage slot (a specific 32-byte location at a specific contract) touched by 2 or more transactions in the same block. Hot slots are the literal bottleneck: every tx that reads or writes a hot slot has to wait for the txs that already wrote it in this block to commit.",
        },
      },
      {
        "@type": "Question",
        name: "What is a write-write conflict?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "Two transactions in the same block both wrote the same storage slot. One has to win the race, the other is re-executed. About 94% of all conflicts observed on Monad mainnet are write-write, dominated by hot counters and shared pool state.",
        },
      },
      {
        "@type": "Question",
        name: "How do I check my contract on pev?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "Open /contract/<your-address>. Default view is the last 7 days. Read the verdict line at the top (Healthy, Bottlenecked, or Throughput-killer), then scroll to Hot Storage Slots and Methods Causing Conflicts to find the exact lines of code worth refactoring. Use the window selector to compare different time horizons.",
        },
      },
      {
        "@type": "Question",
        name: "What history does pev cover?",
        acceptedAnswer: {
          "@type": "Answer",
          text:
            "pev's indexer started on Monad mainnet on April 25, 2026 and live-tails the chain head. Older blocks are not currently indexed. The window grows naturally as the indexer runs; backfill may be added if there's demand.",
        },
      },
    ],
  };
}
