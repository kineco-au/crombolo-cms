# 359 — Background jobs from the command line

**Epic:** P — The command line · **Priority:** could · **Size:** S
**Depends on:** 349, 352

## Story

As an operator, I want to see the site's background jobs and run a failed one
again from the CLI, so that a stuck import or a failed job is found and retried
without the back office.

## Context

Story 349, G12. Settings → Background jobs (story 187) lists the site's and its
bundles' jobs, how far each got, why one failed, and runs a failed one again.
`bundle runs` and `site runs` cover bundle applies only.

Each command here takes `--profile` (story 352) to act on another site, through the remote protocol, as the person signed in to it. A hosted site needs a new capability for these routes, checked by `packages/remote-conformance`. A CI identity is refused, since these act for a person (story 349, D2).

## What is there to build on

- **The queue** is `JobRepository` (`packages/data/src/repositories/jobs.ts`), one
  table, `job`, for every owner (migration 055):
  - `list({ owner, state, skip, take })` gives the newest first and a total;
  - `get(id)` gives one job;
  - `retry(id)` puts a failed job back in the queue from its first attempt, and
    changes nothing for a job in any other state, so the "failed only" rule is the
    repository's.

  A job has its owner (`site` or a bundle's id), name, state, attempts of how many,
  when it is next tried, its progress (`done`, `total`, `note`), its last error,
  who queued it, and when it was made and finished. Its payload is the owner's
  and is not shown by the dashboard, so it isn't shown here either.
- **The dashboard's routes** are inline in `server.ts`, under
  `<plugin>/api/jobs`: `GET` lists, `POST {id}/retry` retries.
  - Both need the Settings section, nothing more.
  - The retry writes its own audit entry (`category: 'system'`, `action: 'Retry'`,
    `entityType: 'Job'`, named `owner/name`, the error it failed with in `detail`).
  - The list also says when nothing is running the jobs (`core.workerWatch`,
    story 223). Only a running node knows that, so the CLI on the site's own
    database can't say it.
  - The screen is `backoffice-host/plugin/jobs-dashboard.js`. Its state words are
    Waiting, Running, Failed and Done, and the site's own jobs are "The site".
- **A retried job runs within five seconds.** Each node running jobs polls the
  queue every five seconds (`owner-jobs.ts`), so a retry from the CLI against the
  site's database needs no wake. A site that isn't running runs it when it starts.
- **The remote protocol already has `jobs/{id}`** (`packages/server/src/remote.ts`).
  These are a push's or pull's transfer jobs (`RemoteJobRepository`), not
  background jobs. The new routes are named `background-jobs` so the two are never
  confused.
- **The pattern to follow** is `site runs` (`packages/cli/src/commands/site/runs.ts`):
  `hostedOrHere`, then `connectSite` and an `environments/{id}/…` route, or the
  site's own database; `pageFlags` and `page()` for `--limit`, `--offset` and
  `--fields`.

## Decisions

None. The dashboard settles each rule. Who may see and retry is the Settings
section. Retrying is for a failed job only, as the repository enforces. The audit
entry is the dashboard's.

## Plan

1. **A shared core**, `packages/server/src/background-jobs.ts`, used by the
   dashboard's route, the CLI locally and the remote routes:
   - `listJobs(db, { owner, state, skip, take })` and `jobOf(db, id)`, in the shape
     the dashboard's route answers today;
   - `retryJob(db, id, by: { key?, name, source, address? })`: refuses anything but a
     failed job ("Only a job that has failed can be run again."), retries it, and
     writes the audit entry the dashboard writes now;
   - the dashboard's route in `server.ts` is moved onto these. Its answers and
     audit entry stay the same.
2. **Naming a job.** Ids are uuids, so `jobs list` prints the first eight
   characters. `jobs show` and `jobs retry` take the whole id or a prefix of at least
   eight that names one job. A prefix naming two is refused, listing both.
   `JobRepository` gains `byPrefix(prefix)` (a `LIKE` on `id`, no schema change).
3. **Commands**, each with `access: 'site'` and `section: 'settings'`, and
   `...profileFlags`:
   - `jobs list [--state waiting|running|failed|done] [--owner <bundle|site>]`, with
     `pageFlags(50)`:
     - one line each: short id, when queued, owner, name, state, and attempts or
       progress;
     - "No background jobs." or "No failed jobs." when empty, then the "… n more:
       --offset" line `site runs` prints;
     - on a hosted site, the dashboard's warning when nothing is running the jobs.
   - `jobs show <id>`: owner, name, state, who queued it and when, attempts of how
     many, when it is next tried, progress with its note, when it finished, and the
     whole error;
   - `jobs retry <id>`, through `retryJob` as `commandActor()`'s person (`signedIn()`,
     or the command line), `source: 'cli'`. It says "<name> is queued to run again".
     The core writes the audit entry, so the command declares no `static audit`,
     which would write a second one. A job that isn't failed is refused, saying
     its state.
   - The state words are the dashboard's. `-o json` gives the stored state
     (`queued`, `running`, `succeeded`, `failed`), full ids and ISO dates.
4. **Remote routes**, under `environments/{id}/`:
   - `GET background-jobs?state&owner&skip&take`, with `waitingSince` as the
     dashboard's route gives it;
   - `GET background-jobs/{id}`, where `{id}` may be a prefix as above;
   - `POST background-jobs/{id}/retry`.

   They check the Settings section as `content/query` checks Content. They refuse a CI
   identity with "Background jobs need a person", 403 `ci-cannot-manage-jobs`. The
   retry is audited as the signed-in person, with their address. Discovery lists
   `background-jobs`. `packages/remote-conformance` checks that the list answers a
   page and that retrying a job that isn't failed is refused, when the capability is
   listed and `may` allows it. `environments` gains `may.backgroundJobs`, the
   Settings section.
5. **`--profile`** through `hostedOrHere` and `connectSite` (story 352). A hosted
   site whose discovery lacks `background-jobs` is refused with "This site needs a
   newer crombolo to show its background jobs".
6. **Docs.**
   - `docs/operations.md`: background jobs from the command line, beside the
     dashboard's section;
   - `docs/remote-protocol.md`: the three routes and the capability;
   - `bun run cli:spec`, for the CLI reference;
   - the release notes under Unreleased.
7. **Tests.**
   - `tests/background-jobs.test.ts` gains the core:
     - the list newest first, by state and owner, paged;
     - a prefix found, too short or naming two;
     - a retry of a failed job queued from its first attempt, with its audit entry;
     - a retry of a queued, running or done job refused, and nothing written.
   - `tests/jobs-cli.test.ts`, for the commands, locally and against a test server
     with `--profile`:
     - list, show and retry;
     - `--state failed`, `--owner`;
     - `-o json` and `--fields`;
     - at `sign-in`, a person without Settings refused;
     - a CI identity refused on each route;
     - a site without the capability refused with the upgrade message.
   - `tests/remote-conformance.test.ts` runs the new checks.
   - SQLite only: no table or column changes, only a read added to
     `JobRepository`. No browser tests: the dashboard's screen is unchanged, and
     its route keeps the same answers, which the core's tests cover.

## Acceptance criteria

- [ ] `crombolo jobs list [--state <state>] [--owner <bundle>]`, newest first, a page
      at a time
- [ ] `jobs show <id>`: what it is, its progress, and why it failed
- [ ] `jobs retry <id>`, for a failed job only, as the dashboard's button does
- [ ] Each takes `--profile`; `-o json`; a retry audited
- [ ] Tests for each, locally and through a test server
- [ ] The CLI reference regenerated
