# 436 — Each workspace makes its own new pages

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** L
**Depends on:** 375, 376, 383, 434

## Story

As someone working in a workspace, I want to make a page, or stage a change that makes one,
whatever another open workspace holds, so that a workspace nobody finishes never stops
anyone else.

## Context

Decided by the maintainer on 2026-11-26, from 434. A page, a type and a media item are each
a `node` row, and its key, `node.unique_id`, is unique across the site: Shared and every
workspace together. So an open workspace that makes a page under a key holds that key for
as long as it stays open, and nothing else may make it:

- the same change staged into two workspaces, to look at in two places or to try again,
  is refused in the second (434 names the workspace in the way);
- a workspace that is abandoned, or that cannot be discarded, blocks it for good.

434 stops a workspace getting stuck (no type borrowed from another workspace, a discard
that cannot fail half-way) and says which workspace is in the way. This story removes the
block.

## The design

- **A key is unique in Shared, and within each workspace.** A workspace may make an item
  under a key another workspace also makes, or that Shared has, under no other rule than its
  own merge.
- **Merging is where they meet.** The first workspace merged makes the item in Shared. A
  later one making the same key merges as a change to it when it is the same change staged
  again (the change is held), and is a conflict otherwise, answered as other conflicts are.
- **A reference names the copy it can see:** in a workspace, its own, else Shared's; in
  Shared, Shared's.

## Decisions (2026-11-26, the maintainer's)

1. **Two partial indexes:** `unique_id` unique where `workspace_id` is null (Shared), and
   `(unique_id, workspace_id)` unique where it is not (each workspace). Shared's rows are
   unchanged. SQLite rebuilds the table to drop the inline `UNIQUE`.
2. **A second workspace's copy at merge is a change from a blank start:** each field the
   two set alike merges, each they set differently is a conflict on that field, answered in
   the workspace as other conflicts are.
3. **A lookup by key with no workspace answers Shared's copy** (`workspace_id IS NULL`), as
   the public site reads. A test walks every repository method that takes a key and fails on
   one that does not filter by workspace.

## Findings (2026-11-26)

- A type made in a workspace has its node row in Shared (`node.workspace_id` null) and is
  marked on `content_type.workspace_id` (story 376). 434 found staging and its type check
  reading the node's column, and so taking a workspace's type for Shared's. Types are keyed
  by their type row here; whether their nodes join the per-workspace rule is part of this
  story's work.

## Acceptance criteria

- [x] Two workspaces each make a page under one key; each reads, edits and previews its own.
- [x] The first merged makes it in Shared; the second, holding the same change, merges as a
      change to it; holding another, it is a conflict naming the page.
- [x] The same change staged into two workspaces stages in both.
- [x] Every lookup by key without a workspace answers Shared's copy: the published cache,
      the Delivery API, relations, references in values, redirects, webhooks and the audit
      log. A test finds every repository call by key and checks it.
- [x] Shared can never hold two items under one key, on SQLite and Postgres.
- [x] The migration leaves every site as it was, and `upgrade check` plans it.
- [x] `docs/workspaces.md`, `docs/data-model.md` and the release notes. Tests on SQLite
      and Postgres.

## What was built

- **Migration 101 `KeysPerWorkspace`** (`data/src/schema/keys-per-workspace.ts`): on Postgres
  the column's constraint dropped; on SQLite `node` rebuilt (`Db.rebuildTable`, behind the
  dialect seam, with `foreign_key_check` before it commits) in a step that runs with foreign
  keys off (`Migration.foreignKeysOff`, `Db.withoutForeignKeys`), since search tables
  cascade from `node`; then `ux_node_key_shared`, `ux_node_key_workspace` and
  `ix_node_unique_id`. Undone in every test rewind (`undoKeysPerWorkspace`).
- **Lookups:** `NodeRepository` takes a scope and ranks rows by it, its own then Shared's
  in a workspace, Shared's first with none (deviation from decision 3, reviewed with the
  maintainer: Shared's first, not Shared's only, so a key a workspace alone made is still
  found where it was); `create` reads back its own row; `children` and `childrenOf` hide
  Shared's copy beside the workspace's. Each workspace's documents, operations, media and
  Library are scoped. The raw queries by key prefer Shared's, relations keep Shared's, and
  a workspace's published view drops Shared's copy of a key it made. A static test
  (`tests/keys-per-workspace.test.ts`) holds every raw query by key to a reviewed list.
- **Merging:** `#mergePage` finds Shared's twin of a page the workspace made, and plans it as
  a change from a blank start (`twinNodeId`); `closeMerged` removes the copies. A change
  another workspace's merge applied already is not recorded again
  (`workspace-merge-run.ts`).
- **Staging:** 434's conflict naming another workspace is gone; the same change stages into
  two workspaces.
- **Tests:** `keys-per-workspace.test.ts`; `change-transfer.test.ts` (two workspaces, both
  merged; a different copy merged field by field). SQLite and Postgres.
- **Docs:** `workspaces.md`, `data-model.md`, the release notes.
- **Left as it was:** a group's permission on an item by its key holds for every copy under
  that key.
