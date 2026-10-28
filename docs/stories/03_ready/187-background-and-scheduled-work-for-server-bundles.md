# 187 — Background and scheduled work for server bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 063, 171

## Story

As a site with work that does not fit in a request, I want a server bundle to
queue jobs and run them on a schedule, so that imports, exports and notifications
run without a separate service.

## Context

Core has durable queues for webhooks and form workflows, and background jobs of
its own (`packages/server/src/jobs.ts`); a bundle can use none of them. Raised by
Nature's Calendar (`wt-natures-calendar` story 013): a bulk import of observations
that validates and imports 100,000-row batches, a nightly member export, and
e-mail to moderators. Its legacy site runs these as a Windows service and a
console job on an external scheduler.

Story `176` (background jobs run independently) moves where jobs run; this one
lets a bundle have jobs at all. They are compatible: a bundle's jobs run wherever
core's do.

## Decisions before implementation

- **One queue or a bundle's own.** Reuse the job machinery with the bundle's id in
  the job type, or a table per bundle under `062`'s rules.
- **Schedules.** Cron expressions or a fixed vocabulary; the timezone; what a
  missed occurrence does after downtime.
- **Payload limits** and what a job handler's capabilities are (the bundle's own,
  with no request principal; or an explicit "system" principal).

## Acceptance criteria

- [ ] A bundle declares job types and enqueues one with a JSON payload from a
      route or another job.
- [ ] Jobs retry with back-off and stop after a limit, kept and visible to
      administrators with their error; one can be retried by hand.
- [ ] A bundle declares schedules; exactly one node runs each occurrence, across
      several api nodes.
- [ ] A stopping node finishes or releases its running job, as core's jobs do.
- [ ] A job's progress can be reported and read by the bundle's routes, so a
      screen can show it.
