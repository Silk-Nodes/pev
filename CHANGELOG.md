# Changelog

All notable changes to pev (Parallel Execution Visualizer for Monad) are
recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Conventions

- **MAJOR** version when public URLs, JSON API shapes, or the
  parallelism-score methodology change in a way that breaks existing
  consumers.
- **MINOR** version for new features that don't break existing
  consumers (new pages, new metrics, new API endpoints).
- **PATCH** version for bug fixes, content updates, and accessibility
  or performance polish that doesn't add user-visible features.

Every release is also published as a GitHub Release at
[github.com/Silk-Nodes/pev/releases](https://github.com/Silk-Nodes/pev/releases).
The release body mirrors the entry below, plus a one-line summary at
the top. See `deploy/RELEASING.md` for the step-by-step process.

## [Unreleased]

### Added

- `CHANGELOG.md` (this file) as the canonical record of changes.
- `deploy/RELEASING.md`: step-by-step runbook for cutting a new release.
- Pointer in `CONTRIBUTING.md` linking maintainers to the release flow.
- `data/contract-labels.yaml`: curated labels for the top 100 contracts
  on Monad mainnet. 23 auto-discovered via on-chain ERC-20 `name()`
  calls (Wrapped MON, USDC, AUSD, ShMonad, Kuru Vault, NFTs, memecoins),
  plus 10 manually researched dApp infrastructure contracts including
  Perpl (#1 throughput killer), Kuru Exchange (three markets), FastLane
  AuctionHandler, Uniswap PoolManager, Nad.fun bonding curve, Monad
  Staking system contract, RedStone oracle adapters. The analytics
  leaderboard and contract pages now show recognizable names instead of
  raw hex for these addresses.
- `scripts/probe-contract-labels.ts`: generates the YAML from a CSV of
  candidate addresses by probing on-chain ERC-20 metadata and Sourcify.
- `scripts/sync-contract-labels.ts`: idempotent loader that reads the
  YAML and upserts into the `contract_labels` table. Safe to re-run
  after editing the YAML.

### Changed

- Contract page metadata (`<title>`, OG title, Twitter card title) now
  uses the human-readable contract name when one is available in the
  `contract_labels` table. For example, `/contract/0x34b6...` now reads
  as "Perpl, parallel profile · pev" instead of "Contract 0x34b6...2a6f
  · pev". Critical for SEO and social-link previews on labeled
  contracts. Unlabeled contracts continue to use the short hex
  fallback. The resolver is cache-first so the metadata-path overhead
  is sub-millisecond.
- LiveBlockFeed (the "Recent activity" list on the homepage) now pauses
  incoming rows when the user hovers the feed. New blocks queue
  silently while the cursor is inside the feed; a small ember-tinted
  chip appears at the top reading "N new blocks, click or move away to
  load". On mouse-leave or chip click, the queued blocks flow in
  together with the existing ember-tint fresh highlight plus a new
  260ms slide-in animation. This solves the previous problem where
  rows shifted every ~0.5-1s as Monad blocks arrived, making them
  effectively unreadable for anyone trying to focus on a row. The feed
  remains genuinely live (the status pill stays green, the queue
  fills in real time), the user just gets visual stability while
  reading. Also dropped maxRows default from 20 to 10 since 20 was
  more vertical footprint than the page needed.
- SiteHeader is now smart-sticky: pinned to the top of the viewport,
  slides up off-screen when the user scrolls down, slides back in the
  moment they scroll up. Always visible inside the first 100px of
  scroll (header is in its natural position there). 6px direction-
  change threshold prevents jitter from trackpad inertia. Pattern
  matches YouTube/Medium/Twitter mobile: navigation is one upward
  scroll-flick away on long pages (docs, analytics, contract pages)
  but doesn't take real estate while reading. Implementation uses
  `position: sticky` + a transform-based hide so the header doesn't
  pop content around when toggling. SiteHeader was flipped to a Client
  Component to access window.scrollY; SSR is unchanged since Client
  Components still render to HTML.
- SiteHeader transparent at the top, opaque when stuck. The header
  previously had an always-on background and bottom border, which made
  it read as a separate box floating above the page rather than as
  part of the layout. Now at the top of the page (scrollY < 12) the
  header has a transparent background and a transparent border, so it
  blends seamlessly into the body. Once scrolled, the background and
  border fade in over 180ms to provide a clean separator from content
  scrolling underneath. Better natural feel without losing the "this
  is the chrome" affordance when it matters.
- SiteHeader mobile trim: on viewports under 720px the tagline and the
  "by Silk Nodes →" attribution are hidden via display:none. Both are
  available elsewhere (tagline echoed in the page hero, Silk Nodes
  link in the footer), and dropping them keeps the right-cluster nav
  from overflowing the right edge on phones. Header padding and gap
  are also tighter on mobile so the sticky band doesn't dominate the
  small viewport.
- LiveBlockFeed row mobile trim: the 6-column desktop row (dot, block
  number + hash, tx count, score, conflicts, "Xs ago") was getting
  clipped on the right edge on phones, hiding the age and making
  multi-digit conflict counts look broken. Mobile now uses a 4-column
  layout: dot, block number, score, conflicts, age. We drop the block
  hash (redundant with the block number for ID purposes), drop the tx
  count (less interesting than parallelism + conflicts in a glance
  feed), and drop the literal " ago" suffix on the age (the column's
  position already reads as "time"). Padding and gap tighten too.
  Every row now fits comfortably on a 390px iPhone viewport, including
  3-digit conflict counts.
- Pre-empt the "does this cost me gas?" question on the contract page
  verdict. When the verdict is "Bottlenecked" or "Throughput-killer",
  a quiet single-line clarifier now appears below the headline: the
  verdict refers to chain-wide throughput cost, not direct user gas
  charges. Users pay for the final committed gasUsed; re-executions
  are absorbed by the chain. The clarifier links to the new
  "Re-execution and gas" entry in the docs glossary for the full
  explanation. Healthy verdicts get no clarifier since there's nothing
  to clarify there.
- Added a "Re-execution and gas" entry to the docs metrics glossary
  (Section 03). Directly answers a question we kept seeing from
  developers reading pev: when a contract causes re-executions, who
  pays? Answer: not the user directly. Users pay for the final
  committed execution; re-execution overhead is validator compute that
  surfaces as a chain-level throughput cost, eventually affecting
  base fees during congestion. Important framing so the throughput-
  killer leaderboard doesn't get read as "these contracts are
  overcharging users".

### Fixed

- Header layout on pages with long taglines (contract page especially):
  the orange search-submit button was butting up against the "analytics"
  nav link with no visible breathing room. Bumped the header gap from
  18 to 28 and reduced the header search maxWidth from 420 to 360 since
  short queries (block numbers, addresses, tx hashes) don't need a wide
  field. Visual breathing room is enforced by the gap + form max, not
  by reserving flex space in the search slot, which would force the
  right cluster to wrap to a new row on otherwise-fine viewports.
- Shortened the two longest page taglines (both 45 chars) to fit the
  header layout without crowding the nav: contract page from "How this
  contract behaves under parallel load" to "How this contract
  parallelizes" (mirrors the homepage "How Monad parallelizes" pattern),
  and tx page from "One transaction's place in the parallel graph" to
  "This tx in the parallel graph". Added a tagline-length guideline
  (~35 char ceiling) to the `tagline` prop docs in SiteHeader.

## [0.1.0] - 2026-05-14

First public release. pev runs in production at
[pev.silknodes.io](https://pev.silknodes.io) and the source moves to
[github.com/Silk-Nodes/pev](https://github.com/Silk-Nodes/pev) under
the MIT license.

### Added

- **Block view** (`/block/<number>`): parallelism score per block,
  wave diagram showing which transactions had to wait on which, and a
  conflict graph annotated with the contended storage slots.
- **Contract view** (`/contract/<address>`): aggregate parallelism
  score over 1h/24h/7d/30d/all-time, methods ranked by conflicts
  caused, hot storage slots with conflict counts, and an editorial
  verdict line ("Parallel-friendly", "Bottleneck", "Throughput-killer").
- **Transaction view** (`/tx/<hash>`): status (parallel / delayed /
  source of conflict), and the conflict edges showing which earlier
  txs blocked this one and which later txs this one blocked.
- **Analytics** (`/analytics`): most-active contracts on Monad over
  rolling windows, throughput-killer leaderboard, network-wide
  parallelism trends.
- **Feedback portal** (`/feedback`): public vote-based feature
  requests, anonymous via browser cookie, no login required.
- **Docs** (`/docs`): methodology, glossary, and recipe-style use-case
  walkthroughs.
- **Indexer**: Node.js + tsx service consuming Monad blocks via
  `prestateTracer` (both `diffMode: true` and `false` to cover both
  writes and read-only state access), persisting conflict edges and
  storage touches to Postgres.
- **Pre-aggregation**: systemd timers refresh per-contract metrics
  and analytics caches on a schedule, keeping page loads fast.
- **Live chain head**: WebSocket subscription to
  `eth_subscribe("newHeads")` for the LiveStatus tick on every page.
- **Public deploy tooling**: `deploy/deploy.sh` for one-command
  rsync-based deploys, `deploy/INSTALL.md` for one-VM setup, sanitized
  systemd units, and `deploy/run.sh` for portable indexer/web startup.

### Security

- HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`
  on every response.
- `X-Robots-Tag: noindex, nofollow` on all `/api/*` routes so JSON
  endpoints don't leak into search results.

### Accessibility

- All text passes WCAG AA contrast (4.5:1 minimum) on every dark
  surface. Added a `themeA.status.sourceText` variant of the brand
  terracotta for inline text emphasis while keeping the saturated
  brand color for filled chips, stripes, and chart bars.
- Heading hierarchy follows h1 to h2 to h3 with no skipped levels on
  every page (fixed `/feedback` section headers).

### Privacy

- Google Analytics is opt-in via a consent banner. Anonymous
  pageviews only, no personal data, no ads, no third-party sharing.
  Full disclosure on `/privacy`.
- Feedback votes use an HttpOnly browser cookie, no account, no IP
  stored beyond a short-window rate-limit check on submissions.

[Unreleased]: https://github.com/Silk-Nodes/pev/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Silk-Nodes/pev/releases/tag/v0.1.0
