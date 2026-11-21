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
  - `granular`: per page, Library item or field, by its key, its verbs.
- **All three kinds of per-item permission travel:** on a page, on a Library item, and on
  one field of a content type, each entry saying which (a page when it does not).
- **A page, Library item, content type or field the bundle names and the site does not
  have** leaves that permission out, and says so as a finding, never as a refusal.
- **A language the site does not have** is left off the group with a finding
  (`missing-language`), so the group arrives narrower, never wider.
- **A verb the CMS does not know** is refused, as a group file's is: a retired verb is
  read as what replaced it, any other is a blocking finding (`unknown-permission`), for
  default and per-item verbs alike.
- **The lists are exported from `@crombolo/crombolo/transfer`:** section aliases, retired
  sections, known and pruned permissions, and the levels for pages, media and forms. They
  are the CMS's own lists, not copies of them.

## The design

- **Bundle format:** `BundleUserGroup.languages` (already present, now applied) and
  `BundleUserGroup.granular?: { key: string; context?: 'Document' | 'Element' |
  'DocumentTypeProperty'; permissions: string[] }[]`, documented in
  `docs/content-transfer.md`. A field's entry is keyed by its content type, with the field's
  key in each verb as the site stores it (`<field key>|<verb>`). The bundle check refuses a
  `granular` entry with no key (`invalid-permission`). An entry with no verbs is the
  site's explicit "nothing here" (a row with an empty verb), so it travels rather than
  being refused: the site's own export writes them.
- **Planning** (`planPeople`): for a group it will create, verbs pass through
  `withoutPrunedPermissions` and any not in `KNOWN_PERMISSIONS` is blocking; each `granular`
  key is resolved to a page or Library item here, or to a content type and its field, and
  one missing is a finding (`missing-page`) and left out; languages the site lacks are a
  `missing-language` finding and left out. What it resolved rides on the plan, so applying
  only writes.
- **Applying** (`people-apply.ts`): a created group is saved with its languages and its
  resolved per-item permissions. `hasAccessToAllLanguages` is the bundle's own, no longer
  widened by a group having languages. A group already here is untouched, as before.
- **Exports:** `@crombolo/crombolo/transfer` re-exports the lists and the levels from
  `@crombolo/core`, with a test that they are the same objects.
- **An environment's export** (`exportPeople`) fills both fields from the site's groups,
  so a site's own bundle carries its groups whole.

## How it is built

- `BundleGranular` and `BundleGranularContext` (`packages/transfer/src/people.ts`), also
  exported from `@crombolo/crombolo/transfer`.
- `planPeople` (`people-apply.ts`) builds each new group's `PlannedGroup` with
  `plannedGroup`: verbs through `withoutPrunedPermissions` and `KNOWN_PERMISSIONS`,
  languages against the site's, and each entry resolved by `granularRows`, a page or
  Library item counting when it is here (by object type) or the same bundle brings it
  (`carried`, by kind, from `checkContent`); a field against the content type here.
- `applyPeople` saves the plan's languages and rows, dropping a row whose page the run
  then left out; `hasAccessToAllLanguages` is the bundle's own.
- `exportPeople` writes `granular` with `bundleGranular`, one entry per item.
- Tests: `tests/bundle-user-groups.test.ts`.

## Acceptance criteria

- [x] **A group with some languages** arrives with those languages and no others.
- [x] **A group with per-page permissions** arrives with them on the same pages.
- [x] **A per-page permission on a page the site lacks** is left out with a finding.
- [x] **Per-item permissions on a Library item and on a field** arrive too.
- [x] **A language the site lacks** is left off the group with a finding.
- [x] **A verb the CMS does not know** refuses the bundle; a retired one is read as its
  replacement.
- [x] **A bundle written before this** applies as it did.
- [x] **An environment's export** carries its groups' languages and per-page permissions.
- [x] **The lists and levels** are exported from `@crombolo/crombolo/transfer`.
- [x] **`docs/content-transfer.md`** describes both fields.
- [x] **Tests, unit and Postgres.**
