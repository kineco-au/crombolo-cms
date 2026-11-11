# 327 — What each extension did

**Epic:** I — Hardening · **Priority:** should · **Size:** L
**Depends on:** 309, 311, 325

## Story

As an administrator trying an extension, I want to see everything it does on the site,
attributed to it and to the person it acted for, so that I can judge it by what it did
rather than by what it said it would do.

## Context

Every call an extension makes already passes one place: the grant check on the channel
(story 309) and the capability handlers behind it. The host's `fetch` sees its outbound
requests, the custom-table driver sees each statement it runs, and story 323 sends each
screen action through the same channel. None of that is kept or shown. The audit log records
some of it against the person, as if they did it themselves.

## Decisions (2026-11-11)

- **An activity record per call**, kept for a configurable window (14 days by default):
  the extension, the person it acted for or "itself", what it did in plain words ("read
  page Contact", "added a redirect", "sent a request to api.acme.com", "wrote 3 rows to
  note", "opened the Redirects screen"), the outcome, and the time taken.
- **Attribution in the audit log changes** for calls an extension makes: "Redirects, for
  Adam" rather than Adam, so a person's own actions and an extension's on their behalf are
  told apart.
- **Activity opens from Installed**, per extension, newest first, filterable by kind and by
  person, with a count by kind at the top: so many reads, writes, requests out, rows written,
  screens opened. It also shows the calls the grant refused, which is what a misbehaving
  extension looks like.
- **Exportable** as a file, for a review or a report.
- **Not a time-boxed grant.** "Allow for a day" was considered and left out of this story: the
  activity view is what makes a trial a trial, and a time limit is a small follow-up once
  someone asks for it.

## Decisions (2026-11-11, planning)

- **Writes in full, reads rolled up** (the maintainer's choice). A write, a request out, rows
  written, a refusal, a job, an event and a screen action are one row each. Reads are counted
  into one row per extension, person, kind and minute, so a listing screen opened fifty times
  is one line, "read pages, 50 times", not fifty.
- **Recorded where the call is already named, not on the channel.** The channel's `host`
  frame calls a function by index and has lost the capability's name, so nothing is recorded
  there. The places that know what a call is: `gated` in `bundle-grants.ts` wraps every
  capability method by name and permission and sees each refusal; `createBundleApi` knows the
  verb, the path and whether it was refused; the host `fetch` wrapper knows the origin; the
  `sql` frame handler knows the statement's first word, the table and the rows affected;
  `isolatedBundle` knows each route, event, job, workflow and screen call and its duration.
- **No statement text, no bodies, no values.** A row holds the kind, the area or table, the
  verb, the entity key where there is one, a count, the outcome and the time taken. The view
  names an entity through the audit log's `describe`, as the audit dashboard does.
- **The audit attribution is 325's.** Story 325 prefixes an extension's Management API writes
  with "<Extension>, for <person>", so this story depends on it and adds no audit change of
  its own.
- **The window is an environment setting**, `CROMBOLO_EXTENSION_ACTIVITY_DAYS`, 14 by default,
  0 to keep nothing, read as `CROMBOLO_AUDIT_RETENTION_DAYS` is. (The story said
  `extensions.activityDays`; the config's `extensions` is a map of extension ids, as 324
  found.) A per-extension cap of 100,000 rows guards a runaway, oldest deleted first.
- **Batched, lost on a crash.** Rows are queued in memory and flushed every second or at 200
  rows, and on stop. A crash loses at most a second of activity, which the row the call made
  in the audit log still shows for a write.

## The plan (2026-11-11)

What exists and is reused: `AuditLog` in `packages/data/src/audit.ts` for the shape of a
paged, filtered query and `prune`; `createAuditHost` and `readAuditPageQuery` in
`packages/server/src/adapters/audit.ts` for the route; the retention job and `every` in
`jobs.ts`; `gated` and `contextFor` in `bundle-grants.ts` and `bundles.ts`; `createBundleApi`;
the `fetch` capability in `core.ts`; `ExtensionProcess.#database`; `isolatedBundle`; the
Installed view and `audit-dashboard.js` for the list, filters and paging; `download.js`.

### Slice 1: the table and the port

- Migration `AddExtensionActivity`, after the last state at the time it lands (325's
  `delegate_key` migration comes first if 325 lands first): `extension_activity` with `id`
  (integer, primary), `extension_id`, `person_key` and `person_name` (null for itself),
  `kind` (`read`, `write`, `request`, `rows`, `call`, `screen`, `refused`), `area` (the
  permission's area, the origin's host, the table, the route or screen id), `verb`, `entity_key`,
  `count`, `outcome` (`ok`, `failed`, `refused`), `ms`, `occurred_at`; an index on
  `(extension_id, occurred_at)`. Its `release` is the version it ships in; every test rewind
  is extended.
- `packages/data/src/extension-activity.ts`: `ExtensionActivityLog` with `record(rows)`,
  `page(extensionId, filter, cursor)`, `counts(extensionId, since)` by kind,
  `people(extensionId)`, `prune(before)` and `cap(extensionId, max)`; `tables.gen.ts`
  regenerated.
- `packages/server/src/extension-activity.ts`: `createActivityRecorder(db)` with
  `write(row)`, `read(row)` which folds into the open minute's row for the same extension,
  person, kind and area, `flush()`, and the timer. `ActivityActor` is derived from a
  `BundleCaller`: a back-office caller's key and name, a member's username under `person_name`
  with no key, the installer's under `user.delegate` for a job, else null.

### Slice 2: the recording points

- `gated` takes a `record` callback: each method call is timed and recorded by capability and
  method, `ok` or `failed`, and a refused one as `refused` with the permission it needed.
  `contextFor` passes the recorder bound to the bundle and caller.
- `createBundleApi`: each request is recorded as `read` or `write` by the area the matching
  permission names (`content`, `media`, …), the verb and the entity key parsed from the path
  when the segment after the area is a key; `ApiRefusedError` records `refused`.
- The `fetch` capability records `request` with the origin's host and the response status, and
  `refused` for an origin outside `http.outbound`.
- `ExtensionProcess.#database`: a `sql` frame whose first word is `insert`, `update`, `delete`
  or `replace` records `rows` with the table name from the compiled query and `numAffectedRows`;
  a `select` folds into a read of that table.
- `isolatedBundle`: each `route`, `event`, `job`, `workflow` and `render` call is recorded as
  `call` with its name, outcome and time; a `screen` view or action as `screen`, once 323 lands.
- `recordActivity` is a port on `BundleRuntimeOptions` so tests pass a fake and the remote's
  listing is untouched.

### Slice 3: retention and the route

- `config.ts`: `extensionActivityDays` from `CROMBOLO_EXTENSION_ACTIVITY_DAYS`, default 14.
- `jobs.ts`: `runActivityRetention` hourly, pruning by the window and capping each extension.
- `server.ts`: under the extensions API, `GET installed/<id>/activity` with `before`, `after`,
  `limit`, `kind`, `person`, `since`, `until`, answered through a `readActivityPageQuery`
  modelled on `readAuditPageQuery`; `GET installed/<id>/activity/summary` with the counts by
  kind and the people; `GET installed/<id>/activity.csv` for the export, the same filter, one
  line per row with the entity named. Gated on Settings as the rest of the extensions API is.

### Slice 4: the view

- `bundles-installed.js`: the details box gains an "Activity" line with the last 14 days'
  counts by kind ("12 writes, 3 requests out, 1 refused") and a button opening the view.
- `bundles-activity.js`: the view in place of the list, newest first, with the kind and person
  filters, the counts at the top, "Load more" paging, the refused rows in the danger colour,
  and an Export button through `downloadFile`. Each row reads as "wrote page Contact", "read
  pages, 50 times", "sent a request to api.acme.com, 200", "wrote 3 rows to note", "opened the
  Redirects screen", "refused: content.write". The words come from a pure
  `bundles-activity-words.js`, tested without a browser.

### Slice 5: tests and docs

- `tests/extension-activity.test.ts`: the log's record, page, counts, people, prune and cap on
  both dialects; the recorder folds reads and flushes on size, time and stop; each recording
  point through a real process in the isolation suite's style: an `api` write, an `api` read
  folded, a refused `api` call, a `fetch` in and out of its origins, an insert's row count, a
  route, a job and an event each with its person; a member caller's name; a job under
  `user.delegate` naming the installer.
- `tests/audit-read.test.ts`'s model for the route: filters, paging, bad queries, the CSV.
- `tests/activity-words.test.ts` for the sentences.
- `tests/migrations.test.ts` and the five rewinds.
- Docs: `extensions.md` "Watching one"; `audit-log.md` "Where entries come from" pointing at
  the activity record for what the audit log does not hold; `configuration.md` the setting;
  `operations.md` a line under "Security"; `release-notes.md` with the migration listed.

## Acceptance criteria

- [ ] Every write, outbound request, table write, job, event and screen action an extension
      makes is recorded with the person it acted for and its outcome; reads are counted per
      extension, person, kind and minute.
- [ ] Refused calls are recorded and shown.
- [ ] No row holds statement text, a request body or a value.
- [ ] Activity opens from Installed, filters by kind and person, counts by kind, and exports.
- [ ] Records older than the window are deleted on schedule, and an extension never holds more
      than the cap.
- [ ] Covering tests; docs and release notes.
