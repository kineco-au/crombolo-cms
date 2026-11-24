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

What has to be found out first: where the editor's saved work sits when the request is
approved (their open change, or their own workspace where one is required), and what
an approval does there today.

## The design

- **An approval that publishes closes the editor's change and raises the event,** in
  the publish's transaction: the change that holds the page as the editor saved it,
  so applying it elsewhere publishes the same content.
- **The event names both people:** `Change.By` stays `person` (or `tool`), the editor
  who asked; `Change.ApprovedBy: { Key, Name }` is the approver, and
  `Change.Workflow` its name.
- **An approved unpublish does the same,** with the kind `411` adds.
- **An approval with a time** raises it when the time comes and the page is
  published, unless the schedule was already passed on (`414`).
- **Where a workspace is required,** an approval of a page in the editor's own
  workspace merges that page, and the merge raises the event as an own-workspace
  publish does (`397`), with the approver named.
- **A request sent back or withdrawn** raises nothing.

## Decisions to settle before starting

1. **Whose change it is.** *Recommended:* the editor's, closed by the approval, with
   the approver named on the event. The change then holds exactly what was approved.
   The alternative is a change of the approver's own, which loses the editor's saves
   from it unless they are copied in.
2. **What the editor's change holds if they saved other pages too.** *Recommended:*
   the whole change is closed and sent, as a publish closes it today; the other pages
   arrive saved, not published.
3. **Whether the editor may save the page again while it waits.** If they can, what
   was approved and what is in the change can differ. *Recommended:* find out what
   `028` does, and send what is published.
4. **Order with `411`.** *Recommended:* build `411` first; this story uses its kind
   for an unpublish and its way of closing a change for an actor that is not the
   person.

## Acceptance criteria

- [ ] **An approved publish** raises the event once, naming the change, the editor
      and the approver, and the change applied elsewhere publishes the page as
      approved.
- [ ] **An approved unpublish** raises it with its kind.
- [ ] **An approval with a time** raises it when the page is published, once.
- [ ] **On a site that requires a workspace,** an approval of a page in the editor's
      own workspace raises it for that merge.
- [ ] **A request sent back, withdrawn or declined** raises nothing.
- [ ] **A publish by the site's own code or a job that is not an approval** still
      raises nothing.
- [ ] **Tests** on both dialects; `docs/webhooks.md`, `docs/workflows.md`,
      `docs/changes.md` and the release notes updated.
