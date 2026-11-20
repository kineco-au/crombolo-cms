# 381 — Every change is recorded, and every item has its history

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 376, 380

## Story

As someone responsible for a site, I want every change to it kept as a named change with
its author, and to see the past versions of a type or a template as I can of a page, so
that I can say what changed, who changed it, and put it back.

## Context

Pages have a history. Types, data types, components and stylesheets do not: a save
replaces what was there. An applied bundle is recorded as a run with what it touched and
a way to revert it (`content_transfer_run`); a change made in the back office is in the
audit log and nowhere else.

## The design

- **A change is what a merged workspace becomes:** its name, who made it, who merged it
  and when, every item with what it was before and after, each item's class (`382`), and
  the state of Shared it was merged onto.
- **It extends the record of a run** that applying a bundle writes, so one history holds
  merges, applied bundles (`383`) and reverts.
- **A change keeps an identity** that travels with it to another site (`383`).
- **An edit made straight in Shared is a change too,** recorded without the person doing
  anything.
  - Schema and file edits: one change each, or grouped per person within a short time.
  - Page edits: left to the pages' own history, and counted, not listed, since a busy
    site makes thousands.
- **A version per item, derived:** each change that touched a type, a data type, a
  component or a stylesheet is a version of it. Nobody numbers anything.
- **Reverting a change** is a new change, the opposite of the first, refused where a
  later change touched the same item, as a run's revert is today.
  - It can reopen the work as a workspace, holding what the change held, for a change
    that was merged before it was ready.
  - A purge (`382`) cannot be reverted, and says so before it is merged.

## Decisions (settled 2026-11-20)

- **No scope to the requirement.** `CROMBOLO_WORKSPACES_REQUIRED` (`380`) stays one
  switch covering pages, media, schema and files. Everyone then works in a workspace, and
  their permissions limit what they can change in it: an editor who may only edit pages
  changes only pages there. A site cannot require a workspace for schema and files only.
- **Before and after are hashes in `376`'s store.** Each type, data type or file item of
  a change is its path with a before and an after hash in the blob store (a type is its
  TOML file). A version of an item is a change that touched it, comparing two versions is
  a diff of two blobs, and identical texts are kept once. Pages keep their before and
  after event ids, as a run's changes do now (`content_transfer_change`).
- **Direct edits group per person, 10 minutes.** A person's schema and file edits made
  straight in Shared join their open change until 10 minutes pass with none, then it
  closes; a burst of saves to one type is one change with one before and after. Page
  edits are counted on it, not listed.
- **One history:** the change extends `content_transfer_run` (a merge, an applied bundle,
  a revert or a direct edit), with an identity that travels with it (`383`).

## Acceptance criteria

- [x] **A merged workspace is a change,** listing its items with before and after.
- [x] **A type edited straight in Shared** appears as a change with its author.
- [x] **A type, a data type, a component and a stylesheet** each show their versions, the
      change behind each, and what differed.
- [x] **An earlier version can be compared** with the current one.
- [x] **Reverting a change** puts each item back, as a change of its own, and is refused
      where something later touched it; with `toWorkspace` its work is reopened.
- [x] **The API lists changes** and reads one (`<backoffice>/crombolo/api/changes`).
- [x] **With the setting on,** an edit outside a workspace is refused, and what each
      person changes in one is what their permissions allow.
- [x] **Tests** on both dialects.

## Built (2026-11-20)

- **Migration 086 `AddChanges`** (`packages/data/src/schema/changes.ts`): the change's
  columns on `content_transfer_run`, and `change_item`; the blob store keeps every text a
  change names.
- **`ChangeRepository`** (`packages/data/src/repositories/changes.ts`): `begin`, `item`,
  `recordEdit` (ten-minute window, `EDIT_WINDOW_MS`), `list`, `byId`, `itemsOf`,
  `versions`, `laterTouching` (a later change since reverted, and its revert, do not
  count), `pageEditsBy`, `setStatus`.
- **Merges** record themselves inside their transaction (`recordChange` in
  `workspace-merge-run.ts`): the files hook's `apply` returns each file's text before and
  after; each page's events before and after are its run rows.
- **Direct edits** (`packages/server/src/adapters/change-recording.ts`): the type and
  data-type ports record each save's file, exported before and after, by the person;
  `recordingFilePort` wraps Shared's components, stylesheets and scripts. The file ports
  and the type and data-type deletes now take the person (`by`).
- **The routes** (`packages/server/src/changes-api.ts`): list, one, versions, compare,
  revert (administrators), with `toWorkspace`.
- **Tests:** `tests/changes.test.ts`. Docs: `docs/changes.md`.

## Left for later

- **A change's class** is each file's greatest; per-item listing is the merge's (`382`).
- **The back office's history screens** come with `384`.
- **A change moving to another site** is `383`.
