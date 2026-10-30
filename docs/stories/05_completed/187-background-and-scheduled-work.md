# 187 — Background and scheduled work for the site and its bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 063, 171, 222

## Story

As a site with work that does not fit in a request, I want the site's own code
and its server bundles to queue jobs and run them on a schedule, so that
imports, exports and notifications run without a separate service.

## Context

Core has durable queues for webhooks and form workflows, and background jobs of
its own (`packages/server/src/jobs.ts`); a bundle can use none of them. Raised by
a site with a bulk import of records that validates and imports 100,000-row
batches, a nightly member export, and e-mail to moderators. Its legacy version
runs these as a Windows service and a console job on an external scheduler.

Where jobs run is the hosting platform's story (`176`, moved to its board on
2026-10-30); this one lets a bundle have jobs at all. They are compatible: a
bundle's jobs run wherever core's do.

## Decisions (2026-10-30)

1. **The site and its bundles, on one queue and one runner.** Since 189 the
   site's own code has tables, named queries and routes of its own, so a site's
   import, export and moderator e-mails are the site's work.
   - The site lists job modules in `crombolo.config.ts`, as it lists `queries`
     (`jobs: { imports }`); a bundle declares `jobs` on its `ServerBundle`.
   - A job type is named by its owner, `site` or the bundle's id, then its
     name, so two owners cannot clash.
   - A site job's handler is given the site's tables, as a named query is; a
     bundle job's, that bundle's capabilities and `database`.
   - Retries, schedules, the administrators' view and running each occurrence
     on one node are built once, for every owner.
   - Not chosen: bundles only, which would have a site wrap its import in a
     bundle whose tables are not the ones its pages query.
2. **The queue is crombolo's own tables, one for every owner.** A core
   migration adds a job table (the type, owner and name; a JSON payload; state,
   attempts, when to try next, the last error, progress, and timestamps) and a
   table of each schedule's last occurrence, so exactly one node claims it.
   Claimed atomically, retried with back-off and released when a node dies, as
   the form workflow and webhook queues are. One table lets one runner claim
   across owners and gives administrators one screen of every job. A job's own
   data, such as an import's rows, stays in its owner's tables. Not chosen: each
   owner's queue in its own tables, which would have the runner poll every owner
   and claim through a role that cannot see crombolo's tables.
3. **Schedules are cron expressions in a named timezone, with one catch-up.**
   `{ job: 'exportMembers', cron: '0 2 * * *', timezone: 'Europe/London' }`:
   the standard five fields, an IANA zone (UTC when none is named), daylight
   saving followed in that zone. An occurrence missed while the site was down
   runs once on the first node back, however many were missed, then the
   timetable resumes; `missed: 'skip'` drops it instead. A bad expression or
   zone refuses the boot, naming the schedule. Not chosen: a fixed vocabulary
   (`every`, `daily`, `weekly`), which cannot say "weekdays" or "the first of
   the month".
4. **A job sees what its owner's public route sees, plus its owner's granted
   permissions; nothing acts as the site.**
   - A bundle job's context holds the bundle's declared capabilities that do
     not depend on a caller, its own `database`, and the job's own `progress`,
     `enqueue`, `attempt` and `signal`. Its caller is `{ kind: 'job' }`,
     treated like a public caller, so `media` refuses there as on a public
     route.
   - A site job gets the site's tables and `site()` acting as a visitor.
   - Who queued a job is recorded and shown to administrators, and grants
     nothing.
   - Powers a public route lacks, such as writing media for a named member or
     reading every member, come from permissions an administrator grants
     (story 222), checked in a job as in a route.
   - Checked against a migrating site's legacy jobs: an import's data work is
     the site's own tables, which this covers; photographs saved per member
     need `media.forMembers` (222) or site code; a nightly members export
     needs a read of every member, which is 207's.
   - Not chosen: running as the site, which would let a bundle's job do what
     its routes may not; running as whoever queued it, which has no answer for
     a schedule and would put an import's photos under the wrong member.

5. **A payload is at most 64 KB of JSON, refused when it is enqueued.**
   `enqueue` refuses a larger one at once, naming the job and the size, so the
   caller learns while it can still act. Large data stays where its owner keeps
   data and the payload names it: an import's payload is `{ batchId: 42 }`, its
   rows in the site's tables or in file storage (188). A job's progress note and
   its last error are capped at a few KB. Small rows keep the queue quick to
   claim from and cheap to list on both engines. Not chosen: 1 MB, which slows
   every claim and still cannot hold a real batch; no limit, which fails
   obscurely at Postgres's row size.

## Acceptance criteria

- [x] The site lists job modules in its config and a bundle declares `jobs`;
      each enqueues a job by name with a JSON payload from a route, a named
      query or another job. An export that is not a function, or a name used
      twice, refuses the boot.
- [x] A payload over 64 KB is refused when enqueued, naming the job and its size.
- [x] Jobs are kept in crombolo's own tables, claimed atomically, retried with
      back-off and stopped after a limit, kept with their error; an
      administrator sees every owner's jobs, failed and running, and can retry
      one by hand.
- [x] The site and a bundle declare schedules as cron expressions with an IANA
      timezone; exactly one node runs each occurrence, across several api
      nodes; a missed occurrence runs once on the first node back, or is
      skipped with `missed: 'skip'`; a bad expression or zone refuses the boot.
- [x] A bundle's job is given its caller-independent capabilities and its own
      `database`; a capability that acts for a caller refuses, as on a public
      route; a site's job is given the site's tables and `site()` as a visitor.
      Nothing acts as the site, proven by a test that tries.
- [x] Who queued a job is recorded and shown, and grants nothing.
- [x] A stopping node finishes or releases its running job, as core's jobs do;
      the job's `signal` aborts when it is stopping.
- [x] A job's progress can be reported and read by its owner's routes, so a
      screen can show it.
- [x] `docs/bundles.md` and `docs/rendering.md` document jobs for bundles and
      for the site; the migration names the release it ships in.

## What was built

- **The queue** (migration 055, `AddJobs`; `packages/data/src/repositories/jobs.ts`):
  `job` (owner, name, JSON payload, state, attempts, when next, claim and
  heartbeat, progress, last error, who queued it) and `job_schedule` (each
  schedule's last occurrence). A claim is an update that lands only while the
  job is queued; a schedule moves on by compare-and-set on its last occurrence,
  so of the nodes that see it due exactly one queues it. Its `release` is the
  current version until the release that ships it sets its own.
- **Cron** (`packages/server/src/cron.ts`): the five fields with ranges, steps,
  lists and names, either day field matching when both are given, read in an
  IANA zone through `Intl`; the next occurrence walks an hour at a time.
- **The runner** (`packages/server/src/owner-jobs.ts`): `jobProblems` and
  `siteJobProblems` checked at boot; `enqueue` refuses an unknown job and a
  payload past 64 KB; one job at a time per node, retried after 30 s doubling
  to an hour, five attempts, then failed with its error; a 30-second heartbeat,
  and jobs silent for two minutes queued again; `stop` aborts the signal, waits
  ten seconds and releases what is still running without counting the attempt;
  done jobs pruned after a week. A bundle that is off (222) keeps its jobs
  queued and its schedules waiting.
- **What a job is given:** a bundle's job, `jobContext` from
  `createServerBundles`, built for the caller `{ kind: 'job' }`, so capabilities
  that act for a caller treat it as the public; a site's job, the site's tables
  and `site()` as a visitor. Who queued it is recorded from the caller.
- **Queueing:** `site().jobs` (`enqueue`, `status`) and, on a bundle that
  declares jobs, `context.bundle.jobs`; `job.enqueue` inside a job.
- **Settings → Background jobs** (`jobs-dashboard.js`, `…/api/jobs` and
  `…/api/jobs/<id>/retry`, Settings section, the retry audited).
- **Tests:** `tests/background-jobs.test.ts`, on both engines: cron and zones,
  declarations, running with payload, context and progress, refusals, retries
  and the limit and a retry by hand, two nodes claiming at once, stopping, a
  bundle that is off, schedules claimed once across two nodes and a missed
  occurrence run once or skipped, and a running site whose bundle job and site
  job are given what a public route and a visitor get, with crombolo's own
  tables out of reach.
