# 375 — A workspace: pages changed apart from Shared

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** XL
**Depends on:** —

## Story

As someone working on a piece of a site, I want to open a workspace and change pages
there without anyone else seeing them, so that I can finish and check a piece of work
before it joins what everyone shares.

## Context

Every change to a site lands straight in what everyone sees. Two people or two agents
working at once step on each other, and nothing marks where one piece of work begins and
ends. A workspace does both jobs: it keeps work apart, and it is the boundary of a change
(`380`, `381`).

The storage leans this way, though not as simply as a third version. Since migration
003 a page's values are append-only `property_value` rows, each with the `event_id` of
the `content_version` that wrote it (`docs/data-model.md`). The draft is the rows with
`is_current`; published, and any past version, is the latest row per key as of an
event. So a workspace's rows can sit in the same tables, but every Shared query that
reads "latest as of an event" or "the newest by id" would see them unless it is
filtered.

## The design

- **Shared is the default workspace.** What a site holds today is Shared. A workspace is
  a named overlay on it, for one piece of work, thrown away or merged (`380`).
- **Opening one is a single row:** name, owner, members. Nothing is copied.
- **A workspace is its owner's, shared with the people they choose.** The owner adds
  and removes members; nobody else can read it.
- **A page changed in a workspace** gets `content_version` and `property_value` rows
  carrying the workspace (`workspace_id`, null for Shared), in the same tables as
  Shared's.
  - Only the values that differ are written, over the Shared event it was made from:
    the page's base, recorded per page, used by `380`.
  - Its values are never `is_current`, so everything that reads the current draft
    (search, relations, references, tags, list views) cannot see them.
  - Template and per-language names come with the version, as now.
- **A read names its workspace.** With one named, a page is the workspace's current
  version where it has one and Shared's otherwise. Untouched pages follow Shared as it
  changes; there is no snapshot.
- **The Management API takes the workspace as a header** (`Crombolo-Workspace`). With
  none, it is Shared. Opening, listing, sharing and discarding are crombolo's own routes,
  under `<backoffice>/crombolo/api/workspaces`, since the Management API serves only
  Umbraco's spec.
- **The workspace reaches the data layer explicitly.** The router sets it for the
  request; only the server adapters read that, and they pass it to the repositories and
  operations, which never read request-wide state.
- **A page made in a workspace** has a node carrying the workspace, and an object type
  of its own until it is merged, so Shared's node queries hide it as they stand.
- **Per-language published state and schedules** take the workspace too.
- **Publishing in a workspace** makes the page visible in that workspace only (`379`).
- **What stays out of Shared's derived data:** the search indexes, the media-usage table
  and the published cache hold no workspace version.
- **Version clean-up** leaves a workspace's versions alone until it is merged or
  discarded.
- **Discarding** removes everything carrying the workspace.
- **A setting turns workspaces on** for a site (`workspaces.enabled`, off by default
  until merging exists), and says which kinds one may hold: pages here, schema (`376`),
  files (`377`).
- **Media and Library items are refused inside a workspace,** with a plain reason, until
  a later story or `379` takes them.
- **Requiring a workspace for every edit** (`workspaces.required`) moves to `380`: before
  merging exists, a site that required one could never change Shared.
- **A workspace write is audited only:** no webhooks, notifications, live events,
  redirects or approval gate. The approval gate is at merge (`380`).
- **Users, groups, members and settings are never in a workspace.** They are the site's.

## Decisions (settled 2026-11-20)

- **Moves, reordering and deletes** are recorded and marked, applied at merge: the tree
  shows them as pending, and navigation in the workspace does not reflect them. A page
  made in the workspace moves for real.
- **Blocks** conflict as a whole property. Merging by block key is left to a later story.
- **Same tables, `workspace_id`,** not shadow tables; Shared's queries filtered, with
  leak tests on both dialects as the guard.
- **Administrators** may list and discard a workspace, not read it.
- **Shared deleting a parent** with pages made in a workspace under it: they stay in the
  workspace, marked as conflicting for `380`.

## Leaks to close in Shared

Each of these reads "latest as of an event" or "newest by id" and needs `workspace_id IS
NULL`; found by reading, not proven complete. In `packages/data/src/repositories/
documents.ts`: `#valueRowsAsOf`, `#valueHistoryFor`, `loadDrafts`, `#revision` (or a
workspace save makes Shared editors' copies stale), `#headEvent`, `#publishedEventId`,
`#recomputeEdited`, `versions`, `atVersion`, `eventMarkers`, `#rollback`, the
`document_version` updates in `publish` and `#unpublish`, `#insertEvent`,
`dueSchedules`, `#cleanupNode`. Elsewhere: `site-search.ts`'s history read; to audit,
`relations.ts`, `content-query.ts`, `audit.ts`, `server/src/access.ts`, `overview.ts`,
`tree-invariants.ts`, `media-listing.ts`.

## Acceptance criteria

- [x] **A workspace is opened, listed and discarded** through its routes, and opening one
      copies nothing.
- [x] **A page changed in a workspace** reads changed there and unchanged in Shared and
      in every other workspace.
- [x] **A page made in a workspace** is found there and nowhere else.
- [x] **An untouched page** follows Shared's changes inside the workspace.
- [x] **Two workspaces** each hold a draft of the same page.
- [x] **Search, media usage and the published cache** of Shared hold nothing from a
      workspace.
- [x] **Version clean-up** keeps a workspace's versions; discarding removes them.
- [x] **A workspace is read by its owner and its members,** and by nobody else.
- [x] **Media and Library writes** in a workspace are refused, saying why.
- [x] **A Shared editor** is not made stale by a workspace save, and a Shared publish takes
      nothing from a workspace.
- [x] **With workspaces off,** every route for them is refused and nothing else changes.
- [x] **Moves, reordering and deletes** behave as decided above.
- [x] **Tests** on both dialects; `docs/` says what a workspace is.

## Built

- **Migration 082 `AddWorkspaces`** (`packages/data/src/schema/workspaces.ts`, release
  0.70.0): `workspace`, `workspace_member`, `workspace_document`,
  `workspace_document_culture`, `workspace_pending`, and `workspace_id` on `node`,
  `content_version`, `property_value` and `content_schedule`, with no foreign keys so
  the test rewinds can drop them; undone in all five rewinds.
- **`DocumentRepository`** takes a `workspace` (`inWorkspace(id)`): reads, the revision,
  saves, creates, publish, unpublish, schedules, moves, sorts and deletes branch on it;
  every Shared history read in the leak list is filtered to `workspace_id IS NULL`, as are
  site search's and the relations date. A workspace's own value wins per key over Shared's
  as of the base, whatever the ids, since an upgrade twin can come later.
  `treeItems` names and states a touched page as the workspace has it.
- **`WorkspaceRepository`** (`packages/data/src/repositories/workspaces.ts`): open, list,
  rename, members, changes, discard.
- **`ObjectTypes.WorkspaceDocument`** for a page made in one; a Shared page deleted with
  one beneath leaves it at the top, marked `orphaned`.
- **`createWorkspaceOperations`** and `workspaceAuditSink` (`packages/content`): audited
  naming the workspace, announced nowhere else; refusals map to 409.
- **The router's `scope`** (`api-management`), with `WORKSPACE_OPERATIONS` and
  `WORKSPACE_REFUSALS`; the server's header scope, `inWorkspaces` delegation and routes
  (`packages/server/src/workspaces.ts`); `CROMBOLO_WORKSPACES`.
- **Refused in a workspace for now:** rollback, copy, restore, emptying the bin, publishing
  a branch, hostnames, public access, notifications, media and the Library.
- **Tests:** `tests/workspaces.test.ts` and `tests/workspaces-api.test.ts`, on SQLite and
  Postgres. Docs: `docs/workspaces.md`, `data-model.md`, `api-contract.md`,
  `configuration.md`, README, release notes.

## Left for the merge (380)

Found while planning 380, and recorded there: publishing in a workspace overwrites the
published state it started from; a pending move, reorder or delete records where a page
goes, not where it was, and a page can gather several of one kind; a Shared delete removes
a workspace's edits to the page without a trace; an upgrade does not convert a
workspace's values.
