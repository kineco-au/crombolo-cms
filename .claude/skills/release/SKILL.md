---
name: release
description: Cut a crombolo release, push main, tag once main's CI passes (SQLite and Postgres both), and watch the Release pipeline until it publishes, bumping the patch version and re-releasing each time a fix is needed. Use when asked to cut, ship or publish a release, or to get a failing release pipeline green.
---

# Releasing crombolo

**"Cut a new release" means the whole job, not just the tag.** Push it, then
watch two things, fixing and re-releasing as below, until both are green and
the packages are on npm: CI on `main`, which runs the unit suite on SQLite and
Postgres (story 085), and the Release pipeline the tag starts. Stop to ask only when a blocker needs
the maintainer's input: a credential, a decision, or a failure with no safe fix.

Pushing a `v*` tag publishes to npm (`.github/workflows/release.yml`). A tag is
a release, not a bookmark: never move, delete or re-push a tag that has been
pushed. A failed release is fixed by a **new** patch version.

## Before starting

1. **Only release finished work.** Run `git status`. Unfinished work in the tree
   (a story still in `docs/stories/04_in_progress/`, or half-built changes) is
   stashed first with `git stash push -u -m "wip before release <version>"` and
   restored after the release with `git stash pop`. Say what was stashed.
2. **Know the starting version:** `git tag --sort=-creatordate | head -3` and
   `grep -n "VERSION = " packages/server/src/config.ts`. The next release is the
   version asked for, or the latest tag's patch + 1.
3. **Migrations:** any migration added since the last tag names this release in
   its `release` field (`AGENTS.md`, "Versioning"). Check with
   `git diff <last-tag> --stat -- packages/data/src/schema`.

## Cut it

1. Check locally first, through docker:
   - `bun run check`
   - `docker compose run --rm cms-test-sqlite bun run test`
   - the integration suite when the CLI changed or a migration was added:
     `docker compose run --rm cms-test-sqlite bun run test:integration`
   - the browser tests a change touches, or a failing one, alone:
     `docker compose run --rm cms-test-browser bun run test:browser <file>`

   The integration suite on Postgres as well, when a migration was added or the
   data layer changed: `bun run docker:test:integration:postgres`. CI runs the full
   Postgres suite and the full browser suite. Change nothing in the tree while a
   suite runs: docker reads it live, and an edit mid-run fails tests that
   pass alone.
2. **Release notes.** In `docs/release-notes.md`, rename `## Unreleased` to
   `## v<version> — <date>` and add a fresh empty `## Unreleased` above it.
   Check the section against `git log <last-tag>..HEAD` and the stories moved
   to `05_completed` since the last tag. Give each change a user-facing bullet
   with its story number, list the migrations, and add the upgrade notes an
   operator must act on. A patch release that only fixes a failed release adds
   a short section of its own.
3. `bun run release:version <version>`, then `bun install` so `bun.lock` agrees.
4. Commit everything the bump touched with the fix, release notes included,
   with the browser switch in the message:
   `git commit -am "<what changed>; bump version->v<version> --browser-tests"`.
   CI on `main` runs the browser suite only when the **last** commit's message
   says so. Postgres runs in CI on every push to `main`.
5. **Push `main` alone first:** `git push --no-verify origin main` (the code
   was tested in step 1). Watch its CI, as below, and fix anything it finds with
   a new commit.
6. **Only once it has passed,** `git tag v<version>` and
   `git push --no-verify origin v<version>`. The Release pipeline does not run CI again: it
   runs the load test and benchmarks, then publishes. A failure there costs a
   version number, which this step is there to save. **Only when the maintainer asks**
   to skip the load test, the tagged commit's message carries `--skip-load-tests`, and
   the Release workflow publishes without it.

## Watch it

**CI** starts from the push of `main`, and **Release** from the push of the tag,
which runs the load test and benchmarks, then publishes. Check progress once a
minute, not continuously.

```bash
gh run list --limit 4 --json databaseId,workflowName,headSha,status,conclusion
gh run watch <run-id> --exit-status        # one per workflow; run in the background
gh run view <run-id> --log-failed | grep -E "\(fail\)|✘|Expected|Received|##\[error\]"
```

A browser failure leaves `browser-report` as an artifact. Each failure's
`error-context.md` holds the page snapshot:
`gh run download <run-id> -n browser-report`.

## When something fails

1. Read the failure. A test can be stale rather than the code wrong, so check
   what changed since the last green release before choosing which to fix. A
   test that fails in a full run but passes alone, timing out under load, is
   rerun alone before anything is changed.
2. **Before the tag** (CI on `main`): fix it with a new commit, verify it
   locally (a Postgres failure with `bun run docker:test:postgres <file>`), and
   push `main` again with `--browser-tests`. The version is not spent, so it does not change.
3. **After the tag** (the Release pipeline): bump the **patch** version (0.14.1
   → 0.14.2), add its section to `docs/release-notes.md` (the fix, in a line),
   and cut it again as in "Cut it". Never reuse a pushed tag. If publish failed
   part-way, rerun its job only once npm's index shows what it already
   published.
4. Watch again. Repeat until both are green.

## Finish

- `gh run list --limit 4` shows CI `success` for the tagged commit and Release
  `success` for the tag, and `npm view @crombolo/<pkg> version` shows the
  version for server, cli, core, crombolo, transfer, data and backoffice-dist.
- `git stash pop` if anything was stashed. Then check
  `git diff --stat`, and resolve any version-line conflicts in favour of the
  released version.
- Report:
  - the version released;
  - each failure, and the fix that cleared it;
  - the runs that went green;
  - anything stashed and restored.
