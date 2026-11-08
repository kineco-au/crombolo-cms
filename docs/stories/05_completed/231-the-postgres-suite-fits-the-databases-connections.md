# 231 — The local Postgres suite fits the database's connections

**Epic:** R — Architecture and reliability · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As a developer running the Postgres suite in Docker, I want it to pass when the
code is right, so that a red run means a fault rather than a crowded database.

## Context

Found 2026-10-31. `bun run test` runs up to six shards at once against one
Postgres server with 100 connections. Each test site opens a pool, its LISTEN
connection and, for jobs, more; runs reached 72 connections between samples and
failed with "sorry, too many clients already" in waves, and slow tests (the
custom tables' second database) time out at 5 s. Alone, every affected file
passes. CI is unaffected: each shard has its own server.

## Acceptance criteria

- [x] The Postgres suite, run as `docker compose run --rm cms-test bun run
      test`, passes three times running on a developer machine.
- [x] Either the shard count follows the connections the server allows, or
      each test site's pool is small enough, or the compose service raises
      `max_connections`: whichever is chosen is written in `docs/testing.md`.
- [x] The custom tables' "two databases on one server" test passes under the
      full parallel run.

## What was built (2026-11-08)

- **The compose `db` allows 400 connections** (`command: postgres -c max_connections=400`), the
  third of the ways the story offered. It keeps the sites' pools as production has them and the
  shard count as it is. `docs/testing.md` says so.
- **Four shards locally, not six, for Postgres** (`scripts/test-parallel.ts`): six on one server
  kept it busy enough that a different timing-based test failed in each run.
- **What stood in the way besides connections,** each fixed: a test's database closed without its
  server, whose jobs then deadlocked the next file's reset (the harness now closes the server too,
  and the reset retries a deadlock Postgres cancels it over); the end-of-run database drop outlasting
  its hook; and a node's registration racing between boot and poll (now one statement).
- **Three full Postgres runs passed in a row** on 2026-11-08: 3,947 tests each, none failing.
