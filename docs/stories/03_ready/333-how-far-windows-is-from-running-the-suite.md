# 333 — How far Windows is from running the suite

**Epic:** E — Cross-cutting · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As a developer on Windows, I want to know what stops the bun scripts and the test
suite running on my machine, so that the work to make them run can be sized and
planned rather than guessed at.

## Context

The project's scripts and tests run on macOS and Linux, and locally through the
Docker containers (`AGENTS.md`, "Testing"). CI runs four test files on
`windows-latest` (the `extensions` job in `.github/workflows/ci.yml`):
`extension-isolation`, `extension-discovery`, `simple-redirects` and
`entra-bundle`. Those pass, so starting Deno, the stdio channel and discovery
work on Windows. The other 306 test files have never run there.

What is known so far, from reading the code (2026-11-11):

- **Line endings.** The repo has no `.gitattributes`. Git for Windows checks out
  with CRLF by default, which breaks `docker/cms-entrypoint.sh` in the container
  and any test that hashes or snapshots a checked-in file. This affects the Docker
  route as much as a native one.
- **Package scripts.** Bun runs them through its own shell, which takes
  `VAR=x cmd`, `&&` and globs on Windows, so `package.json` is probably fine as
  it is.
- **Likely trouble natively:**
  - 84 places in `packages/*/src` split a string on `/`, some of them file paths
    rather than URLs or keys;
  - `bundle-code.ts` makes a directory symlink, which Windows allows only with
    Developer Mode or as an administrator (a junction would not need either);
  - `chmod` in two places and shell spawns in two;
  - six test files use shell scripts, symlinks or `chmod`;
  - Windows will not delete or rename a file that is still open, which tests that
    clean up temporary sites may hit.
- **Already careful:** `sep` is used in 62 places.

## Proposed

A **one-off measurement, not a fix**: run the whole SQLite suite on Windows once
and record what fails.

- A workflow that only runs when started by hand (`workflow_dispatch`), so it
  blocks nothing and spends nothing until asked for, separate from `ci.yml`:
  `.github/workflows/windows-survey.yml`.
  - `windows-latest`, `BUN_VERSION` as CI pins it, `bun install --frozen-lockfile`,
    `bun run generate:types`, the vendored back office as CI builds it for the
    tests that need it.
  - `bun run test:sqlite`, not stopping at the first failure, with the full output
    kept as an artifact.
  - A second step, run whatever the first did: `bun run check`, to see whether the
    format, lint and type checks run on Windows.
- A one-time `.gitattributes` with `* text=auto eol=lf`, since without it a
  Windows checkout does not match what the tests expect, and the measurement would
  mostly count line endings.
- The results written into this story: each failing test file, grouped by cause
  (paths, symlinks, file locking, shell, line endings, other), with a count per
  cause and an estimate of each fix.
- The outcome: one or more follow-up stories, sized from the results. One for
  the Docker route on Windows (setup steps in the README) and, if the numbers
  justify it, one for native Windows.

Not in scope: fixing any of the failures, running the Postgres, browser or
integration suites on Windows, or adding Windows to the CI that gates a release.

## Acceptance criteria

- [ ] `.gitattributes` makes every checkout use LF line endings.
- [ ] A manually started workflow runs the SQLite suite and `bun run check` on
      `windows-latest`, never on a push, and keeps the full output.
- [ ] It has been run once against `main`, and its run is linked here.
- [ ] This story lists every failing test file by cause, with a count and an
      estimate per cause.
- [ ] Follow-up stories exist for the work the results call for, sized from them.
