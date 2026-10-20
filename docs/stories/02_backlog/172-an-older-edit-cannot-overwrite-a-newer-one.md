# 172 — An older edit cannot overwrite a newer one

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** M
**Depends on:** 170, 081

## Story

As an editor working on a page alongside someone else, I want to be told when
my copy is out of date before saving it, so that I cannot silently overwrite
their newer work.

## Context

Story 081 protects database operations with tree locks and bounded waits. That
protects tree and value invariants, but does not establish whether submitted
values were based on the current document version. The inspected
`SaveDocumentInput` in `packages/data/src/repositories/documents.ts` has no
expected-version field.

This closes part of the **2.5/5** concurrency assessment. The candidate is
optimistic concurrency: reads supply a revision that writes atomically check.
Broader lock changes should follow separate contention evidence.

## Decisions before implementation

- Agree revision granularity and which save, publish, rollback, move and schema
  changes invalidate an editing revision.
- Establish how the vendored backoffice sends revisions and presents conflicts
  without losing local work; check the upstream contract before extending it.
- Define behavior for trusted system operations and clients without revisions;
  omission must not silently defeat the protection.

## Acceptance criteria

- [ ] Editable reads expose the revision required by the agreed write contract.
- [ ] Shared operations compare it atomically with the write; a stale request
      changes no content and emits no success event.
- [ ] Two edits based on the same revision cannot both replace the document
      successfully without explicit reconciliation.
- [ ] The backoffice explains the conflict in plain language and preserves the
      editor's work while they obtain the current version.
- [ ] CLI and scheduled operations follow the documented concurrency policy
      through the same application boundary, including appropriate retries.
- [ ] Tests cover stale saves, relevant publish and rollback races, culture
      behavior and missing revisions on SQLite and Postgres.
- [ ] Tree-integrity protection remains effective; clients and extension authors
      have documentation for the concurrency contract.

## Out of scope

Real-time collaboration, automatic text merging, or replacing tree locks as
part of introducing edit-conflict detection.
