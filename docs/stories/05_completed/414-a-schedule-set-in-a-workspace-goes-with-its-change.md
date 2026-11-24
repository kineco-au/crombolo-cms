# 414 — A schedule set in a workspace goes with its change

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 395, 397

## Story

As an editor on a site that requires a workspace, I want the time I set for a page to
go live or come down to travel with my change, so that it happens on the serving site
at that time, whether or not the site I work on is running.

## Context

Asked for by Crombolo Cloud on 2026-11-24 (its story 306), from reading the code.
Confirmed here by reading, not by a run.

Set straight in Shared, a schedule is already carried: setting or clearing one closes
the person's change, the change holds the page's schedule (`schedules/<page key>`,
`ChangeRepository.scheduleOf`), a change bundle carries it, and applying it sets the
same schedule there, which fires at its time (`395`, `docs/changes.md`).

Set in a workspace, it is not. A workspace runs no schedule (`375`), and its merge
(`packages/content/src/workspace-merge-run.ts`) does nothing with one: the change the
merge makes holds no schedule. A one-page merge of a person's own workspace raises
`Crombolo.ChangePublished` only when the page was published (`alone?.published`), so a
page that is only scheduled raises nothing. With `CROMBOLO_WORKSPACES_REQUIRED` every
edit is in a workspace, so no schedule an editor sets reaches another site.

Found out first (2026-11-24, by reading): **a schedule set in a workspace never reaches
Shared.** It is kept in `content_schedule` with the workspace's id, which no schedule run
reads (`dueSchedules` takes only Shared's). A full merge deletes it when it closes the
workspace (`WorkspaceRepository.closeMerged`); a one-page merge of a person's own leaves
it in the workspace, where it stays. A staged change's merge already sets the schedules
it carries on Shared (`stagedChanges[].schedules`, story 395), which this can reuse.

## The design

- **A merge carries each merged page's schedule into Shared,** publish and unpublish
  times per language, and the change it makes holds them as a schedule set in Shared
  does. A schedule cleared in the workspace is cleared in Shared.
- **Setting or clearing a schedule in a person's own workspace** merges that page as
  a publish there does (`397`) and raises the event with `From: own-workspace`, even
  where nothing is published yet.
- **Applied on another site, the change sets the same schedule,** which fires there
  at its time, as today for a change made in Shared.
- **A named workspace's schedules** go into Shared with its merge and travel with
  its change, raising nothing of their own.
- **A time already past when the change lands** fires at the next run of the
  schedule, as any overdue time does.
- **Two schedules for one page meeting at a merge** are a conflict to settle like
  any other, not the later one winning silently.

## Decisions (2026-11-24, the maintainer's)

1. **Both sites fire the schedule,** each its own, as for one set in Shared.
2. **When a schedule fires, it raises the page's ordinary published and unpublished
   webhooks and `Crombolo.ChangePublished` too,** naming the change that set the
   schedule. Since both sites fire it, the site where content is made raises it as well:
   a host taking that change again finds it already applied there, which it must treat
   as done. Said in `docs/webhooks.md`.
3. **A page made in the workspace with a schedule** is created in Shared unpublished,
   with its schedule, at the merge.
4. **Times are stored and carried as instants (UTC),** as Shared's schedules are; a test
   fixes this.

## Acceptance criteria

- [x] **A schedule set in a person's own workspace** merges the page, and the change
      holds the schedule.
- [x] **The event is raised** for that merge, for a page published now and for one
      only scheduled.
- [x] **The change applied to another site** sets the same times there, and the page
      is published, and unpublished, when they come.
- [x] **Clearing the schedule in the workspace** clears it in Shared and on the other
      site.
- [x] **A named workspace's merge** carries its pages' schedules in its change.
- [x] **A page made in the workspace with a schedule** arrives unpublished and goes
      live at its time.
- [x] **A schedule set in Shared** behaves as it does today.
- [x] **Tests** on both dialects; `docs/changes.md`, `docs/workspaces.md`,
      `docs/webhooks.md` and the release notes updated.

## Implementation

- **Migration 097** (`AddWorkspaceSchedules`, `packages/data/src/schema/workspace-schedules.ts`):
  `workspace_schedule` (a page a workspace set a schedule for, with Shared's as it was
  then) and `content_schedule.change_key` (the change that set a schedule).
- **Setting one in a workspace** records Shared's the first time (`#setSchedule`);
  `scheduleEntries` reads a page's schedule as a change carries it, in UTC instants.
- **The merge** (`workspace-merge-run.ts`) plans each set schedule, refuses one Shared
  changed since unless `schedule-changed` is accepted, sets it in Shared (a cleared one
  cleared), holds it in its change as `schedules/<key>`, marks Shared's rows with the
  change, and announces a page only scheduled in a person's own workspace. A one-page
  merge drops the workspace's rows for it.
- **Own workspace:** `mergeOwnPage` goes ahead for a schedule set there with nothing else
  changed.
- **Naming the change:** a schedule set straight in Shared (`content-events.ts`) and one
  applied from a change (`scheduleHere`, `change-transfer.ts`) are marked with it; the
  schedule job (`jobs.ts`) acts as a system actor carrying it, and the event sink raises
  `Crombolo.ChangePublished` naming it, with `Kind: unpublish` for one coming down.
- Tests: `tests/content-locked.test.ts`, story 414's block (both dialects); the migration's
  undo in each rewind.
