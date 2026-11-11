# 327 — What each extension did

**Epic:** I — Hardening · **Priority:** should · **Size:** L
**Depends on:** 309, 311

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

## The design

- A table, `extension_activity`, written from the channel's call handler, the host `fetch`
  wrapper, the custom-table driver and the screen handler, in one `recordActivity` port, batched.
- Retention by a scheduled job, honouring `extensions.activityDays`.
- A route under `crombolo/api/extensions/<id>/activity` with paging and filters, gated as
  Installed is, and the Activity view in the plugin.
- The audit writer takes an optional actor, "extension X for user Y".
- Docs: `extensions.md` "Watching one", `audit-log.md`, `operations.md`.

## Acceptance criteria

- [ ] Every capability call, outbound request, table write, job, event and screen action an
      extension makes is recorded with the person it acted for and its outcome.
- [ ] Refused calls are recorded and shown.
- [ ] Activity opens from Installed, filters by kind and person, counts by kind, and exports.
- [ ] The audit log attributes an extension's actions as the extension for the person.
- [ ] Records older than the window are deleted on schedule.
- [ ] Covering tests; docs and release notes.
