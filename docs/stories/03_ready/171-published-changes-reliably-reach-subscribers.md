# 171 — Published changes reliably reach subscribers

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** L
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

## Decisions before implementation

- Agree event ownership, payload versioning, ordering and when subscriber
  selection and content facts are captured.
- Define stable event identities, retries, retention and failed-event recovery;
  do not promise exactly-once HTTP delivery.
- Agree which audit facts commit with the change and how transactional cache
  instructions relate to these events.

## Acceptance criteria

- [ ] Shared operations record required events in the content transaction;
      rollback leaves neither the mutation nor its events committed.
- [ ] HTTP, CLI and scheduled publishing use this path without independently
      enqueueing the same webhook or content notification.
- [ ] A crash after commit but before dispatch leaves work recoverable on restart.
- [ ] Retries and concurrent workers cannot create duplicate logical queue
      entries; deliveries carry a stable identity for receiver deduplication.
- [ ] Tests cover failure after downstream enqueue but before recording dispatch,
      transaction rollback, retry exhaustion and concurrent claims.
- [ ] Event facts remain stable across later edits or unpublishing; subscription
      semantics are documented and tested.
- [ ] Pending, retrying and failed work is observable, with documented recovery
      and bounded cleanup.
- [ ] SQLite and Postgres tests cover the guarantees; README and relevant
      architecture docs explain delivery semantics and operation.

## Out of scope

Replacing webhook or email transports, requiring an external broker, or making
visitor requests wait for external delivery.
