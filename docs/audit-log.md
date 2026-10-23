# Audit log

The audit log records **who did what, when and from where**: every change made
through the backoffice, every sign-in and failed sign-in, and what the command
line and scheduled publishing changed. It lives in one table, `audit_entry`
(migration 033), on both dialects. Story
[`083`](stories/05_completed/083-audit-log.md).

An entry is only ever added, read or aged out. No endpoint edits or deletes one.

## What an entry holds

| Column | |
| --- | --- |
| `occurred_at` | when |
| `category` | `content`, `media`, `member`, `schema`, `settings`, `user`, `permission`, `sign-in`, `system` |
| `action` | what was done: `Create`, `Save`, `Publish`, `Trash`, `SetUserGroups`, `SignInFailed`… |
| `user_key`, `user_name` | who; the name is copied in, so the entry still reads after the user is deleted |
| `entity_type`, `entity_key`, `entity_name` | what it was done to, named the same way |
| `source` | `request`, `cli` or `job` |
| `ip_address`, `forwarded_for` | where from (see below) |
| `detail` | anything more: the groups a user was given, why a sign-in failed |

**From where.** `ip_address` is the peer that connected to the server, which
is the proxy when there is one. `forwarded_for` is the request's
`X-Forwarded-For` header, kept apart because any client can send it. Behind a
proxy that sets the header, `forwarded_for` holds the real client. Without one,
`forwarded_for` is only a claim. The dashboard shows the forwarded client when
there is one, and the connecting address on hover.

## Where entries come from

**Document writes** (story 170). Every change to a page goes through the
document operations in `@crombolo/content`, whoever started it: the backoffice,
the command line, scheduled publishing, an approved request or a form's
workflow. The operation hands its event and its actor to an event sink, and
`createContentEventSink` (`packages/server/src/content-events.ts`) writes the
entry from `auditEntryFor`. So a page published from the command line is
recorded exactly as one published in the backoffice, apart from who did it and
the `source`. The router leaves these operations out (`DOCUMENT_WRITE_OPERATIONS`
in `packages/api-management/src/document-writes.ts`), so nothing is recorded
twice.

| Actor | `user_name` | `source` | `detail` |
| --- | --- | --- | --- |
| a backoffice user | the user | `request` | — |
| the command line | `CROMBOLO_ACTOR`, else the account that ran it | `cli` | `Approval skipped from the command line` when `--skip-approval` let it past a workflow |
| scheduled publishing | `The schedule` | `job` | `Scheduled`, with the culture when it is one |
| an approved request | the approver | `request` | `Approved through "<workflow>"` |
| a form's workflow | `The form "<name>"` | `job` | `From a submission to "<name>"` |

**The Management API router.** Every successful change through the contract
(a 2xx answer to a `POST`, `PUT`, `PATCH` or `DELETE`) writes one entry, in
`ManagementApiRouter.dispatch`. Document writes are the exception, above. The mapping from operation to entry is
`auditPlanFor` (`packages/api-management/src/audit.ts`). It is derived from the
operation's name, as server events are: `PutDocumentByIdPublish` is `Publish`
on a `Document`, in `content`. Exceptions are listed by name. A test walks the
whole contract, so every operation that writes is either mapped or listed in
`NOT_AUDITED`. That list holds the writes nobody answers for: validation,
previews, temporary uploads, a user's own UI state.

- **Names are copied in.** For a delete or a trash, the item is named before
  the handler runs, while it still exists.
- **A version is filed under its item.** A rollback names a version, but its
  entry belongs to the page the version is of.
- **Bulk operations write one entry per item.** Deleting three users writes
  three entries, read from the request body.
- **Related items go in the detail.** A user created or saved with groups, or
  a group given users, lists them in `detail` (`Groups: Editors`).
- **Anonymous writes record their user.** A password reset by e-mailed link,
  or an accepted invitation, names the user it was for as the one who acted.

**Crombolo's own endpoints.** These are the schema import, source control,
search and sharing settings, bundles and forms, which the contract does not
cover. A successful write to any `<backoffice>/crombolo/api/…` path writes an
entry from `pluginAuditPlan` (`packages/server/src/adapters/audit.ts`). A host
token (story 178) is the exception: issuing one changes nothing, so it is a log
line rather than an entry.

**Sign-ins** (`packages/auth`). The auth routes report the following through
`onAudit`:

- every successful sign-in, including an API user's client-credentials grant;
- every failed one: a wrong password, an unknown login, or a locked or
  disabled account;
- the lockout itself;
- every sign-out.

A failed sign-in that names nobody records the login that was tried. That is
what Umbraco records too, and it is how a run of guesses shows up. The service
tells the routes which user a refusal concerns, but only the routes see it. The
sign-in page still learns nothing beyond the status it always got.

**The command line.** Each command that changes the environment writes one
entry after it succeeds:

- `types sync` and `types purge`
- `content import`, `content revert`, and `bundle install`
- `bundle purge`
- `dictionary import`
- the `domains` writes
- `upgrade` and `upgrade check --fix`
- `maintenance pause` and `maintenance resume`
- `admin reset-password`
- `recycle-bin empty`, which also records each page it deletes as a document write

`content publish` and `content unpublish` record one entry per page, as document
writes.

The user recorded is the account that ran the command, or `CROMBOLO_ACTOR`
when a pipeline names who it is acting for. The detail is the command without
its arguments, because an argument can be a password.

**What is not recorded.** These are left out:

- reads;
- failed changes (a 4xx or 5xx answer);
- a value migration run inside `upgrade`, which is recorded as the upgrade;
- members signing in to the public site, which are visitors rather than
  editors.

## When an entry is written

**Document writes commit their entry with the change** (story 171). The entry
is written inside the change's own transaction, so a page change without its
entry cannot happen. If the entry cannot be written, the change fails with it,
because both live in the same database.

**Everything else is written after the change** it records has been
committed. That covers media, people, settings, sign-ins and the command
line's own entries. If writing it fails, the failure is logged and the response
goes out as it would have. Failing the request would tell the editor the change
did not happen when it did.

## Reading it

**A page's Info tab** (and media, elements and blueprints) uses Umbraco's
`GET …/{id}/audit-log`, answered from the log (`handlers/audit-log.ts`). Actions
map to Umbraco's `AuditTypeModel`:

| Actions | Shown as |
| --- | --- |
| `Create` | `New` |
| `Trash`, `Restore` | `Move`, with a comment |
| `SetPublicAccess` | `PublicAccess` |
| anything without an Umbraco equivalent | `Custom`, with the action as the comment |

The log starts empty when migration 033 runs. Existing history was not copied
in. For the time before the log began, an item's versions stand in for its
entries, as they did before there was a log. Those are its saves, publishes and
rollbacks with who made them. The cut-over is when migration 033 was applied,
read from `migration_history`. Stand-ins age out under the same retention as
entries. Version cleanup can still remove them earlier, as it always could.

**The Audit log dashboard** in Settings
(`packages/backoffice-host/plugin/audit-dashboard.js`) lists every entry, newest
first. It filters by person, by kind (the category), by words in the item's or
person's name, and by date. It reads
`GET <backoffice>/crombolo/api/audit` and `GET …/audit/users`, which answer
only users with the Settings section. The dashboard names who signed in from
where, and every change made, so it is gated as the Settings screens are. Any
other method on those paths answers 405.

Umbraco's current Management API has no per-user audit operation (the
`/audit-log` endpoints of older versions are gone). So "what did this person
do" is the dashboard's *Who* filter.

## Retention

`CROMBOLO_AUDIT_RETENTION_DAYS` (default `365`) is how long an entry is kept.
An hourly job (`runAuditRetention` in `packages/server/src/jobs.ts`) deletes
older entries, on every node that runs jobs. The delete is idempotent, so
several nodes doing it is harmless. `0` keeps everything.

A year is the default because without one, a stream of failed sign-ins (one
entry each) would grow the table without bound. It is still long enough to
answer for a change made last season. Umbraco's own item log is scrubbed after
a day by default, which is too short to be an audit trail.
