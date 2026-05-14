# pev

**Parallel Execution Visualizer for Monad** — by Silk Nodes.

Is your contract killing parallelism? See exactly which storage slots are
contended, and why.

---

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env.local
#    edit .env.local — set DATABASE_URL and MONAD_RPC_URL

# 3. (After Phase 3 is complete) run schema migrations
npm run db:migrate

# 4. Start the dev server
npm run dev
#    → http://localhost:3000
```

## URLs

| URL | What |
|---|---|
| `/` | Landing — masthead, search, latest-block preview, principles |
| `/block/<n>` | Full parallel-execution analysis for a single block |
| `/go?block=<n>` | Search redirect (used by the landing form) |
| `/parallel-preview/` | Static reference — original Variation A design |
| `/parallel-preview/brand-book.html` | Full brand book (8 chapters) |

## Project layout

```
PEV/
├── src/
│   ├── app/
│   │   ├── layout.tsx                Root layout — fonts, metadata, dark editorial body
│   │   ├── globals.css               Brand Book color tokens + editorial primitives
│   │   ├── page.tsx                  Landing
│   │   ├── block/[number]/page.tsx   Block analysis (server component, traces on demand)
│   │   └── go/route.ts               Search redirect
│   ├── components/parallel/          Editorial UI components (Variation A port)
│   │   ├── PEVBrand.tsx              Mark + wordmark + lockup + app icon
│   │   ├── theme.ts                  themeA tokens + palette (Brand Book Ch. 04)
│   │   ├── PEVContext.tsx            Cross-pane selection state
│   │   ├── EditorialView.tsx         Root client component for block pages
│   │   ├── Timeline.tsx              Wave gantt
│   │   ├── ConflictGraph.tsx         SVG DAG of conflict edges
│   │   ├── HotSlots.tsx              Storage contention ranking
│   │   ├── WhyPanel.tsx              Per-tx "why blocked / who blocked" explanation
│   │   ├── SummaryMetrics.tsx        4-metric strip
│   │   └── ModeToggle.tsx            execution/conflict/heatmap (stub)
│   └── lib/
│       ├── parallel-probe.ts         Server-side block tracer (calls Monad RPC)
│       ├── probe-to-pev.ts           Adapter: BlockProbe → editorial UI shape
│       └── db.ts                     Postgres pool + helpers
├── scripts/
│   ├── probe-block.ts                Standalone CLI tracer (npm run probe -- <n>)
│   ├── migrate.ts                    Schema migration runner
│   └── indexer.ts                    Forward-indexer (Phase 3b — coming soon)
├── db/
│   └── migrations/
│       ├── 001_initial.sql           Core schema
│       └── 002_timescale.sql         Optional TimescaleDB hypertables + retention
├── public/
│   ├── pev-icon.svg                  Favicon (4-bar squircle)
│   ├── pev-mark.svg                  Bare 4-bar mark
│   ├── og-pev.png                    Social card (1200×630) — drop yours here
│   └── parallel-preview/             Static reference designs + brand book
└── .env.example                      Documented env var template
```

## Design conventions

**Honest data adaptations** (decisions baked into `src/lib/probe-to-pev.ts`):

1. **Waves, not threads.** We don't know which physical thread Monad's scheduler used.
   We compute *waves* — the minimum sequential rounds needed because of conflicts.
2. **No fake re-execution counts.** Monad's scheduler doesn't expose retry counts via RPC.
   The diagonal-stripe pattern means *"this tx blocked others"* (it was a conflict source),
   not *"this tx was re-executed N times"*.
3. **No ms timing.** RPC doesn't give us per-tx execution duration.
   The wave gantt uses position-based equal-width cells.
4. **Hex everywhere (for now).** Method/contract decoding (4byte + Sourcify) lands in Phase 5+.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Next.js dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Production server (after build) |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:status` | Show applied vs pending migrations |
| `npm run indexer` | Run the forward-indexer (Phase 3b) |
| `npm run indexer:backfill` | Backfill historical blocks (Phase 3b) |
| `npm run probe -- 70191470` | One-off CLI trace of a single block |
| `npm run probe -- --sample 20` | Sample N recent blocks, summary stats |

## Data flow (current)

```
Browser → Next.js page (/block/123)
  → src/lib/parallel-probe.ts
    → Silk Nodes Monad RPC (debug_traceBlockByNumber, prestateTracer + diffMode)
  → src/lib/probe-to-pev.ts (adapter)
  → src/components/parallel/EditorialView.tsx (renders)
```

After Phase 3b lands, the data flow becomes:

```
Indexer (long-running) → Postgres
                          ↑
Browser → Next.js page → reads from Postgres (50ms)
```

## Brand

See `public/parallel-preview/brand-book.html` for the full system —
logo construction, color palette, type rules, app icon, OG card, landing
hero. Open `localhost:3000/parallel-preview/brand-book.html` after `npm run dev`.
