# 392 — Changes carry languages, the dictionary, blueprints, forms and workflow set-up

**Epic:** S — Workspaces and changes · **Priority:** could · **Size:** M
**Depends on:** 381, 383, 388

## Story

As someone running a site in two places, I want a change to carry languages, dictionary
items, blueprints, form definitions and workflow set-up too, so that the serving copy can
lock them as it locks pages and types.

## Context

Changes (`381`) record pages, media, Library items, types, data types and files, and
`383` moves those between sites. A site with `CROMBOLO_CONTENT=locked` (`388`) locks only
what a change carries, so these kinds stay writable there until a change carries them
(decided 2026-11-20).

## The design

- Each kind is recorded as a change item when edited directly or merged, with its before
  and after, and travels in an exported change (`383`), matched on the target by key.
- `388`'s lock covers each kind once it is carried.

## Acceptance criteria

- [ ] **An edit to a language, a dictionary item, a blueprint, a form definition or
      workflow set-up** is recorded as a change.
- [ ] **An exported change** carries them and applies them on another site.
- [ ] **With `CROMBOLO_CONTENT=locked`,** each is read-only.
- [ ] **Tests** on both dialects.
