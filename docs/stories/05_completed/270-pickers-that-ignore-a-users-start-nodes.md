# 270 — Pickers that ignore a user's start nodes

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 022, 026

## Story

As an administrator, I want a content or media picker set to "Ignore user
start nodes" to let any editor pick from the whole tree, so that an editor
limited to one section of the site can still link to a page outside it.

## Context

Found 2026-11-05. The Content Picker, Multinode Treepicker and Media Picker
data types offer `ignoreUserStartNodes`. When it is on, the client passes the
picker's `dataTypeId` on tree, item-search and collection requests, and
Umbraco widens the tree for that data type only. The server reads no
`dataTypeId` anywhere, and nothing reads `ignoreUserStartNodes`, so the
setting does nothing; data types also answer `canIgnoreStartNodes: false`.

## Decision

- Decided 2026-11-05: as Umbraco, the picked value shows normally afterwards.
  Item lookups were never narrowed by start nodes, so nothing changes there.

## Acceptance criteria

- [x] Document, element and media trees, searches and collections honour
      `dataTypeId` when that data type has `ignoreUserStartNodes` on, and
      only then.
- [x] A `dataTypeId` naming any other data type changes nothing.
- [x] Read permission on each item still applies; only start nodes are
      ignored.
- [x] `canIgnoreStartNodes` is true for the editors whose settings offer it,
      as Umbraco's is.
- [x] Tests on both engines.

## Implementation

- `ManagementApiRouter` (`packages/api-management/src/router.ts`): for the
  thirteen operations a picker calls with `dataTypeId` (`PICKER_OPERATIONS`:
  the document, media and element trees, item searches and collections), a
  request naming a data type with `ignoreUserStartNodes` on is authorized and
  handled as the user with root start nodes. Their groups' verbs still apply,
  and no other operation, nor a `dataTypeId` naming any other data type, is
  widened. Doing it once in the router keeps authorization and the trees in
  step.
- `createManagementApiRouter` (`routes.ts`) answers `ignoresStartNodes` from
  the data type's `ignoreUserStartNodes` setting.
- `canIgnoreStartNodes` (`handlers/data-type.ts`) is true for the Content
  Picker, Multinode Treepicker, Media Picker, Multi URL Picker, Rich Text and
  Element Picker, the editors whose settings offer it.
- Tests (`tests/picker-start-nodes.test.ts`): an editor kept to one branch
  sees the root, children, search and list view of another only through the
  wide picker; a narrow picker, an unknown data type and a non-picker read
  widen nothing; Read taken away still refuses.
