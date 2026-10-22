# 171 — Published changes reliably reach subscribers

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** XL (outbox, media, queue tooling, cache instructions)
**Depends on:** 170, 044, 045

## Story

As a site owner relying on webhooks and content notifications, I want every
committed content change to retain its notification work through a restart,
so that downstream systems do not silently miss a change.

## Context

The architecture review scored transactions, concurrency and side effects
**2.5/5**. Delivery queues already persist work and retry it. The gap precedes
those queues: callbacks in `packages/server/src/server.ts` call `webhooks.raise`
and `notifier.raise` after the content operation has committed. Jobs and CLI
publishing have their own follow-up paths. A crash between commit and enqueue
can lose a notification even though the content changed.

Document publishing already records its cache instruction inside the content
transaction. The candidate is a transactional outbox: persist an event with
the mutation, then dispatch it to delivery queues. External delivery remains
at least once; a remote receiver cannot join the database transaction.

## Decisions (2026-10-22)

- **A transactional outbox.** Every document and media write records its event in
  a new `content_event` table **in the same transaction as the change**. A
  dispatcher turns each event into webhook deliveries and content notifications
  and marks it dispatched, in one transaction. Delivery to receivers stays at
  least once.
- **Facts at commit, subscribers at dispatch.** The event stores what was true
  when it committed: the content type, published state, name, path, cultures,
  the number of pages in a branch, and the actor. Webhook subscribers and
  notification subscriptions (with the reader's permission check) are resolved
  when the dispatcher runs, usually seconds later. The after-commit re-check that
  drops a publish quickly followed by an unpublish (`eventHappened`) goes.
- **The audit entry commits with the change.** For document and media writes
  the entry is written inside the transaction, named from inside it. That
  replaces "writing never fails the change" for these writes: a failed insert on
  the same database fails the change. Other audit sources are unchanged.
- **Scope beyond document writes** (all agreed):
  - *webhook queue gaps*: release deliveries stuck `running` by a node that died,
    prune old delivery and log rows, and retry a failed delivery on request;
  - *queue visibility*: pending, retrying and failed work across the outbox,
    webhooks and notifications, from the command line and as a health check;
  - *media webhooks*: `MediaSave` and `MediaDelete` move from the router onto
    the outbox, recorded in the media write's transaction;
  - *cache instruction cleanup*: `cache_instruction` is pruned, and the poller
    stops being able to miss a row that commits out of id order on Postgres.

## Findings (2026-10-22)

How it works today, after story 170:

- `events.emit` runs **after** commit (`content/src/operations.ts`); the sink
  (`server/src/content-events.ts`) awaits the audit write, then calls
  `webhooks.raise` and `notifier.raise` without awaiting them. A crash, or the
  CLI closing its database in `finally` before the raises finish, loses them.
  `publishMany` emits in a loop after its transaction, so a crash part way loses
  the rest of the batch. `emptyBin` deletes one page per transaction.
- Only `createAndPublish`, `saveAndPublish` and `publishMany` use
  `repo.atomically`; other repository writes open their own transaction, and a
  scheduled publish is two (`setSchedule`, then `publish`).
- **Webhooks** (`server/src/webhooks.ts`, migration 035): `raise` reads the type
  and published state after commit, picks subscribers, and inserts one
  `webhook_delivery` row each with a fresh id and no unique key, so a second
  raise duplicates. Claims are `UPDATE … WHERE state='pending' RETURNING`.
  **Nothing releases a row left `running`**, nothing prunes `webhook_delivery`
  or `webhook_log`, and `failed` is final. Receivers get `Webhook-Delivery` (the
  row id), `Webhook-Event`, `Webhook-Retry-Count` and `Webhook-Id`.
- **Content notifications** (`server/src/content-notifications.ts`, migration
  043): resolved and inserted after commit, nothing queued without e-mail, no
  dedup key; `releaseStale` after 15 minutes and a 30-day prune exist.
- **Cache instructions** are written inside the document transactions but not
  for media, elements, domains or views; nothing prunes the table; each node
  reads `id > cursor`, which can skip an id that commits after a higher one.
- **Jobs** share one `running` flag per node (`jobs.ts` `guarded`), so a slow
  webhook run skips scheduled publishing ticks and the reverse. Claims are
  row-level; there are no leases.
- Other raisers: the router still raises `MediaSave` / `MediaDelete` after the
  response; `ports.ts` raises the page-permissions notification after commit;
  `jobs.ts` keeps a legacy publish path that raises its own. Transfer imports
  raise nothing (unchanged here). The backoffice's empty bin raises no webhook
  while the CLI's raises `ContentDelete` per page.
- Nothing shows the queues: Umbraco's webhook log shows attempts only.
- Docs drift: `docs/operations.md` still says the router raises notifications;
  `docs/architecture.md` describes a `core/notifications` bus that does not exist.

## Plan

1. **Characterise.** Tests pinning what each write records and raises today,
   per entry point, including the empty-bin difference, so every change below
   is a named test.
2. **Schema (migration 046).** `content_event`: id, event id (uuid, unique),
   kind, entity type and key, facts (JSON, versioned with `v`), actor (JSON),
   occurred at, state (`pending | running | dispatched | failed`), attempts,
   last error, run after, dispatched at. `webhook_delivery` and
   `content_notification` gain `event_id` with unique keys
   `(event_id, subscriber)` and `(event_id, recipient_user_key, action_id)`.
   Its `release` is the next version, set with `bun run release:version` when
   it ships (AGENTS.md).
3. **Recording in the transaction.** `EventSink` splits into `record(tx, event,
   actor)` — the audit entry and the `content_event` row, inside the change's
   transaction — and `afterCommit(event)` for the live backoffice and a nudge to
   the dispatcher. Every operation writes and records inside one
   `repo.atomically`, including schedule-then-publish, `publishMany` (events
   inside), `emptyBin` (one transaction for the bin), domains and public access.
   Facts are read inside the transaction. Media writes record `MediaSave` /
   `MediaDelete` the same way in the media adapter; the router's media mapping
   and its after-response raise go. The page-permissions notification records
   through the outbox. The legacy publish path in `jobs.ts` is removed.
4. **The dispatcher.** A job (15 s, plus the after-commit nudge) claims pending
   events (`UPDATE … RETURNING`, stale claims released after 15 minutes),
   resolves subscribers, inserts deliveries and notifications with
   `ON CONFLICT DO NOTHING`, and marks the event dispatched in the same
   transaction. A crash anywhere repeats the step, and the unique keys absorb
   the repeat. An event that keeps failing goes `failed` after the shared
   back-off. Receivers keep `Webhook-Delivery`, now one per event and webhook,
   and gain `Webhook-Event-Id` to deduplicate across webhooks.
5. **Webhook queue gaps.** `releaseStale` for `webhook_delivery`; prune `done`
   deliveries, dispatched events and `webhook_log` after 30 days (configurable,
   in code or as an environment variable); failed work kept until retried or
   cleared.
6. **Jobs.** One guard per job instead of one per node, so the dispatcher, the
   webhook runner and scheduled publishing never skip each other's ticks.
7. **Visibility.** `crombolo events` lists counts and the oldest item per queue
   (outbox, webhooks, notifications) by state; `crombolo events failed` lists
   them with their last error; `crombolo events retry <id> | --failed` puts them
   back. A diagnostics health check warns when pending work is older than a
   threshold or failed work exists.
8. **Cache instructions.** Media, elements, domains and view changes write
   theirs in their transaction where they have one. Rows older than a day are
   pruned hourly (nodes start from the latest at boot). The poller re-reads a
   short trailing window behind its cursor and skips ids it has applied, so a
   row committed out of order is not missed.
9. **Corrections.** The CLI no longer loses announcements by closing the
   database early. Both empty-bin paths raise `ContentDelete` per page.
   `docs/operations.md` and `docs/architecture.md` drift fixed.
10. **Docs.** `docs/webhooks.md` (delivery semantics, identities, retention,
    retry), `docs/audit-log.md` (when an entry commits), `docs/operations.md`
    (the queues, `crombolo events`, recovery), `docs/architecture.md` (the
    outbox), and the README's pointer.

Tests run on SQLite and Postgres throughout. They inject failures at each step
named in the criteria: rollback, after the deliveries are inserted but before
the event is marked, exhausted retries, and two dispatchers claiming at once.

## Acceptance criteria

- [x] Shared operations record required events in the content transaction;
      rollback leaves neither the mutation nor its events committed.
- [x] HTTP, CLI and scheduled publishing use this path without independently
      enqueueing the same webhook or content notification.
- [x] A crash after commit but before dispatch leaves work recoverable on restart.
- [x] Retries and concurrent workers cannot create duplicate logical queue
      entries; deliveries carry a stable identity for receiver deduplication.
- [x] Tests cover failure after downstream enqueue but before recording dispatch,
      transaction rollback, retry exhaustion and concurrent claims.
- [x] Event facts remain stable across later edits or unpublishing; subscription
      semantics are documented and tested.
- [x] Pending, retrying and failed work is observable, with documented recovery
      and bounded cleanup.
- [x] SQLite and Postgres tests cover the guarantees; README and relevant
      architecture docs explain delivery semantics and operation.

## What was built

- **Migration 046 (`AddContentEvents`, 0.24.0).** It adds a `content_event`
  table. `webhook_delivery` and `content_notification` gain `event_id`, with
  unique keys `(event_id, subscriber)` and
  `(event_id, recipient_user_key, action_id)`. All three rewinds are updated:
  `tests/support/db.ts`, `tests/upgrade-from-release.test.ts` and
  `tests/integration/first-boot.integration.ts`.
- **Recording.**
  - `EventSink` is now `record(tx, event, actor)` plus an optional
    `afterCommit`.
  - The operations write through a `commit` helper. It runs the write and
    `record` inside one `DocumentRepository.atomically` (which now also hands
    over the transaction's `Db`).
  - That covers every operation: schedule-then-publish, `publishMany`, empty
    bin, domains (with its cache instruction) and public access.
  - The server's sink (`content-events.ts`) writes the audit entry and the
    outbox row in that transaction. Facts are read there:
    `WebhookService.factsFor` and `ContentNotifier.factsFor`.
  - After the commit, `afterCommit` refreshes the live backoffice and nudges
    the dispatcher.
- **The dispatcher** (`content-dispatch.ts`):
  - It claims each event, enqueues with `ON CONFLICT DO NOTHING` through
    `enqueueFor`, and marks the event dispatched in one transaction.
  - It retries on the shared back-off, then keeps the event as failed.
  - A stale claim is released after 15 minutes.
  - A commit nudges it, and the jobs also run it every 15 seconds. The webhook
    and notification jobs dispatch first.
- **Media.** `MediaSave` and `MediaDelete` are recorded in the media write's
  transaction, with its cache instruction. The router's webhook mapping and
  `onWebhookEvent` are gone.
- **Other changes:**
  - The page-permissions notification goes through the outbox.
  - The legacy publish path in `jobs.ts` is removed; `operations` is required.
  - The after-commit re-check (`eventHappened`) is removed.
- **Queues:**
  - `releaseStale`, `retry`, `prune` and `failed` on webhook deliveries;
    `retry` and `failed` on notifications.
  - Hourly upkeep releases stale deliveries and prunes delivered work and
    dispatched events after `CROMBOLO_EVENT_RETENTION_DAYS` (30 by default).
    It also prunes cache instructions older than a day, keeping the newest.
  - Deliveries send `Webhook-Event-Id`.
- **Jobs:** one guard per job instead of one per node.
- **Cache instructions:** the poller re-reads 100 ids behind its cursor and
  skips the ones it has seen, so a row that commits out of order is not
  missed.
- **Visibility:**
  - `crombolo events status`, `crombolo events failed` and
    `crombolo events retry <id> | --all`;
  - the **Outgoing changes** health check (`outgoingResults`).
- **Corrections:**
  - The CLI's announcements no longer race its database closing: they are
    recorded in the transaction.
  - The backoffice's empty-bin records a delete per page, as the CLI's does.
- **Tests:** `tests/content-events.test.ts` covers:
  - recording with the change;
  - rollback leaving nothing;
  - facts at commit (a publish undone before dispatch still goes out);
  - media;
  - a crash after queueing but before marking;
  - two dispatchers racing;
  - exhausted retries and retry;
  - stale claims;
  - pruning;
  - cache instruction pruning;
  - the health check.
- **Docs:** `docs/webhooks.md` ("Delivery", headers, keeping and recovering),
  `docs/audit-log.md` ("When an entry is written"), `docs/operations.md`,
  `docs/architecture.md` (the outbox, replacing a notification bus that never
  existed), and `docs/configuration.md` (generated).
- **Not changed:**
  - The audit entries for media, people and settings are still written after
    the change.
  - Elements and view changes write their cache instruction after their
    change.
  - Transfer imports still raise no events.
  - Delivery to receivers is at least once, not exactly once.

## Out of scope

Replacing webhook or email transports, requiring an external broker, or making
visitor requests wait for external delivery.
