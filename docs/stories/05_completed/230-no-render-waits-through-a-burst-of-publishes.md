# 230 — No render waits seconds through a burst of publishes

**Epic:** R — Architecture and reliability · **Priority:** could · **Size:** M
**Depends on:** 175

## Story

As a visitor arriving while editors publish in bulk, I want my page as fast as
at any other time, so that a busy publishing hour is invisible on the site.

## Context

Found 2026-10-31 in story 175's benchmark. Renders during a burst of 1,000
publishes are fast at p95 (1–5 ms), but the slowest single render took 10–37 s
on a 25,000-page site, in CI and locally, before and after the shared rebuild
of 0.39.1; 22 ms in one CI run after it. A render that reads while a rebuild is
being queued can wait behind it (`snapshot()`'s follow-up path), and SQLite's
synchronous reads hold the thread between pauses.

## Decisions (2026-10-31)

1. **A visitor never waits for a rebuild once a previous snapshot exists,
   beyond a short grace.** A reader that would wait for a build, its own or the
   one queued behind a running one, waits at most a grace (50 ms to start), then
   is answered from the previous snapshot. Before the first build there is none,
   and readers still share that build. Writes keep waiting with `fresh()`, so
   the editor who made a change sees it; the tests that change content without
   a request and read straight after it wait with `fresh()` themselves. Not
   chosen: no grace at all, which shows a visitor the old version even when the
   new one is moments away; measuring before choosing, which leaves the wait in
   place meanwhile.

2. **The slowest render has a ceiling of one second, at every size,** failing
   a release past twice that as the other budgets do; it is recorded beside
   the p95 for renders through sustained publishing and through a burst. Not
   chosen: a p99 alone, which a few multi-second waits pass; both, two chances
   for a noisy runner to fail a release.

## Plan

1. **The grace** (`packages/render/src/published-cache.ts`): wherever
   `snapshot()` would make a reader wait for a build while a previous snapshot
   exists (starting one, or queuing the one behind a running one), it races
   that build against `readerGraceMs` (an option, 50 by default) and answers
   from the previous snapshot if the build has not finished. The first build
   is still shared and waited for; `fresh()` is unchanged.
2. **The tests** that change content without a request and read straight
   after: run the suite, and where one reads too soon, it waits with
   `cache.fresh()`, as a write request does. Unit tests in
   `tests/content-checkpoint.test.ts` for the grace: a build quicker than it
   answers fresh, a slower one answers the previous snapshot, the first build
   is still waited for.
3. **The benchmark** (`tests/load/large-site.bench.ts`): `slowest render while
   publishing` and `slowest render in a burst`, budget 1,000 ms, in the table;
   the sustained and burst notes keep their counts.
4. **Measured:** Small and Medium on both engines, the new numbers in
   `docs/performance.md`, and where any remaining long render comes from
   written up in this story.
5. **Docs:** `docs/performance.md` (the grace beside "A request that changes
   content…", the slowest render in the table) and `docs/rendering.md`, "The
   published cache".

## Acceptance criteria

- [x] A visitor's render never waits longer than the grace for a rebuild once
      a previous snapshot exists; the first build is still shared; a write
      still waits for its own rebuild.
- [x] The benchmark records the slowest render through sustained publishing and
      through a burst, against a 1,000 ms budget that fails a release past
      twice it, at every size.
- [x] Small and Medium on both engines meet it, measured and recorded; where any
      long render remains comes from is written up.
- [x] Tests cover the grace; tests that read straight after a change made
      without a request wait with `fresh()`.
- [x] `docs/performance.md` states the slowest render as well as the p95, and
      the rule for who waits.

## What was built

- **The grace** (`packages/render/src/published-cache.ts`): `snapshot()` races
  the build it starts, or the one it queues behind a running build, against
  `readerGraceMs` (50 ms by default) when a previous snapshot exists, and
  answers from that snapshot if the build is slower. The first build is still
  shared and waited for; `fresh()` is unchanged.
- **Tests:** three in `tests/content-checkpoint.test.ts` (a quick rebuild
  answers within the grace and a slow one does not, the queued build, the first
  build). The full suite needed no change: every test that reads straight after
  a change already waited through a request or `fresh()`. The benchmarks did:
  they timed rebuilds with `snapshot()`, which now answers after the grace, so
  `large-site.bench.ts` and `media-library.bench.ts` wait with `fresh()`.
- **The benchmark** records `slowest render publishing` and `slowest render in
  a burst` against 1,000 ms.
- **Measured** (2026-10-31, `docs/performance.md`): the slowest render is 9 to
  47 ms at Small and 55 to 95 ms at Medium, on both engines. What remains is
  the grace itself, then a render from the previous snapshot, plus contention
  with the publishing requests on Postgres; before the grace, Medium's cold
  renders waited out rebuilds of 600 ms to 1.3 s.
- **Docs:** `docs/performance.md` (who waits, the budget, the table) and
  `docs/rendering.md` ("Who waits for a rebuild").
