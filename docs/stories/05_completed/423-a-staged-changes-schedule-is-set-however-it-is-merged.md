# 423 — A staged change's schedule is set however it is merged

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 395, 414

## Story

As a host that stages a change on a site and then merges the workspace it was staged
in, I want the schedule the change carries to be set on that site, so that a page
scheduled where content is made is published at its time everywhere the change goes.

## Context

Reported by Crombolo Cloud on 2026-11-24, on 0.78.0, and confirmed here by reading; not
run. A page made in a person's own workspace with a publish time and no publish now is
merged, and `Crombolo.ChangePublished` says `Kind: schedule` with the time. The host
takes the change (`GET changes/{id}/bundle`), stages it on Production
(`PUT changes?stage=true`) and merges the workspace. Production's page arrives as a
draft with no schedule.

The cause is older than 0.78.0 (`395`), not `417`:

- Staging keeps each change's schedules on the workspace, not in it
  (`stagedChanges[].schedules`, `stage` in `packages/server/src/change-transfer.ts`),
  since a merge drops a workspace's own schedules.
- They are set on Shared by `scheduleHere`, which only `mergeStaged` calls, and only
  `apply` calls that: `PUT changes` with no `stage`. `mergeStaged` is returned from
  `createChangeTransfer` and used nowhere else.
- The workspace's own merge (`POST workspaces/{key}/merge`,
  `packages/server/src/workspaces.ts`) passes `appliedChanges` to the merge and never
  sets their schedules. Nor does the merge itself (`packages/content/src/workspace-merge-run.ts`),
  which carries only the schedules set in the workspace (`workspace_schedule`, `414`).

So a change applied in one call keeps its schedule, and one staged and then merged, by
a person in the back office or a host over HTTP, loses it. Any other way a staged
workspace is merged (the command line, an approval) should be checked for the same.

## The design

- **The schedules a staged change carries are set by the merge itself,** wherever it is
  asked for, in the merge's transaction. Each is marked with the change that carried it
  (`414`), so it names that change when it fires, and the merge's change holds it.
- **A rehearsal sets nothing.**
- **A merge of several workspaces** sets the schedules of each one's staged changes.
- **A page the merge did not bring** has no schedule set.
- **It replaces what Shared had for the page,** as applying a change in one call always
  has.
- **A page a workflow covers is not scheduled:** its times go with the approval request
  the merge sends, for a staged change's schedule and a workspace's (`414`) alike.

## Decisions (2026-11-25, the maintainer's)

1. **The fix is in the merge,** not in each route that asks for one.
2. **A staged schedule replaces Shared's without asking,** as today. A conflict would need
   the bundle to carry the schedule as it was before.
3. **The schedule is kept, but never publishes a page unapproved:** the approval request
   carries it. Approved before the time, the page is scheduled; after, it is published on
   approval; never approved, it is not published.

## Acceptance criteria

- [x] A change that only schedules a page, staged on another site and merged through
      `POST workspaces/{key}/merge`, leaves the page there with the same publish time, in
      UTC, and the schedule fires at it.
- [x] The same for a time to come down at on a page nothing else changed, and for one
      that clears a schedule.
- [x] The back office and the command line merge through the same route.
- [x] `PUT changes` with no `stage` still sets it, once (story 414's tests).
- [x] The schedule set names the change, and its firing raises `Crombolo.ChangePublished`
      naming it.
- [x] A rehearsed merge sets no schedule.
- [x] A page a workflow covers arrives with no schedule and a request waiting that
      carries the time; its time passing publishes nothing.
- [x] Tests on both dialects; `docs/changes.md` says a schedule is set at the merge.

## Implementation

- **The merge** (`packages/content/src/workspace-merge-run.ts`): one `schedule` step sets a
  page's schedule in Shared, records `scheduled`, and holds `schedules/<key>` and the page
  in the merge's change. It is used for each workspace's own schedules (`414`) and, before
  them, for the schedules of the changes staged in it (`workspace.stagedChanges`, those
  named in `appliedChanges`), each marked with its change's key. A schedule set in the
  staged workspace by hand is applied after and wins.
- **A workflow:** where `publishRefusal` refuses the page, or its publish is already
  waiting, the times are put on the `forApproval` entry (`schedule`) and nothing is set.
  `node-operations.ts` sends the request with them; where the workflow refuses the time
  (none allowed, or already past) the request is sent without, its comment saying when.
- **`change-transfer.ts`:** `scheduleHere` and the loop after `mergeStaged`'s merge are
  gone.
- Tests: `tests/content-locked.test.ts`, story 423's block.
- Not changed: a merge's `approvals.send` still throws where the page already has a
  request waiting, as it did for a publish.
