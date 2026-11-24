# 417 — A change that only schedules says so

**Epic:** S — Workspaces and changes · **Priority:** could · **Size:** S
**Depends on:** 411, 414

## Story

As a host telling an editor what became of their change, I want the event for a change
that set a time to say so, so that I can say "scheduled for Tuesday" and not "live"
before the page's time has come.

## Context

Asked for by Crombolo Cloud on 2026-11-24, after 0.77.0.

`Crombolo.ChangePublished` carries `Change.Kind` for an unpublish, a move, a reorder
and a delete (`411`; `ChangeKind` in `packages/server/src/content-events.ts`), and none
for a publish. Setting or clearing a schedule raises the same event, straight in
Shared (`395`) and from a workspace (`414`), also with no kind. So a subscriber cannot
tell "this page is live now" from "this page will go live later".

When the time comes, the firing schedule raises the event again, naming the change
that set it, with no kind for a page going live and `unpublish` for one coming down
(`414`). That one is a publish and is rightly told as one.

## The design

- **`Change.Kind: schedule`** on the event raised by setting or clearing a schedule,
  where the change publishes nothing now.
- **The event carries the times:** `Change.Schedule: [{ Culture, PublishTime,
  UnpublishTime }]` as the change holds them, empty when the schedule was cleared, so
  a subscriber need not fetch the change to say when.
- **A change that publishes now and also sets a time** (live today, down on Friday)
  keeps no kind, as a publish, and carries `Change.Schedule` too.
- **A schedule firing is unchanged:** no kind when the page goes live, `unpublish`
  when it comes down.
- **Absent still means a publish,** so a subscriber that ignores the new kind tells
  a scheduled change as it does today.

## Decisions (2026-11-24, the maintainer's)

1. **One kind, `schedule`,** with an empty `Change.Schedule` when it was cleared.
2. **The times are on the event:** `Change.Schedule: [{ Culture, PublishTime,
   UnpublishTime }]`, in UTC, as the change holds them.
3. **A change that publishes now and sets a time is a publish:** no kind, with
   `Change.Schedule` alongside.

## Notes

- **Where the kind is decided:** straight in Shared, a `scheduled` event (nothing
  published) is `schedule`, and a publish carrying a schedule is a publish
  (`recordInChange`, `content-events.ts`); from a person's own workspace, a one-page
  merge that published nothing but set a schedule is `schedule` (`414`'s
  `alone.published` and `scheduled`).
- **`413`'s approval with a time,** announced at approval, is a change that only
  schedules too, and says `schedule` with its times, whichever is built first.

## Acceptance criteria

- [x] **Setting a time on an unpublished page,** in Shared and in a person's own
      workspace, raises the event with `Kind: schedule` and the times.
- [x] **Clearing it** raises `Kind: schedule` with no times.
- [x] **A publish that also sets an unpublish time** raises no kind, with the times.
- [x] **A plain publish, an unpublish, a move, a reorder and a delete** raise what
      they do today.
- [x] **The schedule firing** raises what it does today.
- [x] **Tests** on both dialects; `docs/webhooks.md`, `docs/changes.md` and the
      release notes updated.

## Implementation

- `ChangeKind` gains `schedule`; the facts gain `schedule` (`Change.Schedule: [{ Culture,
  PublishTime, UnpublishTime }]`, `webhooks.ts`).
- Straight in Shared (`recordInChange`): a `scheduled` event is `schedule` with its times;
  a publish that set or cleared a time (`published.scheduled`, set by the publish
  operation) carries its times with no kind. From a person's own workspace, a one-page
  merge that published nothing but set a time is `schedule` (`workspace-merge-run.ts`).
- Clearing a time through the Management API publishes the page, so a clear is told as a
  publish with an empty `Schedule`: there is no API that clears a time alone.
- Tests: `tests/content-locked.test.ts`, story 417's block.
