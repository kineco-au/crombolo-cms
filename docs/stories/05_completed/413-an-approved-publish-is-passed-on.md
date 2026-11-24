# 413 — An approved publish is passed on

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 028, 388, 395, 411

## Story

As a host that sends an editor's publish to the serving site as soon as it is made, I
want to hear when a page waiting for approval is approved and goes live, so that a
page under a workflow does not wait for the next promotion.

## Context

Asked for by Crombolo Cloud on 2026-11-24 (its story 306), from reading the code.
Confirmed here by reading, not by a run.

A page under a workflow (`028`) is not published by its editor. When the request is
approved, the site publishes or unpublishes it itself, as the system actor "Approval"
carrying the approver (`packages/server/src/approvals.ts`). The same path runs from a
job when an approved request has a time.

`Crombolo.ChangePublished` is raised only for a person's own write: `recordInChange`
(`packages/server/src/content-events.ts`) returns unless the actor is a user acting
directly. So an approval's publish closes no change and raises nothing. The editor's
saves are in their change, which stays open, and is closed by whatever they publish
next, or not at all.

Found out first (2026-11-24, by reading):

- **Straight in Shared,** the editor's saves are in their direct-edit change, which a
  request does not close: it stays open until they next publish, or closes unannounced
  after ten idle minutes (`EDIT_WINDOW_MS`).
- **Where a workspace is required,** the editor's publish merges the page into Shared as
  a draft (a one-page merge, its own change, not announced since nothing was published)
  and sends the request (`node-operations.ts`, `forApproval`).
- **An approval publishes exactly the version approved** (`request.eventId`): saved again
  since, the publish is refused as stale and the request goes back to the editor. So what
  is sent is what goes live.
- **An approval with a time** sets a schedule on Shared, which the schedule job fires.

## The design

- **An approval that publishes closes the editor's change and raises the event,** in
  the publish's transaction: the change that holds the page as the editor saved it,
  so applying it elsewhere publishes the same content.
- **The event names both people:** `Change.By` stays `person` (or `tool`), the editor
  who asked; `Change.ApprovedBy: { Key, Name }` is the approver, and
  `Change.Workflow` its name.
- **An approved unpublish does the same,** with the kind `411` adds.
- **An approval with a time** raises it at approval, its change holding the schedule, so
  the serving site fires its own; as each site fires it, `414` raises it again naming
  the change.
- **Where a workspace is required,** an approval of a page in the editor's own
  workspace merges that page, and the merge raises the event as an own-workspace
  publish does (`397`), with the approver named.
- **A request sent back or withdrawn** raises nothing.

## Decisions (2026-11-24, the maintainer's)

1. **The editor's change:** their newest change holding the page, closed if still open,
   announced with `ApprovedBy` and `Workflow`.
2. **The whole change is sent;** other pages in it arrive saved, not published.
3. **An approval with a time is announced at approval,** its change holding the
   schedule; firing then raises it again on each site, as `414` does.
4. **Where a workspace is required,** the one-page merge's change that took the page into
   Shared is announced at approval, with `From: own-workspace` and the approver.
5. (Was "whether the editor may save while it waits":) settled by the finding above.
6. (Was "order with 411":) `411` is built.

## Acceptance criteria

- [x] **An approved publish** raises the event once, naming the change, the editor
      and the approver, and the change applied elsewhere publishes the page as
      approved.
- [x] **An approved unpublish** raises it with its kind.
- [x] **An approval with a time** raises it at approval, the change holding the
      schedule, and the serving copy fires it at its time.
- [x] **On a site that requires a workspace,** an approval of a page in the editor's
      own workspace raises it for that merge.
- [x] **A request sent back, withdrawn or declined** raises nothing.
- [x] **A publish by the site's own code or a job that is not an approval** still
      raises nothing.
- [x] **Tests** on both dialects; `docs/webhooks.md`, `docs/workflows.md`,
      `docs/changes.md` and the release notes updated.

## Implementation

- **The approval's actor** carries `approval: { editorKey, workflow }` beside the approver
  (`systemActor`, `approvals.ts`); a timed approval sets its times through the `schedule`
  operation (`ApprovalPublisher.schedule`), so they raise an event too.
- **`passOnApproval`** (`content-events.ts`): for an approval's `published`,
  `unpublished` or `scheduled`, the editor's newest change holding the page
  (`ChangeRepository.closeHolding`: their edits, or their own workspace's merge) is closed
  if open and announced with `approvedBy` and `workflow`; `unpublish` or `schedule` as
  its kind; a time kept in that change (`scheduleIn`) and naming it (414).
- **Payload:** `Change.ApprovedBy: { Key, Name }` and `Change.Workflow` (`webhooks.ts`).
- **Found on the way:** a plain publish sends `publishSchedules: [{ culture: null }]`, which
  counted as setting a schedule (414, 417). A schedule is touched now only when a time is
  given or there is one to clear (`touchesSchedule`, `#setSchedule`).
- Tests: `tests/approvals.test.ts`, story 413's block (both dialects).
