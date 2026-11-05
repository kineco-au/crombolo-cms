# 269 — The pages list view searches, sorts and names who edited

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 024

## Story

As an editor looking at a page's children in a list view, I want the search
box and the column sorting to work, and the "Created by" and "Last edited by"
columns filled in, as they are for media.

## Context

Found 2026-11-05. `GetCollectionDocumentById`
(`packages/api-management/src/handlers/document.ts`) reads only skip and take.
The client sends `filter`, `orderBy`, `orderDirection` and `orderCulture`;
all four are ignored, so typing in the search box or clicking a column header
changes nothing. Each item answers `creator: null`, `updater: null` and
`hasChildren: false`, so the table's and cards' user columns are blank, and
an item with children shows none. The media collection already reads filter
and ordering (`media.ts`), which is the pattern to follow.

## Acceptance criteria

- [x] `filter` narrows the list by name in the culture shown, and the total
      agrees.
- [x] `orderBy` sorts by sort order, name, created, updated, creator and
      updater, in either direction; `orderCulture` picks the culture for
      names. Sorting by the list view's own property columns is story `276`.
- [x] `creator`, `updater` and `hasChildren` are filled in.
- [x] Children the user may not read stay out of the page and the total.
- [x] Tests on both engines, including a page of a large folder.

## Implementation

- `packages/data/src/repositories/document-listing.ts`:
  `DocumentListingRepository.children` counts, searches, sorts and pages a
  page's children in one query each, as the media folder view does (story
  `246`). The name searched and sorted is the culture's
  (`document_culture_variation`), else the draft's; `like` wildcards in the
  search are escaped. `people` reads each page's creator (`node.node_user`)
  and the writer of its current draft in one query.
- `DocumentPort.collection` takes a `DocumentCollectionQuery` (filter,
  `orderBy`, direction, `orderCulture`), and answers `DocumentCollectionItem`s
  with `isProtected`, `hasChildren`, `creator` and `updater`
  (`packages/server/src/adapters/documents.ts`). `owner` is taken as
  `creator`; an alias the database cannot sort by keeps the sort order.
  Children the user may not read are still left out of the page and the
  total.
- `GetCollectionDocumentById` passes the query through and answers the four
  fields instead of `null` and `false`.
- Tests (`tests/document-collection.test.ts`, SQLite and Postgres): searching
  in each culture with the total, wildcards, sorting each way and in Danish,
  an unknown column, creator, updater and children, and a page of a folder of
  thirty.
