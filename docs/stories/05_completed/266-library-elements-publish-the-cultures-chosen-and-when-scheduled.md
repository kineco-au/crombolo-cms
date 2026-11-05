# 266 — Library elements publish the cultures chosen, and when scheduled

**Epic:** C — The backoffice, end to end · **Priority:** must · **Size:** S
**Depends on:** 027

## Story

As an editor in the Library, I want publishing one language of an element to
publish only that language, and scheduling one to wait for its date, so that
an element does not go live before it is ready.

## Context

Found 2026-11-05 in a sweep of what the back office sends against what the
server reads. The client publishes an element with `{ publishSchedules: [{
culture, schedule }] }` (`elements/publishing/repository/
element-publishing.server.data-source.ts`), the same shape as a document.
`PutElementByIdPublish` reads only `cultures` or `culturesToPublish`
(`readCultures` in `packages/api-management/src/handlers/element.ts`), finds
neither, and passes `null`, which publishes every culture now. So:

- publishing one language of a multilingual element publishes all of them;
- "Schedule…" on an element publishes it at once, and no schedule is kept;
- the element's variants always report `scheduledPublishDate` and
  `scheduledUnpublishDate` as `null`.

The handler's header says elements have no schedules, but Umbraco 18's client
offers them. Documents already read `publishSchedules` (`document.ts`), and
scheduled publishing runs as a job (story `029`, `187`).

## Acceptance criteria

- [x] Publishing reads `publishSchedules`: only the cultures named are
      published, and the invariant variant when the culture is `null`.
- [x] A schedule with a publish or unpublish time is kept, not acted on now;
      the scheduled-publishing job publishes or unpublishes it at that time,
      on one node of a cluster.
- [x] An element's variants report their scheduled dates, so the Schedule
      dialog reopens with them.
- [x] A publish time already past publishes now, as a document's does, and a
      date that does not parse is refused.
- [x] Tests on both engines: one culture of two, a schedule kept and then run,
      and a schedule cleared.

## Implementation

- `PutElementByIdPublish` (`packages/api-management/src/handlers/element.ts`)
  reads `publishSchedules` with the document handler's `readSchedules`, and
  `readCultures` takes the cultures from it, so a `null` culture means the
  invariant variant. A date that does not parse answers 400; a schedule kept
  without publishing says "Publishing scheduled".
- `ElementPort.publish` takes the schedules (`PublishSchedule`,
  `ports-content.ts`). The adapter (`packages/server/src/adapters/elements.ts`)
  follows the document operation: entries with a publish time still to come
  are kept with `setSchedule`, the rest publish now, both in one
  `repo.atomically` transaction.
- Element variants report `scheduledPublishDate` and `scheduledUnpublishDate`
  from the stored schedule, which the repository already read for every kind.
- Scheduled publishing (`packages/server/src/jobs.ts`) also claims the due
  schedules of elements (`DocumentRepository` with `kind: 'element'`) and
  publishes or unpublishes them through an element port, so one node of a
  cluster runs each. Elements have no approvals or redirects to tell.
- Tests (`tests/elements.test.ts`): one culture of two, a schedule kept,
  reported, released and expired once each, a schedule cleared, a time past,
  and a date that does not parse. The mandatory language still has to be
  published with any other, as for documents.
