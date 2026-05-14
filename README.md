# pev, Parallel Execution Visualizer for Monad

> Is your contract killing parallelism? pev surfaces storage conflicts, hot slots, and per-contract parallelism scores from live Monad mainnet traces.

🔗 **Live**: [pev.silknodes.io](https://pev.silknodes.io)
🛠️ **Built by**: [Silk Nodes](https://silknodes.io)
📜 **License**: [MIT](./LICENSE)
💬 **Feedback**: [pev.silknodes.io/feedback](https://pev.silknodes.io/feedback)

---

## What pev does

Monad runs transactions in parallel across separate execution lanes. When two transactions touch the same storage slot in the same block, the chain has to run one first and re-execute the other once it finishes. The shape of your contract decides how parallel the chain can be.

pev traces every block as it lands and reconstructs the conflict graph: which transactions touch the same storage slots, which ones blocked which, and how many sequential rounds were forced by contention.

If you write contracts on Monad, pev tells you exactly which slots are costing you throughput and which methods are causing the contention.

---

## Features

- **Live block tracing** on Monad mainnet, every block, sub-second after finality
- **Per-contract parallelism score** with verdict line: Healthy, Bottlenecked, or Throughput-killer
- **Hot storage slot detection** ranked by conflicts caused, not just touches
- **Method-level conflict breakdown** by 4-byte function selector, so you can find the exact function in your code
- **Network-wide analytics** with rolling windows (1h / 24h / 7d / 30d / all)
- **Public API** at `/api/v1/` for programmatic access (read-only, no auth, no rate limits today)
- **Dynamic OG cards** so every shared link renders a live preview
- **Anonymous feedback portal** at `/feedback` with voting and a public roadmap

---

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│ Monad node  │  RPC    │   Indexer    │  SQL    │  Postgres    │
│ (any 14+    │ ──────► │ (Node.js,    │ ──────► │  (any 14+)   │
│  RPC with   │ trace   │  pg-boss     │         │              │
│  debug_*)   │         │  workers)    │         │              │
└─────────────┘         └──────────────┘         └──────┬───────┘
                                                        │
                                                        │ SQL
                                                        ▼
                                                 ┌──────────────┐
                                                 │ Next.js web  │
                                                 │ (server +    │
                                                 │  client      │
                                                 │  components) │
                                                 └──────────────┘
```

- **Indexer**: subscribes to new blocks (WebSocket if available, polling fallback), runs `debug_traceBlockByNumber` with `prestateTracer` for both `diffMode: true` (storage changes) and `diffMode: false` (every touched account). Writes structured data into Postgres.
- **Web**: Next.js 15 App Router. Server Components for SEO-friendly initial render; Client Components for interactive bits (search bar, vote buttons, live status indicator). Two precomputed aggregate tables (`analytics_cache`, `contract_index`) refreshed by systemd timers so page loads stay fast on heavy contracts.
- **No frontend framework lock-in**: plain CSS in `globals.css` with brand tokens, inline styles in components.

---

## Run locally

### Prerequisites

- Node 22+
- Postgres 14+
- A Monad RPC endpoint with `debug_traceBlockByNumber` + `prestateTracer` enabled

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local: DATABASE_URL, MONAD_RPC_URL (required), MONAD_WS_URL (optional)

# 3. Run migrations
npm run db:migrate

# 4. Start the dev server
npm run dev
# → http://localhost:3000

# 5. (separate terminal) Start the indexer
npm run indexer
```

The indexer will start tailing the chain head. The web server reads from Postgres. You should start seeing blocks appear in `http://localhost:3000` within a minute.

### Backfill

To index historical blocks, run:

```bash
npm run indexer:backfill -- <from-block> <to-block>
```

Backfill runs in parallel with live indexing; live blocks always cut the line so the indexer never falls behind real-time.

### Useful scripts

```bash
npm run db:migrate                # apply pending migrations
npm run db:status                 # list migrations and their state
npm run db:analyze                # ANALYZE the hot tables (run after first big backfill)
npm run db:refresh-contract-index # manually refresh the contract aggregate
npm run analytics:refresh         # manually refresh the analytics cache
npm run probe                     # one-shot probe a specific block from the CLI
```

---

## Production deployment

See [`deploy/INSTALL.md`](./deploy/INSTALL.md) for a step-by-step deployment guide using systemd. The reference setup is a single Linux VM running both the indexer and the web service, with Postgres on the same VM and a Cloudflare tunnel in front for HTTPS.

`deploy/deploy.sh` is an rsync-based push-from-laptop deploy script. Set `PEV_HOST=user@your-vm` and run `npm run deploy`.

---

## Data coverage and honest caveats

Full documentation lives at [/docs](https://pev.silknodes.io/docs#coverage). The short version:

- **History depth**: pev's indexer starts from whatever block you backfill to. The hosted instance at pev.silknodes.io started indexing from April 25, 2026.
- **DELEGATECALL targets may be missing**: prestateTracer doesn't surface the implementation contract when a proxy delegate-calls to it (storage changes happen at the proxy's address, not the impl's). A custom JS tracer would fix this; the RPCs we've tested don't support custom tracers.
- **Theoretical parallelism, not actual**: pev computes the maximum parallelism the block's conflict graph allows, not what Monad's scheduler actually picked. The scheduler decisions are internal and not exposed via RPC.
- **Sourcify coverage is thin** on Monad mainnet, so most contracts show as short hex rather than human names. Verify your contract at [sourcify.dev](https://sourcify.dev) and pev will pick the name up automatically.

---

## API reference

Full API documentation at [/docs#api](https://pev.silknodes.io/docs#api). Key endpoints:

```
GET /api/v1/leaderboard/:kind?window=&limit=   # top blocks or top hotspots
GET /api/v1/stats                              # network-wide aggregates
GET /api/v1/block/:number                      # per-block JSON
GET /api/v1/tx/:hash                           # per-tx JSON
GET /api/v1/debug/contract/:address            # is-this-contract-in-pev probe
GET /api/v1/feedback                           # current feature requests
```

No authentication, no rate limits today. We may add rate limits if abused; that change will be announced in `/docs`.

---

## Project layout

```
pev/
├── src/
│   ├── app/                          Next.js App Router pages + API routes
│   ├── components/                   React UI components (parallel/, site/)
│   └── lib/
│       ├── parallel-probe.ts         Server-side block tracer
│       ├── indexer/store.ts          DB layer + windowed queries
│       ├── db.ts                     Postgres pool + statement-timeout helpers
│       ├── feedback/                 Feedback portal store + voter cookies
│       ├── og/                       OG card rendering (Satori)
│       └── seo/schema.ts             JSON-LD builders (Organization, WebSite, etc.)
├── scripts/
│   ├── indexer.ts                    Long-running indexer entry
│   ├── migrate.ts                    SQL migration runner
│   ├── db-analyze.ts                 Refresh planner stats
│   ├── refresh-analytics.ts          Refresh the /analytics cache
│   └── refresh-contract-index.ts     Refresh the per-contract aggregate
├── db/migrations/                    Numbered SQL migrations
├── deploy/
│   ├── INSTALL.md                    One-time setup guide
│   ├── deploy.sh                     Push-from-laptop deploy
│   ├── run.sh                        systemd wrapper (sources nvm)
│   └── *.service / *.timer           systemd units
└── public/                           Static assets, icons
```

---

## Contributing

PRs welcome for bug fixes, performance improvements, and small features. For larger changes, open a [feedback request](https://pev.silknodes.io/feedback) first so we can discuss direction before you spend time on the implementation.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow.

---

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router, Server Components)
- [React 19](https://react.dev)
- [Postgres](https://www.postgresql.org) for storage
- [pg-boss](https://github.com/timgit/pg-boss) for the indexer's job queue
- [Satori](https://github.com/vercel/satori) (via `next/og`) for dynamic OG images
- TypeScript end-to-end

---

## License

[MIT](./LICENSE). Do what you want with the code; attribution to Silk Nodes is appreciated.

If you deploy a commercial competing service using this code, that's allowed by MIT, but reach out at info@silknodes.io. We're more interested in collaborating than competing.

---

## Acknowledgments

- The Monad team for shipping a parallel-execution chain that's fun to instrument
- [Sourcify](https://sourcify.dev) and the [4byte directory](https://www.4byte.directory) for contract and method name resolution
- Every developer who submits feedback at [/feedback](https://pev.silknodes.io/feedback)

Built by [Silk Nodes](https://silknodes.io), a professional blockchain infrastructure provider running validators, dedicated RPC nodes, and white-label services on a self-owned, globally distributed network with a zero-slashing track record.
