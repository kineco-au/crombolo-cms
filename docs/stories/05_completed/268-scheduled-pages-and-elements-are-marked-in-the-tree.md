# 268 — Scheduled pages and elements are marked in the tree

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** 029, 266

## Story

As an editor, I want a page or element that is scheduled to go live or come
down to be marked in the tree and the list view, so that I can see what is
due without opening each one.

## Context

Found 2026-11-05. Umbraco's client draws an entity sign for items whose
`flags` include `Umb.ScheduledForPublish` (`documents/documents/entity-sign/
has-schedule/manifests.ts`, `elements/entity-sign/manifests.ts`), on the item
and on each variant. The server answers `flags: []` everywhere (39 places in
`packages/api-management/src/handlers/`), so a scheduled page looks like any
other.

## Acceptance criteria

- [x] Document and element tree, item, collection and search answers carry
      `Umb.ScheduledForPublish` on the item and on each variant with a
      pending schedule, read with the page rather than per item.
- [x] The flag clears when the schedule runs or is removed.
- [x] The flags are built in one place, so another sign can be added later.
- [x] Tests on both engines.

## Implementation

- `DocumentTreeItem` variants carry `scheduledForPublish`, read by
  `DocumentRepository.treeItems` with one query a page for the pages' pending
  `Release` schedules. A schedule that only takes a page down is not flagged,
  as in Umbraco: the sign means a publish is to come.
- `packages/api-management/src/handlers/flags.ts`: `variantFlags` gives
  `Umb.ScheduledForPublish` to a variant scheduled for publish (from a tree
  item, or from a document's `scheduledPublishDate`), and `itemFlags` the item
  everything its variants carry. Another sign is added there.
- Documents' tree, item, ancestor and search answers, the list view, the
  document itself and its versions, and the Library's tree, items and
  elements, send them. The recycle bin does not: nothing there is scheduled.
- The flag clears with the schedule, which scheduled publishing claims as it
  runs it.
- Tests: `tests/content-editing.test.ts` (tree, items, list view, document,
  an unpublish-only schedule, and the flag gone after the job),
  `tests/elements.test.ts` (the Library tree).
