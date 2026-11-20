# 382 — A change that loses data says so, and takes two steps

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 376, 380

## Story

As someone changing a site's schema, I want to be told when a change will lose what
editors have entered, and how much, and to have removal happen in two steps, so that
content is never lost by accident.

## Context

Removing a property or changing its data type drops or strands the values under it.
Today that happens on save. The usual discipline is to expand first and contract later:
add the new thing, move to it, and only then remove the old. The schema can hold people
to that without asking them to copy types by hand.

## The design

- **Every schema change is classed:**
  - **safe:** adding a type or a property, renaming a label, loosening a rule, changing
    a description or an icon;
  - **lossy:** removing a property or a type, changing a property's data type to one
    that stores differently, tightening a rule existing values fail, making a varying
    property invariant.
- **A lossy change is counted** against the site it is about to reach: how many pages
  hold a value it affects. The count is shown at merge (`380`) and wherever a change is
  applied (`383`).
- **A lossy change has to be named.** A merge or an apply that carries one is refused
  unless the person lists it as accepted.
- **So does anything that removes or renames,** whether or not content is lost by it:
  a type, a property, a data type, a component, a stylesheet or a page deleted; a
  type's or a property's alias renamed; a file moved. Each is listed on its own and
  accepted on its own, by a person, at every merge and every apply that carries it. A
  change that only adds needs no acceptance.
- **Removal is two changes:**
  1. **Retire:** the property or type is hidden from editors and from new pages. Its
     values are kept, and it can be brought back.
  2. **Purge:** a later change, lossy, removes it and its values.
- **A changed data type** leaves the old `property_type` row retired with its values
  (`376`), and offers to convert them where the two types allow. What cannot be
  converted is listed.
- **The rule a site may tighten:** refuse a purge within so many days of the
  retirement. A lossy change is always allowed once accepted.

## What exists already (2026-11-20)

- The schema check classes a sync as `none`, `additive`, `data-requiring` or `breaking`
  (`ChangeClass`, `packages/schema/src/check.ts`), with findings such as
  `type-renamed`, `property-renamed` and `mandatory-unfilled`.
- Removing a property retires it (`retired_at`), keeping its values, and an alias that
  comes back revives it; `crombolo types purge --older-than` deletes retired properties
  and their values; a changed data type retires the old row and converts what it can
  (`docs/schema-as-code.md`).

## Decisions (settled 2026-11-20)

- **The existing four classes,** not safe and lossy: `none`, `additive`,
  `data-requiring` and `breaking`, from a table in `@crombolo/core` of every kind of
  change, shared by sync, merge and apply. `breaking` is what this story calls lossy;
  `data-requiring` needs values converted or filled first.
- **Accepted by item, or by kind.** Each deletion, rename and lossy change is listed with
  an id and accepted by it, or every item of a kind at once (`--accept-all
  pages-deleted`), which still lists each one.
- **One setting, `CROMBOLO_PURGE_AFTER_DAYS`:** the fewest days between a retirement and
  its purge, 0 by default. There is no setting to refuse lossy changes: one is allowed
  once accepted explicitly, by name or kind.

## Acceptance criteria

- [x] **Each schema change carries its class,** by a table in `@crombolo/core` that a
      test holds every kind of change to (`tests/schema-changes.test.ts`).
- [x] **A lossy change shows how many pages it affects** on the site it is merged to;
      where it is applied is `383`'s.
- [x] **A merge carrying an unaccepted lossy change** is refused, naming it.
- [x] **A merge carrying a deletion or a rename** is refused until each is accepted by
      name or kind; a change that only adds merges with nothing to accept.
- [x] **A retired property** is gone from the editor, keeps its values, and can be
      restored (`tests/schema-sync.test.ts`, "removing a property retires it").
- [x] **A purge** removes a retired property's values and is itself lossy
      (`property-purged`, `breaking`).
- [x] **A changed data type** converts the values it can and lists the rest
      (`tests/upgrade.test.ts`'s conversion with a refusing converter).
- [x] **A purge within `CROMBOLO_PURGE_AFTER_DAYS` of its retirement** is refused.
- [x] **Tests;** `docs/` describes the classes and the two steps.

## Built (2026-11-20)

- **The table:** `CHANGE_CLASSES`, `ACCEPTED_BY_NAME`, `needsAcceptance` and `costlier` in
  `packages/core/src/schema-changes.ts`; `ChangeClass` moved there and re-exported by
  `@crombolo/schema`.
- **The items:** `describeFileChange` and `unaccepted` in
  `packages/schema/src/describe-changes.ts`: a definition compared as its type or data
  type (added, retired, renamed, described; each property added, retired, renamed,
  re-edited, made mandatory, loosened, tightened, made invariant or varying, described),
  any other file as added, changed or removed. Ids are `<kind>:<subject>`.
- **The merge:** the file plan (`workspace-schema.ts`) lists each written file's items
  against Shared now, with `pages` for a lossy property change (`pagesHolding`); the
  runner's files hook returns the ones needing acceptance as `findings`, refused unless
  accepted by id or kind; the planner adds `page-deleted:<key>` for each delete or trash
  waiting; `mergeBlockers` accepts a finding by its id or its kind. The preview carries
  `files.items`.
- **Purge:** `CROMBOLO_PURGE_AFTER_DAYS` (`purgeAfterDays`), refused by `types purge`;
  `purgeRetired` keeps to Shared's rows.

## Left for later

- **Applying a change to another site** counts and asks for acceptance there with `383`.
- **A back-office screen** for accepting comes with the merge screen (`384`).

