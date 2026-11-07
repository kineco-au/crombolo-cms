# 286 — A date is the same on any server

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As someone running a site on a server that is not set to UTC, I want a date property to
read as the editor entered it, so that a page does not show the day before.

## Context

A date picker's value is a wall-clock time such as `2026-06-25 09:18:20`.
`toWallClock` (`packages/core/src/property-values.ts`) read it with
`new Date(String(stored))`, which takes text with no zone as local time, then wrote it
out with `toISOString()`, which is UTC. So text with no zone moved by the server's offset:

| Server | Stored | `model.value()` gives |
|---|---|---|
| UTC | `2026-06-25 09:18:20` | `2026-06-25 09:18:20` |
| Brisbane, UTC+10 | `2026-06-25 09:18:20` | `2026-06-24 23:18:20` |

A site on UTC never sees it, which is why it has lasted. A site in Australia shows a
date before 10am as the day before, and one west of UTC moves the other way.

## Decisions before implementation

- **A wall-clock value is text and stays text.** `toWallClock` normalises its form without
  going through a `Date`: `T` to a space, a date alone gains `00:00:00`, anything after the
  seconds goes.
- **A stored value with a zone** (`Z` or an offset), which is an instant, is still turned
  into its UTC wall clock, as it is today.
- **Nothing is rewritten in the database.** No migration can tell a shifted seed value
  from one an editor entered. See Findings.

## Findings (2026-11-07)

- **The story's cause was half right.** The fix holds, but a date is not kept as text: it
  goes into `date_value`, a timestamp, as UTC with a `Z`, and `#fromStorage` reads it back
  with one. The first conversion, in the repository, is correct.
- **The bug is a second conversion.** `adapters/documents.ts` calls `toPublishedValue` on
  a value the repository already converted, so a template's value is the wall clock read
  again as local time. The back office converts once, so its dates did not move.
- **Seed values were stored wrong.** `seed/values.ts` used `new Date(text)` on a TOML local
  date-time or a string with a time, so `bundle build` or `start --bundle .` on a machine
  not on UTC stored them shifted. A date alone was safe. Back-office saves were never wrong.
- **A date filter moved too.** `content-query.ts` read a filter's text the same way, so a
  query with a time compared against the wrong moment. A date alone was safe.
- **Two existing tests fail under any other zone,** on both databases: `every-editor`
  and the seed round trip. Nothing ran them there.

## Decisions (2026-11-07)

- **One parser, `dateFromText`,** in `@crombolo/core`: no zone means UTC. The repository's
  write path had this logic already, and now toWallClock, the seed and the content query
  share it. That also makes `toWallClock` safe to apply twice, so the second conversion
  stays and needs no untangling.
- **A value with a `Z` or an offset reads as it did.**
- **CI's SQLite job runs in Australia/Brisbane,** so the whole suite, not one test, fails
  if this comes back.

## Acceptance criteria

- [x] `model.value()` on a date property gives the stored wall clock on a server at
      UTC+10, UTC and UTC-8.
- [x] The back office shows the same, and saving a date without changing it leaves it as
      it was.
- [x] A value with `Z` or an offset reads as it does today.
- [x] A test runs under more than one `TZ`, so a host on UTC cannot hide this again.
- [x] The release notes say dates may have read wrong on a server not on UTC, and that
      nothing needs migrating.

## Technical notes

- `packages/core/src/property-values.ts`, `toWallClock`, used by `toEditorValue` and so by
  `toPublishedValue`.
- Check the other readers of a date value for the same pattern, such as a list view's
  columns and a search index's date fields.

## Implementation (2026-11-07)

- `dateFromText` in `packages/core/src/property-values.ts` is the one parser. `toWallClock`,
  `#toStorage`, `seed/values.ts` and both reads in `content-query.ts` use it.
- The whole suite in Australia/Brisbane failed only on `every-editor` and the seed round
  trip as date failures before the fix, and on neither after. Its other failures were
  5-second timeouts on the busy local machine.
- `tests/date-zones.test.ts` runs in a process of its own under three zones, and CI's SQLite
  job now runs in Australia/Brisbane, so a test on UTC cannot hide this again.
- The second conversion through `toPublishedValue` stays: it is harmless now.
- A list view's columns and search were covered by that run, not tested on their own.

## Out of scope

- Showing a date in the visitor's time zone.
