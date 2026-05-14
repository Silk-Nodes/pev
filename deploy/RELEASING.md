# Releasing pev

How to cut a new release of pev. The goal is repeatability: anyone with
deploy access should be able to ship a clean release without remembering
tribal knowledge.

## When to release

Cut a release when something user-visible changes and you want it to be
discoverable in the GitHub Releases feed (which people subscribe to).

You do NOT need a release for every `git push`. The
[CHANGELOG.md `[Unreleased]` section](../CHANGELOG.md) accumulates
changes; cut a release when there's a coherent batch worth announcing.

A reasonable cadence for early pev:

- **Patch** (`0.1.0` to `0.1.1`): bug fixes, accessibility, performance
  polish. Ship as often as you want.
- **Minor** (`0.1.0` to `0.2.0`): new pages, new metrics, new API
  endpoints. Roughly every few weeks once features stabilize.
- **Major** (`0.x.y` to `1.0.0`): when you're confident the public
  URLs, the JSON API shape, and the parallelism-score methodology are
  stable enough that consumers can build on them.

## What versioning means for pev

pev's public contract is broader than a typical library. We bump
**MAJOR** when any of the following changes in a backwards-incompatible
way:

- Public URL paths (`/contract/<addr>`, `/block/<n>`, `/tx/<hash>`,
  `/api/v1/*`). Renames, removals, or shape changes count.
- JSON API response shapes under `/api/v1/*`.
- The parallelism-score methodology (anything that would change the
  score for the same block on the same data).

Everything else (new pages, new metrics, new sections, restyles) is a
**MINOR**. Bug fixes and polish are **PATCH**.

## The release flow

Six steps. Plan on ~10 minutes the first few times, faster once it's
muscle memory.

### 1. Make sure `main` is clean and pushed

```bash
cd /path/to/pev
git checkout main
git pull --ff-only origin main
git status                       # must be empty
```

If you have uncommitted work, either commit or stash it. `deploy.sh`
will refuse to deploy a dirty tree (by design), so the release flow
inherits the same hygiene.

### 2. Move `[Unreleased]` entries into a dated section

Open `CHANGELOG.md`. Find the `## [Unreleased]` heading. Rename it to
the new version with today's date, ISO format:

```markdown
## [0.2.0] - 2026-06-03
```

Then put a fresh empty `## [Unreleased]` block back at the top so the
next person has somewhere to land their notes:

```markdown
## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-06-03
...your moved entries...
```

Also update the compare links at the bottom of the file:

```markdown
[Unreleased]: https://github.com/Silk-Nodes/pev/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Silk-Nodes/pev/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Silk-Nodes/pev/releases/tag/v0.1.0
```

### 3. Bump `package.json` to match

```bash
# Edit "version" in package.json to the new version (e.g. "0.2.0").
# Or use npm:
npm version 0.2.0 --no-git-tag-version
```

`--no-git-tag-version` is important: we tag manually in step 5 so we
can write a good annotated message.

### 4. Commit the version bump

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "Release v0.2.0"
git push origin main
```

Keep this commit message terse. The release-notes detail lives in
`CHANGELOG.md` and on the GitHub Release page, not in the commit log.

### 5. Tag and push

Use an annotated tag (`-a`), not a lightweight tag. Annotated tags
carry their own message and show up in `git log`. The tag message
should mirror the changelog entry's headline:

```bash
git tag -a v0.2.0 -m "v0.2.0: <one-line summary of the headline change>"
git push origin v0.2.0
```

### 6. Create the GitHub Release

The cleanest way is via `gh` CLI with `--notes-file` pointing at the
relevant CHANGELOG section. Two approaches:

**Approach A (manual notes file, most reliable):**

Copy the section you just wrote in `CHANGELOG.md` into a temp file,
then:

```bash
gh release create v0.2.0 \
  --title "v0.2.0, <short headline>" \
  --notes-file /tmp/pev-v0.2.0-notes.md
rm /tmp/pev-v0.2.0-notes.md
```

**Approach B (web UI, easier preview):**

Open <https://github.com/Silk-Nodes/pev/releases/new>, pick the
`v0.2.0` tag from the dropdown, paste the changelog section into the
description box, hit Publish. The web UI shows a Markdown preview which
catches formatting mistakes that the CLI doesn't.

Either way, the title format is `vX.Y.Z, <short headline>` (matches
how `v0.1.0` was published).

### 7. (Optional) Deploy

If the release contains code changes that aren't on the VM yet:

```bash
PEV_HOST=user@host ./deploy/deploy.sh
```

`deploy.sh`'s built-in git check ensures you can't deploy something
that doesn't match what's on GitHub.

## Hotfixes

If production is broken and you need to ship a fix faster than the
normal flow:

1. Fix on `main`, commit, push.
2. Deploy immediately with `./deploy/deploy.sh`.
3. **Then** cut a patch release (`0.1.0` to `0.1.1`) with the fix as
   the only entry. Don't skip this step: the release is what makes the
   fix discoverable to anyone running their own copy.

The release can happen after the fact. The deploy doesn't need to wait
for the release tag.

## What NOT to do

- Don't tag `main` directly with `git tag v0.2.0` (no annotation). Use
  `git tag -a` so the tag carries its own message and is greppable in
  `git log`.
- Don't release without updating `CHANGELOG.md`. The changelog IS the
  release announcement; the GitHub Release page just mirrors it.
- Don't bump `package.json` and not tag, or tag and not bump
  `package.json`. They have to move together.
- Don't include the placeholder text from this doc in an actual
  release body. (Yes, that happened once.)
- Don't make the GitHub Release the only place a change is documented.
  Anyone reading `CHANGELOG.md` should learn the same thing as someone
  reading the Release page.

## Where the bodies are buried

- `CHANGELOG.md` (repo root): the canonical record. Update on every
  release.
- `package.json` `version` field: must match the latest released tag.
- Git tag `vX.Y.Z`: created by step 5, pushed to `origin`.
- GitHub Release at `/releases/tag/vX.Y.Z`: created by step 6, mirrors
  the changelog entry.
- `deploy/deploy.sh`: ships the code. Doesn't know or care about
  version numbers; the release flow lives upstream of it.
