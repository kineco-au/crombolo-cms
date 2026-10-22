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

## Decisions before implementation

- Agree workload sizes, memory and latency budgets, and publishing frequency.
- Use measurements to choose full rebuilds, targeted updates or bounded lazy
  loading; document invalidation dependencies before selecting an approach.

## Acceptance criteria

- [ ] Repeatable benchmarks record steady-state and peak rebuild memory, cold
      and warm render latency, query counts and frequent publishing.
- [ ] Baselines cover both dialects with explicit regression budgets; current
      timings are not treated as universal guarantees.
- [ ] Implement changes needed to meet budgets, or document measured evidence
      supporting retention of whole-site snapshots.
- [ ] Targeted invalidation, if chosen, covers dependent routes, descendants,
      cultures, domains, redirects, media and elements.
- [ ] Bounded caches, if chosen, have explicit limits and predictable misses;
      rendering does not introduce hidden per-property database queries.
- [ ] Snapshots preserve story 174's checkpoints and protection against
      concurrent or superseded rebuilds.
- [ ] Correctness tests cover publish, unpublish, move, delete and shared
      dependency changes; load benchmarks cover both dialects.
- [ ] README and performance docs state supported workloads, resource needs and
      when another topology is appropriate.

## Out of scope

Duplicating story 082, replacing property storage with JSON without evidence,
introducing Redis by default, or rewriting the vendored backoffice.
