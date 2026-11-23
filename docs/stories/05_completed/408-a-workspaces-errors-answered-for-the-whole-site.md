# 408 — A workspace's errors answered for the whole site

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 386, 396

## Story

As someone reading a workspace's errors on a site with several nodes, I want the same
list whichever node answers, so that an agent watching for what its change broke is
never told there is nothing because it reached another node.

## Context

`GET workspaces/{key}/errors?since` answers from a list each node keeps in memory, the
last 200 per workspace (`ERRORS_KEPT` in `packages/server/src/workspace-checks.ts`). An
error noted on one node is unknown to the others, and all are lost at a restart.
`processes` already answers for the whole site from any node, from rows each node
writes (`396`). Asked for by Crombolo Cloud (its story 300).

## The design

- **Errors are rows,** written as they are noted: workspace, node, time, page and what
  it said. Any node answers `errors?since` from them, newest last, each with its
  `node`.
- **Kept as the list is now:** the newest 200 per workspace, pruned as rows are
  written, and all of a workspace's removed when it is merged or discarded.
- **Writing never fails a render:** a row that cannot be written is logged and the
  page answers as it would have.
- **A migration adds the table,** undone in every test rewind.

## Decisions (settled 2026-11-23)

- **Rows,** as `396` keeps a process's failures: they survive a restart.
- **Kept by count alone:** the newest 200 for a workspace, and none once it is merged
  or discarded. Nothing is pruned by age.
- **A failed `render` is an error too,** beside a failed page in `check` and `pages`. A
  page that fails while someone browses the workspace's site is not noted.

## Acceptance criteria

- [x] **An error noted on one node** is in the answer from another.
- [x] **`since`** leaves out what came before it, across nodes.
- [x] **No more than the newest 200** are kept for a workspace.
- [x] **A merged or discarded workspace** leaves no rows.
- [x] **A failed write** does not change what the page answers.
- [x] **Tests** on both dialects, with a second node's checks on the one database; the migration is in
      the release notes; `docs/workspaces.md` updated.

## What was built

- **Migration 096** (`AddWorkspaceErrors`, release 0.76.0): `workspace_error`, with the
  workspace's key, the node, the page, what it said and when.
- **`WorkspaceErrorRepository`** (`packages/data/src/repositories/workspace-errors.ts`):
  `note`, which drops what is past the newest `WORKSPACE_ERRORS_KEPT` (200), `of(key,
  since?)` and `clear`.
- **`workspace-checks.ts`** notes to it, with the node's id, and reads from it; the list
  each node held in memory is gone. A note that throws is logged and nothing else.
- **`GET /{key}/render`** notes a page that does not render.
- **`onClosed`** (a merge or a discard) clears the workspace's rows.
- **Each item answers `node`** beside `at`, `page` and `says`.
- **Tests:** `tests/workspace-errors.test.ts`; the migration is undone in the five
  rewinds.
