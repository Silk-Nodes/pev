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

Nothing yet. Add bullets here as work lands on `main`; the next release
will move them into a dated version section.

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
