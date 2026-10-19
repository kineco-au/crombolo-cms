# 029 — Scheduled publishing through approval

**Epic:** C — The backoffice, end to end · **Priority:** could · **Size:** M
**Depends on:** 028

## Story

As an editor under an approval workflow, I want to say when the page should go
live (or come down) as I send it for approval, so that an approved change
publishes at the agreed time rather than the moment the last approver clicks.

## Context

Story `028` publishes when the last stage approves, and refuses a scheduled
publish of a covered page by someone who may not skip the workflow. Umbraco
Workflow's "Allow scheduling" setting lets a request carry a time. Scheduling
itself exists: `DocumentRepository.setSchedule` and the scheduled-publish job.

What 028 leaves open:

- **The job publishes the draft as it is at that moment.** It calls
  `documents.publish(key, cultures)` (`packages/server/src/jobs.ts`), the same
  as approval's `finish`. Approval only publishes "the version that was sent"
  because `on-edit` guards the draft while the request is `waiting`. When a
  request is finished, nothing guards the draft any more. So if approval just
  wrote a schedule and closed the request, an edit made before the time would
  go out unapproved.
- **`approval_request` has nowhere to keep a time.** Its columns are
  `cultures`, `action`, `event_id`, the workflow and its version, `state` and
  the dates (`packages/data/src/schema/approvals.ts`, migration 038).
- **The workflow writer always writes every setting**
  (`packages/schema/src/workflows.ts`), and `workflowVersion` hashes that
  output. If a new setting were always written, every existing workflow's
  version would change on upgrade, and every request in flight would run its
  `on-change`.
- **Nothing ties a `content_schedule` row to a request.** A row can also be
  removed by other paths: the recycle bin, the CLI's `publish` support, or a
  transfer import calling `setSchedule`.

## Decisions (2026-10-19)

- **A request stays open until it publishes.** Approval with a future time
  moves the request to a new `scheduled` state and writes the schedule.
  `on-edit` keeps applying until the time comes:
  - `withdraw`: the request is withdrawn and its schedule rows cleared;
  - `lock` and `lock-after-first-approval`: the save is refused;
  - `approve-latest`: the edit goes out at the time, and the request's history
    says so.

  An administrator's edit goes through and is recorded, as in 028. Scheduled
  requests show under *In flight*, with their time.
- **The times live in a new column**, `approval_request.schedule`: nullable
  JSON, an array of `{ culture, publishTime, unpublishTime }`. It ships in
  migration 044 with `release: '0.20.0'`, so `bun run release:version 0.20.0`
  comes first.
- **Someone allowed to skip the workflow can override a scheduled request.**
  If they publish, unpublish or reschedule the page directly while a request is
  `scheduled`, the request closes as `superseded`. Its history names who did it
  and what they did, and the schedule stays as they set it.
- **The Workflow tab asks for one publish time and one unpublish time**, both
  optional, applied to every culture sent. Per-culture times are possible
  through the API only. This matches 028's limit that the tab sends the whole
  page.

## Acceptance criteria

- [x] A request can carry a publish or unpublish time, per culture, when the
      workflow allows it (a per-workflow setting).
- [x] Approval writes the schedule instead of publishing; the job publishes at
      that time, and not before.
- [x] A time that has passed by the time of approval publishes at once, and
      says so in the request's history.
- [x] Approvers see the requested time, and may approve or send back; changing
      the time is a new request.
- [x] Until a scheduled request publishes, saving the page does what the
      workflow's `on-edit` says, and an administrator's edit is recorded.
- [x] A direct publish, unpublish or reschedule by someone allowed to skip the
      workflow closes the scheduled request as superseded, with a history entry.
- [x] Withdrawing a scheduled request clears the schedule it wrote.
- [x] A scheduled page that cannot be published when its time comes goes back
      to its editor with the reason.
- [x] Workflows without the setting keep their version, so upgrading changes no
      request in flight.

## Plan

1. **Version first.** Run `bun run release:version 0.20.0`, so migration 044's
   `release` names a version that exists (`tests/migrations.test.ts`).

2. **The setting.**
   - `SchemaWorkflow.scheduling: boolean` in `packages/core/src/workflows.ts`.
   - The parser reads `scheduling` (default `false`). The canonical writer
     leaves it out when it is `false`, so existing files and their
     `workflowVersion` are unchanged.
   - Add it to the allowed keys and to `docs/workflows.md`'s settings table.
   - The designer's *Settings* tab gets a toggle: "Requests can say when to
     publish".

3. **The record.**
   - Migration 044 (`packages/data/src/schema/approval-schedules.ts`, `kind:
     'expand'`, from `STATE_` of 043) adds `approval_request.schedule`.
   - `ApprovalState` gains `scheduled` and `superseded`.
   - `ApprovalHistoryKind` gains `scheduled` (approval wrote a schedule) and
     `superseded`.
   - `ApprovalRequest.schedule: ScheduleEntry[] | null`. `create` takes it.
   - `ApprovalRepository`:
     - `waitingFor` becomes `openFor(nodeKey)`: `waiting` or `scheduled`.
     - `waiting()` and `finished()` treat `scheduled` as in flight.
     - `scheduledFor(nodeKey)` is new.
     - `setState` leaves `finished_at` null for `scheduled`.
   - `waitingUnder`, which `on-change` uses, stays `waiting` only. A scheduled
     request is already decided, so a workflow change leaves it alone.

4. **Sending.** `send(principal, key, action, cultures, comment, schedule?)`
   refuses:
   - any time when the workflow's `scheduling` is off;
   - a time that is not in the future;
   - an unpublish time not after its publish time;
   - a culture outside the request's cultures;
   - a publish time on an unpublish request.

   The page is already open (waiting or scheduled) → refused, as now. The
   message on a scheduled page says to withdraw first to change the time. The
   `sent` history entry and the approvers' e-mail name the time.
   `approvals-api.ts` send accepts `schedule`.

5. **Approving.** When `settle` completes a request that carries a schedule:
   - Entries whose publish time (or, for an unpublish request, unpublish time)
     is still ahead go to `setSchedule`. Any unpublish time on a publish request
     is written alongside its publish time. The request becomes `scheduled` and
     its history gets `scheduled` with the time.
   - Entries already past are published at once through `finish`, with a
     history comment: "the requested time had passed when it was approved".
   - When some entries are past and some are ahead, the past cultures publish
     now and the request stays `scheduled` for the rest.
   - Without a schedule, nothing changes from 028.

   As in 028, schedules are written after the transaction commits, because
   `setSchedule` takes the tree lock.

6. **Edits while scheduled.**
   - `beforeSave` and `afterSave` use `openFor`.
   - On a `scheduled` request:
     - `withdraw` → `withdrawn`, and its schedule rows are cleared (only the
       cultures the request covers);
     - `lock` and `lock-after-first-approval` → refused, with a message naming
       the time;
     - `approve-latest` and administrators → `edited` history, and the request
       goes on.
   - `withdraw()` on a scheduled request clears its schedule rows too.

7. **The job.** `runScheduledPublishing` gets an optional
   `onScheduledPublished(key, culture, action, result)` hook. The approvals
   engine supplies it when wired in `ports.ts`/`server.ts`. For a node with a
   `scheduled` request:
   - success → a `published`/`unpublished` history entry for that culture.
     When none of the request's release times (expire times for an unpublish
     request) are still ahead, the request becomes `approved`. Then the editor
     is e-mailed, an audit entry is written ("Published on approval, as
     scheduled"), and the content notification is raised, as `finish` does.
   - `PublishBlockedError` → the request is `sent-back` with the reason and the
     editor is e-mailed, as in `finish`.
   - A request's unpublish time on a publish request doesn't keep it open. It
     is an ordinary schedule row once the page is live.
   - **Sweep:** a `scheduled` request whose release times have all passed with
     no `content_schedule` rows left, and no `published` entry for them, closes
     as `withdrawn` with "the schedule was removed". This covers the recycle
     bin, the CLI and imports, without hooking each of them.

8. **Supersede.**
   - `Approvals.afterDirectPublish(principal, key, what)` is called by the
     document handlers after a successful `PutDocumentByIdPublish` (immediate
     or scheduled), `PutDocumentByIdUnpublish` and branch publish. The gate has
     already passed by then, so the caller is allowed to skip.
   - A `scheduled` request on that page → `superseded`, with history and an
     audit entry.
   - The job's own publishes don't call it.
   - `ApprovalGatePort` gains the method. The document port in tests and the
     remote conformance stubs gain a no-op.

9. **The view and e-mail.**
   - `RequestView.schedule` is the entries, as ISO strings.
   - `can.withdraw` covers `scheduled`.
   - Approval e-mails and the "approved" e-mail say "will be published at …"
     instead of "is now published".

10. **The backoffice.**
    - **Workflow tab:** when the covering workflow has `scheduling`, *Send for
      approval* opens optional *Publish at* and *Take down at* fields
      (`uui-input type="datetime-local"`, sent as UTC). *Request unpublish*
      offers *Take down at*. A waiting or scheduled request shows its time
      ("Publishes 3 Nov, 9:00"), and a scheduled one says it is approved and
      waiting for its time, with *Withdraw*.
    - **Workflows section lists:** a "When" column. *In flight* shows scheduled
      requests marked as such.
    - Times show in the reader's local time, with the time zone named.

11. **Tests** (`tests/approvals.test.ts`, `tests/workflows.test.ts`,
    migrations):
    - the setting parses, and the writer leaves it out when off;
    - an unchanged version for a workflow file without it;
    - send refusals (setting off, past time, culture outside the request,
      unpublish before publish);
    - approval with a future time → `scheduled`, schedule rows written, not
      published; then `runScheduledPublishing(after)` publishes and closes it;
    - a past time → published at once, with the history comment;
    - mixed cultures;
    - each `on-edit` mode while scheduled, and an administrator's edit;
    - withdraw clears the rows;
    - a direct publish and a reschedule by a skipper supersede it;
    - the job's `PublishBlockedError` sends it back;
    - the sweep after the page goes to the recycle bin;
    - an unpublish request with a time;
    - `on-change` leaves scheduled requests alone;
    - migration 044 on both dialects, and upgrade from 0.19.0.

    Postgres runs too: the data layer changes.

12. **Docs.**
    - `docs/workflows.md`: the setting, the scheduled state, edits and
      overrides while scheduled, and the job's part. Remove the "Still to come"
      line.
    - `docs/data-model.md`: the column.
    - Story 028's two "story `029`" pointers.

## Known edges

- **Times are stored and compared in UTC.** The tab shows local time with its
  zone named. A server whose clock is wrong publishes at the wrong time, as
  any schedule does.
- **The job's minute interval** (`scheduledPublishingMs`) means "at that time"
  is within a minute of it, as for any schedule.

## Out of scope

- Changing the time on an approved request. That is a new request: withdraw
  it, then send it again with the new time.
- Per-culture times on the tab.
- Recurring or relative times ("in two days").

## Implementation

- **The setting** — `SchemaWorkflow.scheduling` (`packages/core/src/workflows.ts`).
  `packages/schema/src/workflows.ts` parses it and writes it only when on, so
  `workflowVersion` is unchanged for files without it. The designer's
  *Settings* tab has a toggle: "Requests can say when to publish".
- **The record** — migration 044 (`packages/data/src/schema/approval-schedules.ts`,
  `release: '0.20.0'`) adds `approval_request.schedule`. `ApprovalRepository`
  has:
  - the states `scheduled` and `superseded`;
  - the history kinds `scheduled` and `superseded`;
  - `openFor` (waiting or scheduled) in place of `waitingFor`;
  - `open()` and `scheduled()`.

  `finished()` excludes open requests. `waitingUnder`, which `on-change` uses,
  still sees only `waiting` ones.
- **The engine** — `packages/server/src/approvals.ts`:
  - `scheduleRefusal` (pure) checks a request's times as it is sent.
  - `finish` publishes what is due now and schedules the rest through
    `DocumentRepository.setSchedule`, after the transaction commits.
  - `beforeSave`, `afterSave` and `withdraw` cover scheduled requests.
  - `afterDirectPublish` supersedes a scheduled request.
  - `scheduleFired` and `sweepScheduled` are called by the schedule job.

  The sweep allows five minutes of grace for a row the job has claimed but
  not yet reported.
- **The job** — `JobsOptions.approvals`. `runScheduledPublishing` reports each
  schedule it fires, whether it succeeded or failed, then sweeps.
- **The gate** — `ApprovalGatePort.afterDirectPublish` (optional). The document
  handlers call it after a publish, a schedule, an update-and-publish, an
  unpublish, and for each page a branch publish published.
- **API** — `send` accepts
  `schedule: [{ culture, publishTime, unpublishTime }]`. Views carry
  `schedule`. The designer's affected-requests preview passes over scheduled
  requests.
- **Backoffice:**
  - The Workflow tab has *Publish at* and *Take down at* fields, one time for
    the whole page, shown when the workflow allows it. A request shows its
    time, and a scheduled one can be withdrawn.
  - The lists have a *When* column.
  - Times are formatted in `plugin/workflow-time.js`.
- **Tests:**
  - `tests/approvals.test.ts`, the scheduled-publishing block:
    - refusals;
    - schedule then publish at the time;
    - a time already passed when approved;
    - a take-down alongside a publish;
    - an unpublish request with a time;
    - `withdraw`, `lock` and `approve-latest` while scheduled, and an
      administrator's edit;
    - withdraw then send again;
    - superseded by a direct publish;
    - a blocked publish going back to the editor;
    - the recycle bin;
    - a schedule cleared another way;
    - a workflow change.
  - `tests/workflows.test.ts`: the setting, and an unchanged version without it.
  - The migration undo, and an upgrade from 0.19.0.
- **Docs** — `docs/workflows.md` ("A time on a request") and
  `docs/data-model.md`.

### Limits

- The tab sets one time for the whole page. Per-culture times are possible
  through the API only.
- A page moved to the recycle bin ends its scheduled request the next time the
  job runs, not at the moment it is binned.
