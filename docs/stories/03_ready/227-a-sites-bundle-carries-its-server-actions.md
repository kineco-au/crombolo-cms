# 227 — A site's bundle carries its server actions

**Epic:** B — Packaging and upgrades · **Priority:** should · **Size:** S
**Depends on:** 192, 219

## Story

As a host running a customer's site from its bundle, I want the site's server
actions in that bundle whenever its views use them, so that the pages render
rather than failing on an import that is not there.

## Context

Found 2026-10-31. Story 219 put actions in `actions/`, imported by views as
`#actions/…`. A bundle carries `components/` as a section, but code only from
the globs in `crombolo.code` (story 192); `actions/` is in neither unless the
site lists it. A site whose views import an action, built without
`"actions/**"` in its code globs, builds a bundle whose pages fail to render,
and nothing says so until they do. `crombolo init`'s templates copy `actions/`
(219), but a bundle does not.

## Decision to make before starting

- `actions/` becomes a carried section, like `components/`, always packed; or
- the build refuses, naming the fix, when a view imports `#actions/…` and the
  code globs do not cover `actions/`.

## Acceptance criteria

- [ ] A site that uses server actions builds a bundle whose pages render
      wherever it is installed, or is refused at build, as decided.
- [ ] `crombolo bundle check` reports a bundle whose views import an action it
      does not carry.
- [ ] `docs/bundles.md`, "A site's bundle with code", says how actions travel.
