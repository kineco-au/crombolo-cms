# 174 — Renderers know which published changes they serve

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** L
**Depends on:** 011, 120

## Story

As someone operating several renderer nodes, I want to know which committed
published changes each node serves, so that I can detect stale content and
reload it consistently.

## Context

The architecture review scored published-content consistency **3.5/5**.
Version events, historical values, per-culture published references and
transactional cache instructions already exist.

`packages/render/src/published-cache.ts` uses a local generation counter to
share builds and stop older builds replacing newer ones. Its snapshot has no
durable content checkpoint. It loads documents, domains, languages, dictionary,
media, redirects and elements through separate reads. A local generation does
not prove those reads represent one coherent state or that another node has
caught up to a committed change.

The candidate is an explicit consistency contract and durable checkpoint. An
identifier allocated before commit is not automatically a safe committed
high-water mark; overlapping transactions must be accounted for.

## Decisions before implementation

- Define snapshot scope, promised consistency and checkpoint semantics.
- Choose consistent reads and checkpoints on both dialects, including writes
  committing in a different order from identifier allocation.
- Agree bounded retry or fallback when changes arrive during a build.

## Acceptance criteria

- [ ] Snapshots identify the durable checkpoint whose changes they contain,
      with semantics valid across restart and renderer nodes.
- [ ] Every included source follows the consistency contract; a snapshot cannot
      label older data with a newer checkpoint.
- [ ] Tests cover overlapping commits, invalidation during builds, delayed
      instruction delivery, restart and older builds finishing last.
- [ ] Instruction processing cannot permanently skip a late-committing change
      or report a node current while it serves older content.
- [ ] Diagnostics expose the applied checkpoint and available freshness facts
      without exposing private content or implying unavailable information.
- [ ] The source interface supports story 121 waiting for a replica to reach
      the required checkpoint or falling back to the primary within a bound.
- [ ] SQLite and Postgres tests cover correctness; existing large-site benchmarks
      measure the cost of the chosen consistency approach.
- [ ] README and architecture docs explain freshness, failure behavior and the
      distinction between content checkpoints and schema revisions.

## Out of scope

Implementing replicas, globally linearizable reads on every visitor request,
or requiring a distributed cache service.
