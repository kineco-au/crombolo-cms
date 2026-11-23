# 407 — A workspace's conflicts in its listing

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 384, 400

## Story

As a host showing a board of a site's workspaces, I want each workspace in the list to
say whether it is in conflict with Shared and over how many items, so that the board
is right without a merge preview per workspace or having caught every event.

## Context

A workspace that comes into conflict raises an event once per item until it is settled,
and the items raised are kept in `workspace_conflict_raised` (`400`, migration 093).
`GET workspaces` says nothing of it, so a host that missed the event, or started
after it, has to ask each workspace for its merge preview. Asked for by Crombolo Cloud
(its story 300).

## The design

- **Each workspace in `GET <plugin>/api/workspaces`,** and in the reading of one,
  carries `conflicted: boolean` and `conflicts: <n>`, the count of items raised and
  not yet settled, read from `workspace_conflict_raised` in the one query.
- **It is what was last found, not a fresh plan:** the rows are written when a change
  to Shared or to the workspace is checked for conflicts (`400`), and cleared as each
  is settled, so the list costs no merge preview. `docs/workspaces.md` says so.
- **The remote protocol's workspace routes answer the same,** and `crombolo
  workspaces` shows it.

## Acceptance criteria

- [x] **A workspace with two items in conflict** lists `conflicted: true, conflicts: 2`.
- [x] **Settling one** lists 1; settling both, merging or discarding lists none.
- [x] **A workspace never in conflict** lists `conflicted: false, conflicts: 0`.
- [x] **Listing many workspaces** makes no merge plan and no query per workspace.
- [x] **The remote protocol and the command line** show the same.
- [x] **Tests** on both dialects; `docs/workspaces.md` and `docs/remote-protocol.md`
      updated.

## What was built

- **`WorkspaceRepository.conflictCounts(ids)`:** one grouped query over
  `workspace_conflict_raised`.
- **`WorkspaceView`** (`packages/server/src/workspaces.ts`) carries `conflicted` and
  `conflicts`. The list counts once for every workspace it answers; a workspace read,
  opened or changed alone counts its own. The remote protocol answers the same view.
- **A merge or a discard already removed the rows,** so a closed workspace lists none.
- **`crombolo workspaces` and `workspace list`** show "n in conflict" beside one.
- **Tests:** a case in `tests/workspace-events.test.ts`.
