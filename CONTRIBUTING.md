# Contributing to pev

Thanks for considering a contribution. pev is intentionally small and opinionated, but bug fixes, performance improvements, and well-scoped features are welcome.

---

## Before you start

For **anything beyond a small bug fix**, open a feedback request first:

→ https://pev.silknodes.io/feedback

Or a GitHub issue if you'd rather discuss code-level details. We'd rather agree on direction before you spend time on the implementation than ask you to rewrite something already shipped.

For small fixes (typos, broken links, obvious bugs), just open a PR.

---

## Workflow

```bash
# 1. Fork + clone
git clone https://github.com/Silk-Nodes/pev.git
cd pev

# 2. Install deps + set up env
npm install
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and MONAD_RPC_URL

# 3. Run migrations against a local Postgres
npm run db:migrate

# 4. Start dev server + indexer in separate terminals
npm run dev
npm run indexer

# 5. Make your changes on a branch
git checkout -b your-feature

# 6. Verify locally
npx tsc --noEmit
# Open http://localhost:3000 and exercise the change manually

# 7. Open a PR with a clear description
```

---

## Code style

- **TypeScript strict mode**. Prefer explicit types over `any`. PRs that introduce `any` should explain why.
- **No em-dashes** anywhere in code, comments, or docs. Use commas, periods, or colons instead. Same for en-dashes. (This is a hard rule in the codebase.)
- **Server Components by default**, Client Components only when interactivity requires it (`"use client"` at the top of the file).
- **Inline styles** match the rest of the codebase. CSS lives in `globals.css` for truly global rules only.
- **Brand voice** in user-facing copy: editorial, direct, no marketing prose. See `/docs` for examples.

---

## Commit messages

Follow conventional-ish style:

```
feat(contract): add window selector for time-range queries
fix(og): bound generation time to 3s for popular contracts
docs(readme): clarify Postgres version requirement
perf(indexer): parallel-fetch prestate diffs across queries
```

Not strictly enforced, but it helps reviewers parse the change set quickly.

---

## What we look for in PRs

1. **One thing per PR.** A bug fix + a refactor + a new feature in one PR is hard to review. Split them.
2. **Honest comments.** If the code does something subtle, explain why. Future readers (including future you) need the reasoning, not a restatement of what the code already says.
3. **No new dependencies without justification.** pev is intentionally lean. If you're adding a package, mention why in the PR description.
4. **Backwards-compatible by default.** If your change breaks the public `/api/v1/` surface, raise it explicitly so we can plan a version bump.
5. **Type-check passes** (`npx tsc --noEmit`). Lint passes (`npm run lint` if configured). Manual test happened.

---

## Reporting bugs

Open an issue with:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Environment (Node version, OS, browser if relevant)
5. Any error messages or stack traces

Bonus points for a minimal reproduction.

If the bug touches data accuracy (e.g. "the parallelism score for block X looks wrong"), link to the specific URL on pev.silknodes.io so we can see the same data you're seeing.

---

## Security

If you find a security issue, **please do not open a public GitHub issue.** Email info@silknodes.io with details. We'll respond within 48 hours.

What counts as a security issue:
- Anything that exposes user PII (we collect almost none, so the bar is high)
- Anything that lets an attacker take down the indexer or web service
- Anything that lets someone fabricate data showing on pev.silknodes.io
- Anything that exposes internal infrastructure details

Performance bugs, ugly UI, and feature gaps are not security issues; file those normally.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

Thanks again. Looking forward to your PR.
