# 393 — A bundle's user groups arrive as they were

**Epic:** H — Importing a site · **Priority:** should · **Size:** M
**Depends on:** 071, 385

## Story

As someone moving a site's people in a bundle, I want each user group to arrive with the
languages and the per-page permissions it had, and as a site writer I want to read the
CMS's own names for sections and verbs, so that a group here can do exactly what it could
before, no more and no less.

## Context

A bundle carries its user groups as `BundleUserGroup` (`packages/transfer/src/people.ts`):
sections, default verbs, whether the group has every language, and one start node for
pages and one for media. Applying it creates each group the site does not already have.
Two things are lost on the way:

- **Languages.** A group limited to some languages is saved with `languages: []` and
  every language allowed, so it arrives wider than it was.
- **Per-page permissions.** A group's verbs on a single page, which the site stores in
  `user_group_granular_permission`, have no place in the bundle, and the group is saved
  with `granular: []`, so it arrives narrower than it was.

Anyone writing a bundle from another system (story `278`) has to translate sections and
verbs into the CMS's own. The lists that say what those are (`SECTION_ALIASES`,
`RETIRED_SECTIONS`, `KNOWN_PERMISSIONS`, `PRUNED_PERMISSIONS`, and the permission levels)
live in `@crombolo/core`, which a writer is not meant to depend on. Without them, a writer
cannot check its translation against the release it targets.

## Decisions

- **The bundle carries both,** as optional fields, so a bundle written before this still
  applies as it does now:
  - `languages`: the ISO codes the group may edit, applied as they are;
  - `granular`: per page, by the page's key, its verbs.
- **A page the bundle names and the site does not have** leaves that permission out, and
  says so as a finding, never as a refusal.
- **A verb the CMS does not know** is dropped and listed, as a group file's is.
- **The lists are exported from `@crombolo/crombolo/transfer`:** section aliases, retired
  sections, known and pruned permissions, and the levels for pages, media and forms. They
  are the CMS's own lists, not copies of them.

## The design

- **Bundle format:** `BundleUserGroup.languages` (already present, now applied) and
  `BundleUserGroup.granular?: { key: string; permissions: string[] }[]`, documented in
  `docs/content-transfer.md`. The bundle check refuses a `granular` entry with no key or no
  verbs.
- **Applying** (`people-apply.ts`): a created group is saved with its languages, and with
  `granular` resolved from page keys to the site's pages; an entry whose page is missing is
  a finding (`missing-page`) and is left out. `hasAccessToAllLanguages` is the bundle's own,
  no longer widened by a group having languages.
- **Exports:** `@crombolo/crombolo/transfer` re-exports the lists and the levels from
  `@crombolo/core`, with a test that they are the same objects.
- **An environment's export** (`exportPeople`) fills both fields from the site's groups,
  so a site's own bundle carries its groups whole.

## Acceptance criteria

- [ ] **A group with some languages** arrives with those languages and no others.
- [ ] **A group with per-page permissions** arrives with them on the same pages.
- [ ] **A per-page permission on a page the site lacks** is left out with a finding.
- [ ] **A bundle written before this** applies as it did.
- [ ] **An environment's export** carries its groups' languages and per-page permissions.
- [ ] **The lists and levels** are exported from `@crombolo/crombolo/transfer`.
- [ ] **`docs/content-transfer.md`** describes both fields.
- [ ] **Tests, unit and Postgres.**
