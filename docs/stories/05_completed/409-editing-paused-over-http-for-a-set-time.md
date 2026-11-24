# 409 — Editing paused over HTTP, for a set time

**Epic:** P — The command line · **Priority:** should · **Size:** M
**Depends on:** 152, 351

## Story

As a host that pauses a site's editing around a deployment, I want to pause and
resume it by a request to the running site, and to say how long the pause may
last, so that a pause takes a moment to make and a caller that stalls or dies
cannot leave the site refusing saves.

## Context

Asked for by Crombolo Cloud on 2026-11-24 (its story 318). It pauses Production's
editing around a promotion whose code changes tables: before the backup, and again
before the servers are replaced.

Today a pause is made only by `crombolo maintenance pause` and `resume` (`152`),
which write `Crombolo.Operations.WritesPaused` in `key_value` through the database
(`packages/data/src/maintenance.ts`). A host with no shell on the site starts a
one-off task for each, about a minute's cold start, three times per go-live.

A pause has no end: `{ reason, by, at }` stays until someone resumes it. The write
gate (`assertNodeMayWrite`) reads the flag inside every editor's write transaction,
so a pause or a resume is seen by every node at once.

## The design

- **A pause may carry when it ends.** `WritesPaused` gains `until`, a time or
  nothing. The write gate, `/health`, the poller and `maintenance status` all treat
  a pause past its `until` as no pause. Nothing has to run for it to end.
- **Routes on the running site:**
  - `GET <backoffice>/crombolo/api/maintenance` answers
    `{ paused: { reason, by, at, until } | null }`.
  - `POST <backoffice>/crombolo/api/maintenance` takes
    `{ action: 'pause' | 'resume', reason?, forSeconds? | until? }` and answers the same
    as `GET`. `forSeconds` (at least 1) or `until` (an ISO time at least a second ahead
    by the site's clock), never both (400); neither is a pause until resumed.
- **Who may:** a caller who may apply a change: **Apply changes**
  (`Crombolo.Remote.ApplyChanges`), checked as applying a change checks it, so it follows
  `CROMBOLO_APPLY_CHANGES_BY`. A host's client that promotes changes holds it already.
  Who paused and when is read with the Settings section, as `maintenance status` does.
- **How they sign in:** a personal command-line token or an API client's token in
  `Authorization`, or the back office's cookie with its usual request check.
- **Audited as the commands are:** `PauseEditing` and `ResumeEditing`, with the
  caller, the reason and the time it ends.
- **Repeating is safe:**
  - resuming when nothing is paused, or the pause has ended, changes nothing and
    answers `paused: null`;
  - pausing again with the same reason keeps `at` and `by` and moves `until`;
  - pausing with a different reason replaces the pause.
- **`crombolo maintenance pause --for <duration>`** (`90s`, `10m`, `1h`) or
  **`--until <time>`**, and `maintenance status` says when the pause ends.
- **`/health`** carries `until` inside `paused`. The message of a refused save
  stays as it is.
- **Editors see a banner while editing is paused,** across the top of the back office
  for everyone signed in, saying so in plain words with the reason and when saving is
  back, in the person's own time zone: "Editing is paused for maintenance: <reason>.
  You can save again at 10:10." A pause with no end says "until it is resumed". It
  appears and goes within a few seconds of a pause or a resume, on every node, and
  goes by itself when the time passes, without a reload. Nothing else in the back
  office changes: pages still open and read.
  - Any signed-in back-office user reads what the banner needs (the reason and the
    end); who paused and when stay for the Settings section.
- **Nothing else changes:** readers are unaffected, no node drains, a refused save
  is the same 409, and a content import is still not refused.

## Decisions (2026-11-24, the maintainer's)

1. **The node's own clock ends a pause,** compared with the stored `until`: no extra
   query in the write gate.
2. **Apply changes** (`Crombolo.Remote.ApplyChanges`), the right a host's client that
   promotes changes holds, checked as applying a change checks it. Changed on
   2026-11-24 from a new "Pause editing" right, which the maintainer dropped.
3. **A token in `Authorization`, or the back office's cookie** with its request check;
   either way the caller needs Apply changes.
4. **`forSeconds` or `until`:** either, never both. The site's clock judges `until`.
5. **No ceiling:** any time a second or more ahead; none is a pause until resumed.
6. **A pause ended by its time is not audited:** its own entry says when it ends.

## Acceptance criteria

- [x] **A pause with `forSeconds`** refuses an editor's save with the usual 409
      until the time passes, and lets it through afterwards with nothing resumed.
- [x] **A pause with no time** lasts until resumed, as today, from the route and
      the command.
- [x] **`GET`, `maintenance status` and `/health`** say when a pause ends, and say
      nothing is paused once it has.
- [x] **The back office shows a banner** to every signed-in user while editing is
      paused, with the reason and when saving is back (or "until it is resumed"), in
      their time zone; it appears and goes within a few seconds of a pause or resume,
      and goes by itself when the time passes. A browser test covers it.
- [x] **Resuming twice,** or after the time has passed, succeeds and changes
      nothing.
- [x] **Pausing again with the same reason** moves the end and keeps who paused
      and when; a different reason replaces it.
- [x] **A caller without the right** is refused, and so is one not signed in.
- [x] **A pause and a resume by the route** are in the audit log with the caller.
- [x] **A pause made on one node** refuses a save on another at once.
- [x] **A pause stored before this story,** with no `until`, reads as indefinite.
- [x] **`maintenance pause --for`** takes a duration and **`--until`** a time, and each
      refuses one it cannot read; giving both is refused.
- [x] **`until`** in the request is taken as given, and one less than a second ahead, or
      sent with `forSeconds`, is refused (400).
- [x] **Tests** on both dialects; `docs/operations.md`, `docs/audit-log.md`, the
      CLI spec and the release notes updated.

## Notes

- The banner was asked for by the maintainer on 2026-11-24. Before it, nothing in the
  back office used `/health`'s `paused`, so an editor learnt of a pause only when a
  save was refused.

## Implementation

- `WritesPaused.until`, `pauseEnded` and `parseWritesPaused(value, now)`
  (`packages/data/src/maintenance.ts`): a pause past its end reads as none, so the write
  gate (`assertNodeMayWrite`), the poller's `paused` (`packages/server/src/schema.ts`),
  `/health` and `maintenance status` agree with no clean-up. `pauseWrites` keeps who and
  when for the same reason.
- `createMaintenanceApi` (`packages/server/src/maintenance-api.ts`) at
  `<plugin>/api/maintenance`, with `pauseRequest` checking `forSeconds` or `until`;
  `mayPause` is `mayApplyChanges` (`server.ts`), as `PUT changes` uses.
- The CLI: `maintenance pause --for/--until` (`parseDuration`), and `status` says when.
- The banner: `maintenance.js` (an entry point, checking every 5 seconds and setting a
  timer for the end), `maintenance-banner.js` and `maintenance-words.js`.
- Tests: `tests/maintenance-http.test.ts` (both dialects), `tests/maintenance.test.ts`,
  `tests/browser/maintenance-banner.browser.ts`.
