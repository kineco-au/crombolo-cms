# 201 — Postgres load and benchmark shards

**Epic:** I — Hardening · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As a maintainer, I want the release's Postgres load and benchmark workloads to
run in parallel, so that publishing waits for the slowest workload rather than
their combined duration.

## Context

Job `122797904054` in release run `40682917783` runs the concurrency test, the
large-site benchmark and the media-library benchmark sequentially. The job
took 29 minutes: large-site generation and checks took about 937 seconds,
the media benchmark about 760 seconds, and concurrency about 25 seconds.

The unit suite already uses a measured-time file selector and independent
Postgres jobs. Reuse that selector for the three load/benchmark files, with
separate measured weights and three Postgres jobs. SQLite keeps its existing
single job. Fixture sizes, operation counts and budgets stay unchanged.

## Acceptance criteria

- [x] Every Postgres load/benchmark file runs in exactly one of three jobs.
- [x] SQLite still runs all load tests and benchmarks, and publishing requires
      every load matrix job to succeed.
- [x] Unit sharding retains its default interface and separate weights.
- [x] Tests cover discovery, shard coverage and workflow gating; Docker checks
      and a scaled Postgres run of each shard pass.
- [x] README and testing docs describe the release matrix and local invocation.

## Implementation

- `scripts/test-shard.ts` accepts an optional `unit` or `load` suite. The
  existing two-argument invocation still selects unit tests with their existing
  weights. `load` discovers both `*.load.ts` and `*.bench.ts` in `tests/load/`,
  with rounded Postgres timings in that directory's `shard-weights.json`.
- The release matrix has three Postgres load jobs with independent service
  containers and databases. Each selects its files, refuses an empty selection,
  and invokes the existing `test:ci` wrapper with the load/benchmark timeout.
  The current files each occupy one job; future files use the median weight
  until measured. SQLite retains its two existing wrapper steps in one job.
- `publish.needs` continues to require `load`, covering the entire matrix;
  `fail-fast: false` lets every shard report its result.
- Unit tests exercise the selector as a subprocess, its default invocation and
  invalid inputs, complete load/benchmark coverage without duplicates, and the
  parsed release workflow's matrix, step conditions and publication gate.
- README and `docs/testing.md` describe the split, the intact fixtures and a
  scaled local invocation.

## Validation

- Docker `bun run check`: formatting, lint and types passed.
- Full SQLite unit run: 3,034 passed, 8 skipped. Its one failure was the
  README's length assertion; the new summary was shortened to meet that limit.
  The affected documentation, selector and packaging suites then passed all
  192 tests, with zero failures, against the final README and shard weights.
- Postgres shards, run concurrently in Docker: five large-site checks, two
  media-library checks and the 1,500-operation concurrency test all passed.
  Local benchmark fixtures used 120 pages, 10 media items, 3,000 library items
  and 20 uploads; release fixture defaults were unchanged.
