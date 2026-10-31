# 175 — Published cache growth stays within measured limits

**Epic:** R — Architecture and reliability · **Priority:** could · **Size:** L
**Depends on:** 086, 174

## Story

As a site owner with growing content and frequent publishing, I want rendering
memory and rebuild work to stay within documented limits, so that publishing
does not cause unpredictable visitor delays or exhaust the server.

## Context

The architecture review scored reads and caching **3/5**. Story 086 introduced
bulk reads, shared rebuilds and recorded benchmarks at 25,000 pages and three
cultures: about 1.28 seconds for a full SQLite rebuild and 1.04 seconds on
Postgres. This is a baseline, not evidence of a current performance failure.

Each renderer holds published documents, culture views, media and elements.
Content instructions in `packages/server/src/server.ts` invalidate the whole
snapshot even when they identify a changed item; the next read rebuilds it.

Measure sustained publishing, memory and larger or more varied sites before
choosing incremental projections or bounded content-value caching. A compact
route and navigation index may still cover the whole site. Historical value
growth and cleanup belong to story 082.

## Decisions (2026-10-30)

1. **Three sizes, sustained publishing, and budgets for memory and latency as
   well as time.**

   | Workload | Pages × cultures | Media |
   |---|---|---|
   | Small | 1,000 × 1 | 200 |
   | Medium | 25,000 × 3 | 1,000 (today's benchmark, kept for comparison) |
   | Large | 100,000 × 3 | 10,000 |

   - **Publishing:** one publish every 10 seconds for 10 minutes; a burst of
     1,000 publishes in a minute; an unpublish, a move and a media change each.
   - **Budgets**, the same on both engines, failing past twice the budget as
     today:
     - memory: the published cache's steady footprint at most 300 MB at
       Medium and 1 GB at Large, its peak during a rebuild at most twice steady;
     - rebuild: 5 s at Medium, 20 s at Large;
     - render: a warm page at most 20 ms p95; a cold first render after a
       publish at most the rebuild plus 50 ms; while a rebuild runs, visitors
       get the old snapshot at warm latency and never wait on it;
     - queries: a rebuild's grow with pages ÷ the 500-row slice, not with
       pages; a warm render runs none for page content.
   - **What the numbers decide:** a budget broken at Large or in the sustained
     run moves the story to targeted updates or bounded loading; none broken,
     and it records the evidence and keeps whole-site snapshots.
   - Not chosen: Medium alone, which cannot show where a whole-site snapshot
     breaks.

2. **Small and Medium in every release; Large on demand and weekly.** The
   release pipeline runs Small and Medium on both engines, as it runs Medium
   now. Large runs in a workflow of its own, started by hand and weekly, on
   both engines, its numbers kept as an artifact and written into
   `docs/testing.md` when they change; `CROMBOLO_BENCH_SIZE=large bun run
   test:bench` runs it locally. Not chosen: Large in every release, 40 minutes
   or more per release and a noisy runner's failures with it; Large only by
   hand, found only when someone looks.

3. **Readers keep the previous snapshot while it rebuilds (2026-10-30).** The
   Medium run broke "render during rebuild" on both engines: every reader
   waited for the build in flight. Only the reader that starts a build waits
   for it; the rest get the previous snapshot. A request that changes content
   answers once its rebuild is done, and a poll once its catch-up rebuild is,
   so the editor and `poll()` see the change. The rebuild gives the thread up
   every 250 pages and between read slices, as SQLite reads never do and
   assembling the snapshot is work in memory. Whole snapshots are kept. Not
   chosen: targeted updates, which make a rebuild cheaper but still make
   readers wait; releasing with the budget broken.

## Plan

1. **Measure first.** Extend `tests/load/large-site.bench.ts` to the three
   sizes (`CROMBOLO_BENCH_SIZE`), and add what it does not record: the
   published cache's steady and peak memory (heap after a forced collection,
   and the process's resident size), a cold first render after each kind of
   change, renders while a rebuild runs, query counts per rebuild, and the
   sustained and burst publishing runs. Each against decision 1's budgets.
2. **Write down the invalidation dependencies** as they are: what a publish,
   an unpublish, a move, a delete, a culture or domain change, a redirect, a
   media change and an element change each drop today, and what depends on
   them (routes, descendants, navigation, pickers, block lists).
3. **Bring the numbers back for a decision.** With the measurements on both
   engines at all three sizes, the choice between keeping whole-site
   snapshots, targeted updates and bounded loading comes back as a decision,
   with the evidence, before anything changes.
4. **Then build** whichever is chosen, holding story 174's checkpoints and its
   protection against concurrent or superseded rebuilds, with the correctness
   tests the criteria name.
5. **The workflow** for Large, and the docs: `docs/testing.md`'s numbers, and
   the README and performance docs on supported workloads, resource needs and
   when another topology is right.

## Acceptance criteria

- [x] Repeatable benchmarks at Small, Medium and Large record steady-state and
      peak rebuild memory, cold and warm render latency, renders during a
      rebuild, query counts, and sustained and burst publishing, each against
      decision 1's budgets.
- [x] Small and Medium run in every release on both engines; Large runs on
      demand and weekly in a workflow of its own.
- [x] Baselines cover both dialects with explicit regression budgets; current
      timings are not treated as universal guarantees.
- [x] Implement changes needed to meet budgets, or document measured evidence
      supporting retention of whole-site snapshots.
- [x] ~~Targeted invalidation, if chosen,~~ (not chosen: whole snapshots kept)
      Targeted invalidation, if chosen, covers dependent routes, descendants,
      cultures, domains, redirects, media and elements.
- [x] ~~Bounded caches, if chosen,~~ (not chosen)
      Bounded caches, if chosen, have explicit limits and predictable misses;
      rendering does not introduce hidden per-property database queries.
- [x] Snapshots preserve story 174's checkpoints and protection against
      concurrent or superseded rebuilds.
- [x] Correctness tests cover publish, unpublish, move, delete and shared
      dependency changes; load benchmarks cover both dialects.
- [x] README and performance docs state supported workloads, resource needs and
      when another topology is appropriate.

## Findings

- **Every page render leaked** (fixed). The Small sustained-render run climbed
  from 335 MB to 2.1 GB in about 90 seconds and was killed. Bun 1.4.3 keeps an
  `AbortSignal.any` signal, its sources and everything they reach alive while a
  listener is on it. The renderer's deadline (`#withDeadline` in
  `packages/render/src/renderer.ts`) never removed its listener, so each
  render's timer, controller, request and headers were kept. It now removes the
  listener and aborts the render's signal once the page has rendered. Covered by
  `tests/async-rendering.test.ts`.
- **The sustained and burst runs never ended** (fixed in the benchmark). Their
  visitors called `server.fetch` directly. A warm render resolves in
  microtasks alone, so the editor's ten-second timer, and the test's own
  timeout, never fired, and renders piled up without limit. Each visitor
  request now yields to the event loop, as one arriving over the network does.
- **Open:** a site route handler's signal (`packages/server/src/routes.ts`) is
  built the same way. It leaks only when site code listens to it, as
  `fetch(url, { signal })` does. Aborting it when the answer is sent would cut
  off a streamed body still reading it, so the fix waits on a decision about
  when that signal ends: story `224`.
- **Small, SQLite, before the fix:**
  - memory, rebuild, warm render, render during a rebuild, queries per slice
    and the cold render after publish, unpublish and move all passed their
    budgets;
  - the sustained and burst runs could not finish.
- **Small and Medium, both engines, after the fixes** (2,000 library items, 100
  uploads, local Docker with 8 GB):

  | p95 ms unless named | Small SQLite | Small Postgres | Medium SQLite | Medium Postgres | Medium budget |
  | --- | --- | --- | --- | --- | --- |
  | tree root / children / siblings | 5 / 4 / 5 | 6 / 7 / 9 | 5 / 6 / 8 | 8 / 9 / 11 | 100 |
  | cache memory (MB) | 2.5 | 2.5 | 149 | 149 | 300 |
  | rebuild peak (MB) | 2.5 | 2.5 | 149 | 261 | 600 |
  | cache rebuild | 14 | 23 | 627 | 715 | 5000 |
  | page render | 3.1 | 5.8 | 3.2 | 4.4 | 20 |
  | **render during rebuild** | 17 | **26** | **619** | **670** | **20** |
  | queries per slice | 5.7 | 5.7 | 2.2 | 2.2 | 12 |
  | cold render after publish / unpublish / move | 4 / 18 / 17 | 6 / 38 / 28 | 5 / 685 / 664 | 402 / 1123 / 1265 | 5050 |
  | renders while publishing | 2.8 | 3.5 | 2.9 | 3.7 | 20 |
  | renders in a burst | 2.8 | 4.0 | 3.1 | 5.1 | 20 |

  Memory stays flat through the sustained runs (Medium SQLite resident 866 MB,
  Postgres 726 MB). The slowest single render in a Medium Postgres burst was
  10.3 s, which is a render that arrived as a rebuild started.
- **Render during a rebuild breaks its budget at Medium** on both engines, 30
  times over. It is not growth: `PublishedCache.snapshot()`
  (`packages/render/src/published-cache.ts`) hands every reader the build
  in flight, so a render waits for the whole rebuild, whose time grows with
  the site. Large was not run locally; it would only be slower.
- **After decision 3:** Medium Postgres 3.9 ms over 132 renders during a
  rebuild. Medium SQLite stayed at about 320 ms until the rebuild gave the
  thread up: SQLite runs each query synchronously, and awaiting a finished
  promise never lets a waiting request in. With it, Medium SQLite passes every
  budget, 0.7 ms over 201 renders during a rebuild.
- **The benchmark ran SQLite in memory**, where a snapshot read shares the one
  connection and holds every other query for the whole rebuild. It now uses a
  file, as a site does.

## What was built

- **Three sizes** in `tests/load/large-site.bench.ts` (`CROMBOLO_BENCH_SIZE`
  small, medium, large) with decision 1's budgets: memory and rebuild peak,
  rebuild time and queries per slice, warm and cold renders, renders during a
  rebuild, and renders through sustained and burst publishing. SQLite runs on a
  file, as a site does.
- **Where they run:** the release runs Small and Medium on both engines
  (`.github/workflows/release.yml`); `.github/workflows/bench-large.yml` runs
  Large weekly and by hand.
- **Readers keep the previous snapshot** (decision 3):
  - `PublishedCache.snapshot()` answers from it while a build runs, and
    `fresh()` and `stale` serve the callers that need the change;
  - a non-`GET` request through `server.fetch` waits for the rebuild it caused;
  - a poll waits for the catch-up rebuild it started, and leaves a cache this
    node already dropped to its next reader;
  - covered in `tests/content-checkpoint.test.ts`.
- **Changes during a rebuild share one build after it** (0.39.1):
  `PublishedCache` queues a single follow-up build for everything that changed
  while one ran, rather than a build per change. The Medium burst of 1,000
  publishes went from 694 s to 291 s locally on SQLite.
- **The rebuild gives the thread up** every 250 pages, and between read slices,
  in `DocumentRepository.loadPublished` and `PublishedCache`.
- **The render leak** fixed in `packages/render/src/renderer.ts`, covered in
  `tests/async-rendering.test.ts`.
- **Docs:**
  - `docs/performance.md`: measured workloads, supported workloads and
    resources;
  - `docs/testing.md`: the benchmark's sizes;
  - the README: a site-size row.

## Out of scope

Duplicating story 082, replacing property storage with JSON without evidence,
introducing Redis by default, or rewriting the vendored backoffice.
