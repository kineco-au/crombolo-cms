# 085 — A full Postgres parity run

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** —

## Story

As someone running a site on Postgres, I want every behaviour proven on Postgres
as well as SQLite, so that choosing the production database never costs me a
feature.

## Context

Each work package has been required to be green on both dialects. Phase 7's exit
asks for more than that: the whole conformance suite green against both
dialects in one run.

## Decisions (2026-11-26, the maintainer's)

1. **CI runs Postgres on every push to main,** in shards beside SQLite's. `--postgres-tests`
   and the local Postgres run beside a release are no longer needed, and the release skill
   and AGENTS.md say so.
2. **The integration suite and the remote conformance package run on Postgres too,** in CI
   on main. The browser suite stays on SQLite, a listed exception: it proves the screens,
   which reach the database only through the API both dialects' unit suites prove.
3. **Each dialect skip is on a reviewed list** in `docs/testing.md`, with why it cannot run on
   the other database, and a test fails on a skip that is not listed or one listed that is
   gone. Each is checked first: one that can run on both is made to.

## Findings (2026-11-26)

- CI's matrix adds Postgres shards only for `--postgres-tests` (`.github/workflows/ci.yml`);
  the integration job and the browser job run SQLite alone.
- 13 test files skip on a dialect (`skipIf(dialectUnderTest …)`), among them
  `cache-notify`, `concurrency`, `worker`, `maintenance`, `server-roles`, `status`,
  `upgrade`, `webhooks`, `table-types`, `schema-boot`, `forms-bundle-types`,
  `content-checkpoint`, `harness-isolation`.
- `packages/remote-conformance` runs against an endpoint; nothing in CI starts a Postgres
  site for it.

## Acceptance criteria

- [x] Every push to main runs the unit suite on SQLite and Postgres, and the integration
      suite and remote conformance on both; all green.
- [x] The browser suite's SQLite-only run is listed with its reason.
- [x] Every dialect skip is listed in `docs/testing.md` with its reason, and a test holds the
      list to the code. Any that could run on both does.
- [x] The release skill and AGENTS.md drop `--postgres-tests` and the local Postgres run.

## What was built

- **Decision 2's scope, chosen 2026-11-26:** the integration files where the database
  matters run on both (first-boot, upgrade, server-roles, restart, workspaces,
  change-transfer); the rest drive the command line's output and files.
- `.github/workflows/ci.yml`: the Postgres shards on every push to `main` (a pull request
  runs SQLite alone), `postgres_tests` and `--postgres-tests` gone, and an
  `integration-postgres` job.
- `tests/integration/support/database.ts`: a database of its own per site on Postgres
  (`CREATE DATABASE`, a copy by `TEMPLATE` for a second copy of a site, dropped after);
  `bun run test:integration:postgres` and `docker:test:integration:postgres`. A Postgres
  production start that migrates runs the operator's backup command, so the tests give one.
- Run on both now: `migrations.test.ts` (production refuses pending steps),
  `dashboard.test.ts` (a schema change needing data work), `custom-tables.test.ts` (a
  bundle's pending steps); `harness-isolation.test.ts`'s Postgres-only check is no longer
  an early return.
- `tests/support/dialect-skips.ts` and `tests/dialect-skips.test.ts` hold the list in
  `docs/testing.md`, "One database only" (19 rows), to the code, and refuse an early
  return that hides a skip.
- AGENTS.md "Releasing", the release skill and `docs/testing.md`: no local Postgres run
  beside a release; CI's own.
- Conformance (`tests/remote-conformance.test.ts`) is in the unit suite, so on both.
