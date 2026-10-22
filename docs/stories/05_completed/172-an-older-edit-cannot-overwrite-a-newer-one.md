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

## Decisions (2026-10-22)

- **An HTTP precondition: ETag and If-Match.** `GET /document/{id}` answers
  with an `ETag` naming the page's revision. A write that replaces the draft
  sends it back in `If-Match`, and the write compares it **inside the tree
  lock**. A mismatch is `412 Precondition Failed` and changes nothing. The
  headers sit outside the vendored contract, which has no way to describe them.
  `docs/api-contract.md` ("No ETag, no If-Match, no concurrency tokens
  anywhere… Do not invent them") and `docs/features.md` change to say so.
- **The whole page is the unit.** Any save, publish or rollback since the
  editor's copy was read refuses their save. Per-language checks would not be
  safe: the backoffice re-sends the languages the editor did not select from the
  copy it loaded at open, and a save replaces every value.
- **No revision: users refused, the site exempt.** A user's draft-replacing
  write without `If-Match` is `428 Precondition Required`, with a plain reason.
  The command line and system actors (the schedule, approvals, forms, imports,
  revert) take the lock and act on the current head, so they send none.
- **The backoffice explains and keeps the work.** A plain-language 412 title and
  detail, which Umbraco already shows while keeping the editor's values, plus a
  crombolo workspace banner. The banner says the page changed, keeps the
  editor's work, and offers *Open the latest version in a new tab* to compare
  side by side.

## Findings (2026-10-22)

- **Revisions.** `content_version` has one row per event (`save`, `publish`,
  `rollback`, `migrate`) and `current` on the head. The head id is an identity
  column and writes are serialised by the tree lock, so it is monotonic
  (`eventMarkers(key).head`). A publish adds an event; unpublish, move, sort,
  trash, restore and scheduling add none. **The upgrade value write
  (`appendUnderState`) appends values under the existing head**, so the head
  alone misses it. Transfer revert already uses the head id as a revision
  (`revert.ts`, "edited since").
- **`updateDate`** is the head's `version_date` for every variant: millisecond
  precision, each node's own clock, and it moves on publish. The backoffice
  already PUTs it back and the server ignores it. It was not chosen as the
  revision.
- **Contract.** No request model carries a revision; no ETag, If-Match, 412 or
  428 anywhere; `overrides.ts` can change schemas only. The server does not
  validate bodies against the schema.
- **The backoffice.** A save PUTs `{template, values, variants}`; for languages
  not selected it sends the copy loaded at open. On any error it throws before
  replacing its state, so the editor's values stay, and `UmbTryExecuteController`
  shows "An error occurred" with the problem's title and detail (401, 403 and
  404 are silent). Nothing handles concurrency. A crombolo entry point can add
  behaviour (`media-permissions.js` registers a workspace context;
  `tsx-editors.js` patches Umbraco classes; `read-only-banner.js` is a header
  banner); none adds request interceptors yet. Umbraco's own interceptors live
  in `core/resources/api-interceptor.controller.js`.
- **Other writers.** PATCH reads outside any lock, applies the patch, then does a
  full save: two concurrent PATCHes can lose one. The assistant compares a hash
  of the whole document before its PUT, which is not atomic with the write and
  trips on any `updateDate` change. Bundle import re-checks inside its lock.
  Approvals compare the head after the save commits, and an approved request
  publishes the current head, not the version that was approved. Elements,
  media, members and blueprints share `DocumentRepository.update` through their
  own ports (out of scope here).
- **409s today** come only from `WriteRejectedError` (a stale node or paused
  writes); update-and-publish titles every non-permission refusal "Could not
  publish the document".

## Plan

1. **Characterise.** Tests pinning last-write-wins today for save, update-and-
   publish, PATCH, rollback and the assistant, so each change is a named test.
2. **The revision.** `"<head event id>.<latest value id>"` for the page, read
   with the document. The second part catches the upgrade write that keeps the
   head. Exposed as `ETag` on `GET /document/{id}` and on the answers to the
   writes that change it; `DocumentRepository` gains `revisionOf(key)` and an
   `expected` revision on `update`, `updateAndPublish`, `publish` and
   `rollback`, compared after the lock is taken.
3. **The operations.** `save`, `saveAndPublish`, `publish` and `rollback` take
   `expected?: string`. For a user actor it is required on `save`,
   `saveAndPublish` and PATCH (`428` without it), and checked on `publish` and
   `rollback` when sent. A mismatch is a new refusal kind, `stale` (412), that
   writes nothing and emits nothing. Operator and system actors are exempt.
   Approvals pass the approved request's head when they publish, so a request
   approved on one version cannot publish a later one; a mismatch goes back to
   the editor as a page that changed since approval.
4. **The handlers.** Read `If-Match` and send `ETag`; 412 and 428 problem
   details in plain words ("Someone else changed this page after you opened it.
   Your changes are still here."). PATCH reads, patches and writes inside one
   lock against the revision it was sent. Update-and-publish keeps the save
   title for a stale refusal.
5. **The backoffice.** A crombolo entry point registers request and response
   interceptors on Umbraco's HTTP client. It remembers the revision a document
   workspace loaded, and replaces it only after that workspace's own save or
   publish succeeds. Other reads of the same page (the tree, a refresh by
   another component) never refresh it silently. It sends `If-Match` on the
   page's save, update-and-publish, publish and rollback. A
   `workspaceContext` / banner for the document workspace shows the conflict,
   keeps the values, and opens the latest version in a new tab.
   Characterisation first confirms which requests read `/document/{id}`, since
   the "load" a workspace remembers depends on it.
6. **The assistant** sends `If-Match` from the document it read, replacing its
   hash check, so its apply is atomic.
7. **Docs.** `docs/api-contract.md` and `docs/features.md` state the concurrency
   contract (revision format opaque, which writes need it, 412/428, who is
   exempt); a section for API clients and extension authors; `docs/workflows.md`
   for the approval change.

Tests on SQLite and Postgres: stale save, two saves from one revision (one
wins), publish and rollback races, a save in one language after another
language changed, missing revision for a user and for the system, PATCH under
concurrency, and tree integrity under the existing concurrency tests. The banner
is exercised by a browser test only if asked.

## Acceptance criteria

- [x] Editable reads expose the revision required by the agreed write contract.
- [x] Shared operations compare it atomically with the write; a stale request
      changes no content and emits no success event.
- [x] Two edits based on the same revision cannot both replace the document
      successfully without explicit reconciliation.
- [x] The backoffice explains the conflict in plain language and preserves the
      editor's work while they obtain the current version.
- [x] CLI and scheduled operations follow the documented concurrency policy
      through the same application boundary, including appropriate retries.
- [x] Tests cover stale saves, relevant publish and rollback races, culture
      behavior and missing revisions on SQLite and Postgres.
- [x] Tree-integrity protection remains effective; clients and extension authors
      have documentation for the concurrency contract.

## What was built

- **The revision.** `"<latest event id>.<latest value id>"`, read with the page
  (`DocumentAggregate.revision`, `DocumentRepository.revisionOf`). The value id
  catches an upgrade's rewrite under the same event. `update` (through
  `SaveDocumentInput.expectedRevision`), `publish` and `rollback` compare it
  after taking the tree lock and throw `StaleRevisionError`. `publish` also
  takes `expectedHead`, the event an approval was given for.
- **The operations.** `save`, `saveAndPublish`, `publish` and `rollback` take a
  `Precondition` (`expectedRevision`, or `overwrite` for `If-Match: *`) and
  answer with the new revision. New refusals: `stale` (412) and
  `revisionRequired` (428), the latter for a user's save or save-and-publish
  that names none, checked after the permission checks. Operator and system
  actors need none.
- **HTTP.** `GET /document/{id}` sends `ETag`; the writes read `If-Match` and
  answer with the new `ETag`. PATCH checks the copy it patched against the
  revision sent, and with `*` against the copy it read, so two patches cannot
  lose one. A stale save-and-publish keeps the save's title. Plain wording:
  *Someone else changed this page after you opened it…*
- **Approvals** publish with the request's event as `expectedHead`; a page
  changed since goes back to its editor ("it was changed after it was approved,
  so it needs approving again").
- **The assistant** sends the `ETag` of the copy it re-reads before applying, so
  its check and its write cannot be split; `ManagementCall` carries headers and
  the `ETag`.
- **The backoffice.** `plugin/edit-conflicts.js` (a `backofficeEntryPoint`):
  request and response interceptors on Umbraco's HTTP client, and `load` /
  `reload` on `UmbEntityDetailWorkspaceContextBase` wrapped for documents, so
  only the editor's own load sets the revision it works from. The only client
  read of `/document/{id}` is the detail data source. Its repository is also
  used by the rollback dialog, the blueprint dialog and the tree's publish
  actions, which is why another read must not refresh the revision.
  `plugin/edit-conflict-banner.js` is a workspace footer app with *Open the
  latest version in a new tab*.
- **Tests.** `tests/content-operations.test.ts`: the ETag round trip, two saves
  from one copy, 428 and `*`, stale save-and-publish, publish and rollback,
  PATCH, actors exempt, approvals, and the upgrade write moving the revision.
  `tests/edit-conflicts-plugin.test.ts` covers the tracker and the load wrapper.
  `tests/concurrency.test.ts` now expects concurrent saves from the same copy to
  be 200 or 412, never lost. The test harness sends the page's current `ETag`
  for a save that names none, as the backoffice does.
- **Docs:** `docs/api-contract.md` (the contract, replacing "no concurrency
  tokens"), `docs/features.md`, `docs/architecture.md`, `docs/workflows.md`.
- **Not covered:** elements, media, members and blueprints keep last-write-wins.
  A save in one language counts as a change to the whole page, by decision. The
  banner has no browser test.

## Out of scope

Real-time collaboration, automatic text merging, or replacing tree locks as
part of introducing edit-conflict detection.
