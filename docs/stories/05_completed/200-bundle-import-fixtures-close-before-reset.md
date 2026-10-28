# 200 — Bundle import fixtures close before reset

**Epic:** I — Hardening · **Priority:** must · **Size:** S
**Depends on:** —

## Story

As a maintainer, I want the bundle import tests to finish the source site's
background work before starting the target, so that a database reset cannot
deadlock with the source's pending notifications.

## Context

Release run `40676481837`, job `122776276780` (`postgres 4/4`), failed in
`--publish publishes what was live at the source, parents first`. Its Postgres
log identifies a deadlock between the target's `TRUNCATE` and a source
notification query joining `node`, `content` and `content_type`.

The import fixtures retain the exported bundle in memory and reuse the run's
Postgres database for the target. Keeping the source server alive until
`afterEach` lets its dispatcher and jobs overlap the target's reset.

## Acceptance criteria

- [x] Starting the next import fixture awaits the previous server's full close,
      including its jobs and event dispatcher, before resetting the database.
- [x] Existing import assertions still cover published parents and children,
      drafts, media, transactions and repeat imports.
- [x] Formatting, lint, types and Docker unit suites pass on both dialects.

## Implementation

`tests/content-import.test.ts` closes and removes each tracked harness before
booting the next fixture. `h.db.close()` delegates to the server's full shutdown,
which awaits jobs and nudged event dispatches before closing the connection.
The exported bundle remains in memory for the target; the source no longer
queries the database while the target resets it. The same lifecycle applies
on SQLite, and `afterEach` still closes the final fixture and removes all
temporary directories. `docs/testing.md` records this requirement.

The existing tests continue to exercise import behaviour without changing
timeouts, disabling dispatch or retrying a deadlocked reset.

## Validation (2026-10-28)

- `bun run check` and `bun run typecheck` in `cms-test-sqlite`: formatting,
  lint and types passed.
- `bun run docker:test:sqlite`: 3,029 passed, 8 skipped, zero failures.
- `bun run docker:test:postgres`: 3,027 passed, 12 skipped, zero failures.
- `bun run test:ci --timeout 20000 tests/content-import.test.ts` in `cms-test`,
  repeated in ten fresh processes: 130 passed, zero failures. Each process gets
  its own database, which the test preload removes when that process's tests
  finish.
