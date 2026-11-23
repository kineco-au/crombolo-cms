# 400 — A workspace's life raised as events

**Epic:** S — Workspaces and changes · **Priority:** could · **Size:** M
**Depends on:** 380, 384, 388, 398

## Story

As a host following a site's workspaces, I want to hear when one is opened, merged,
discarded, or comes into conflict with Shared, so that I can follow them without asking
for the list again and again.

## Context

A host hears of an editor's publish through `Crombolo.ChangePublished` (`388`, `395`,
`397`). It hears nothing of a workspace itself, so it polls
`GET <backoffice>/crombolo/api/workspaces` to follow them.

A workspace is opened in five places: by name, as a person's own at their first change
(`380`), for a staged change (`383`), for a reverted change reopened (`381`), and by the
content operations. It is merged in the merge run (`closeMerged`) and discarded by its
owner, an administrator, a refused staging, and the discard of idle ones (`pending`).

## The design

- **Four webhook events,** each written to the outbox in the transaction that does the
  thing, as `Crombolo.ChangePublished` is, and listed among the back office's webhook
  events:
  - `Crombolo.WorkspaceOpened`: opened, wherever it is opened;
  - `Crombolo.WorkspaceMerged`: merged into Shared and closed, naming the change it made.
    Several merged as one raise one each, naming the same change. A person's own
    workspace's one-page merges do not close it, so they raise `ChangePublished` only;
  - `Crombolo.WorkspaceDiscarded`: discarded, by whoever and however;
  - `Crombolo.WorkspaceConflicted`: a write to Shared has put an item the workspace holds
    in conflict with it.
- **Every workspace raises them,** a person's own included, each carrying `personal` so a
  host can leave those out.
- **Each carries** `Workspace: { Key, Name, Personal, Owner, State }` and who did it, as
  `By` and `Tool` do on `ChangePublished` (`395`). `Merged` adds
  `Change: { Key, Name }`; `Conflicted` adds `Items: [{ Kind, Key?, Path?, Name }]`, the
  items newly in conflict.
- **A conflict is found at the Shared write.** Each write to Shared of a page, media item,
  Library item or definition file checks the open workspaces holding that item (as
  `touching` finds them), and runs the merge plan's three-way comparison for that item in
  each. A workspace with a conflict on it that was not already in conflict raises the
  event, naming it.
- **Once per item until it is settled.** The site keeps which items it has raised a
  conflict for in each workspace (`workspace_conflict_raised`, a migration). An item is
  raised again only after its conflict is answered (`POST /{key}/conflicts`,
  `files/resolve`) or the workspace is refreshed from Shared, and the rows go when the
  workspace merges or is discarded.
- **What it costs:** one comparison per open workspace holding the item written, in the
  write's transaction. A write no workspace holds costs one query.

## Acceptance criteria

- [x] Each of the five ways a workspace opens raises `WorkspaceOpened` once
- [x] A merge that closes a workspace raises `WorkspaceMerged` naming its change; several
      merged as one raise one each; a person's own one-page merge raises none
- [x] Each way a workspace is discarded raises `WorkspaceDiscarded` once
- [x] A Shared write that brings a page, media item, Library item or file into conflict
      with an open workspace raises `WorkspaceConflicted` naming it, once until answered
- [x] A Shared write that merges cleanly with the workspace raises nothing
- [x] Every event carries `personal`, and who did it
- [x] The events are listed among the back office's webhook events
- [x] The migration names the release it ships in; every test rewind undoes it
- [x] `docs/webhooks.md` and `docs/workspaces.md` say so

## Implementation

- `recordWorkspaceEvent` (`packages/data/src/repositories/workspace-events.ts`) writes each
  event to the outbox; `WorkspaceRepository.open`, `discard` and `announceMerged` call it, so
  every way a workspace opens or goes raises it. A dry run of a change opens and discards
  its workspace `quiet`.
- The merge run announces each workspace it closed once its change is recorded.
- `createConflictWatch` (`packages/server/src/workspace-conflicts.ts`): node operations wrap
  Shared's page, media and Library sinks so each write asks the open workspaces holding the
  item (`previewWorkspaceMerge`); a direct file edit notes its path (`recordEdit`), checked
  once the request ends (`withConflictWatch` in `server.ts`); a merge's files are checked
  once they land. `WorkspaceRepository.conflicted`, `settle` and `settled` keep
  `workspace_conflict_raised` (migration 093); the conflict, file-resolve and update routes
  settle what a person answered.
- The payload (`webhookPayload`): `Workspace`, `By`, `Tool`, `Change`, `Items`.
- Tests: `tests/workspace-events.test.ts`, `tests/workspace-schema-api.test.ts` (a file's
  conflict).
