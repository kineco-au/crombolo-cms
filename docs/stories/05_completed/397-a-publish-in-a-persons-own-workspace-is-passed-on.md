# 397 — A publish in a person's own workspace is passed on

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 380, 388, 395

## Story

As a host serving a site made elsewhere, I want an editor's publish in their own workspace
announced as a publish in Shared is, so that it goes live at once and does not wait for a
release.

## Context

With `CROMBOLO_WORKSPACES_REQUIRED`, an editor's change lands in their own workspace
(`380`), and publishing a page there merges that page alone into Shared. The merge records
a change of its own (`Published "<page>"`) and replays the page through Shared's writes as
the merge, not as the person's own edit. So `Crombolo.ChangePublished` (`388`, `395`) is
never raised for it, and a host passing each publish on hears nothing.

A named workspace's merge is a release: a host waits for a promotion to take it, and it
raises nothing.

## The design

- **The one-page merge raises `Crombolo.ChangePublished`** for the change it records, in the
  merge's own transaction, when the page is published in Shared by it. A page a workflow
  holds for approval is not published, so raises nothing.
- **It carries the usual `Change`:** `Key`, `Name`, `By`, `Tool` and `Needs`, as a direct
  publish does, and `From: "own-workspace"`, so a host tells it from a direct publish
  (which has no `From`).
- **A named workspace's merge** still raises nothing.

## Acceptance criteria

- [x] A publish in a person's own workspace raises one `Crombolo.ChangePublished`, naming
      the merge's change, `By: "person"` and `From: "own-workspace"`
- [x] Its `Needs` lists the changes the page needs once the served copy is reported
- [x] A named workspace's merge raises none
- [x] `docs/webhooks.md`, `docs/changes.md` and `docs/workspaces.md` say so

## Implementation

- `EventSink.ownPublished` (`@crombolo/content`), called by `runWorkspaceMerge` after it
  records the change of a one-page merge that published the page.
- The content event sink (`packages/server/src/content-events.ts`) records the
  `change-published` outbox event for it, as `recordInChange` does for a direct publish.
- Tests: `tests/served-changes.test.ts`.
