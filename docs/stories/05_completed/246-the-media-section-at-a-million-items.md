# 246 — The Media section at a million items

**Epic:** M — Running at scale · **Priority:** should · **Size:** L
**Depends on:** 197

## Story

As an editor or administrator on a site whose media library holds a million
files, some folders holding hundreds of thousands, I want the Media section's
tree, folder views, search, moves and deletes to answer as quickly as they do on
a small site, so that a large library is something the site grows into rather
than something it works around.

## Context

Story 197 made the site's side of media scale and measured it at a million items
(`tests/load/media-library.bench.ts`, `docs/testing.md`, "Media at scale"): the
media cache is held within a memory budget and filled by indexed lookups, files
are served through one indexed query, the Delivery API pages a folder in SQL,
and 10,000 uploads into one folder rebuild nothing. Its "Out of scope" left the
back office's Media section to be checked. Checked 2026-11-02:

- **The folder view** (`collection` in `server/src/adapters/media.ts`) reads
  every child of the folder, loads each one whole with its versions and its
  creator, filters and sorts in memory, then returns one page. A folder of a
  million files is millions of queries for twenty items.
- **The tree** pages in the database (`repo.children(parent, skip, take)`), but a
  folder that lists a million files as tree nodes is no use to a person.
- **Moving a folder** (`NodeRepository.move`) rewrites each descendant's path in
  a statement of its own: a million statements in one request. Trashing a
  folder and emptying the recycle bin are to be measured the same way.
- **Deep pages** use `OFFSET`: the Delivery API's last page of a million-item
  folder took 640 ms on Postgres, and the folder view's would grow the same way.

Story 188 (a bundle's private files) builds on this rather than on a store of its
own: once the library scales, a bundle's files can be media items in a folder
it owns.

## Decided (planning, 2026-11-03)

- **The tree shows a folder's children folders first, then files, one page at
  a time, with Load more.** One order, sub-folders before files, each in their
  sort order, paged by the tree's own **Load more** (already in the client,
  `tree-item-element-base.ts`, 100 at a time). A folder with a few sub-folders
  shows them all and then its first files; one with 100,000 sub-folders (a
  folder per member) shows them a page at a time before any file. Every page is
  bounded, however wide the folder, and no folder behaves differently from
  another. Nothing expands by itself: a folder's children load when it is
  opened, and only the path to the item being edited opens on its own, so depth
  needs no limit. A media type's
  collection (Umbraco's grid view of a folder) keeps working as it does.
  - **Folders before files** is a visible change to a folder whose manual sort
    order mixed the two: the release note says so. Sorting still orders folders
    among folders and files among files.
  - **The limit** is the tree's page size, 100, a setting rather than the
    client's hard-coded `setTakeSize(100)` (its own TODO), so a site can show
    more or fewer before Load more.

## Acceptance criteria

- [x] **The folder view pages in SQL:** a `COUNT` and a page, filtered by name and
      sorted by name, created, updated or sort order in the query, loading only
      the page's items with their creators joined; built on 197's
      `MediaListingRepository` where it fits. Access as the Media section has it
      today.
- [x] **The tree** answers a folder's children folders first, then files, paged in
      that one order by the page size, and **Load more** brings the next page,
      folders or files; no page holds more than the page size. The tree item says how many
      items the folder holds. Indexed on both dialects (a folder flag beside
      `ix_node_parent_sort`, or the media type in the index), so the first page
      and a page near the end of a million-file folder cost the same.
- [x] **Moves are set-based:** moving a folder rewrites its subtree's paths and
      levels in one statement per table, on both dialects.
- [x] **Trashing, restoring and emptying the bin** at this scale run as a
      background job with progress when a subtree is large, rather than in the
      request; the request answers at once, saying the job is running.
- [x] **Deep pages stay quick:** the folder view and the Delivery API page by the
      last item seen where the sort allows, so the last page of a million-item
      folder costs what the first does.
- [x] **Search** in the Media section answers within budget at a million items,
      using an index rather than a scan of `node`.
- [x] **Measured:** `media-library.bench.ts` adds the back office's paths at a
      million items (the folder view's first and last page, a filter, a sort by
      name, a folder's tree children, search, moving a 100,000-item folder,
      trashing it and emptying the bin) with budgets in `docs/testing.md`;
      `tests/media-scale.test.ts` holds their query plans to no full scan of
      `node`, `content`, `content_version` or `property_value`, on both
      dialects.
- [x] `docs/rendering.md` ("The media cache") or a new section says how the
      library behaves at scale, and the release note names any change editors
      see in the tree.

## Plan (2026-11-03)

Measure first: the benchmark's new back-office paths (step 7) are written before
the fixes, so each fix is held to a number rather than a guess.

1. **Tree children, folders first.** `MediaRepository.children` (or a tree
   query of its own) orders by "is a folder" then `sort_order, id`, and pages
   that one order by `take`. "Is a folder" is the media type: an index
   that can answer it without joining `content` for every child (a column on
   `node`, set from the type, or the type in the index) is part of this step,
   with its migration. The client's paging is checked: if its Load more asks
   by page number rather than by items held, the fork asks by items held. The
   page size becomes a setting the tree reads.
2. **The folder view in SQL** (`collection`): count, filter by name, sort by
   name, created, updated or sort order, and load only the page's items with
   their creators, on 197's `MediaListingRepository`.
3. **Deep pages** page by the last item seen where the sort is by sort order
   (the tree, and the folder view's default), and by `OFFSET` otherwise.
4. **Moves** (`NodeRepository.move`): one `UPDATE` for the subtree's paths and
   levels, by prefix, on both dialects; the media cache's `moved` drop already
   takes the old path.
5. **Trash, restore and empty bin** (`media-operations.ts`): measured at
   100,000 items; whatever is past budget runs as a background job on the
   existing queue (story 187) with progress the Media section shows, and the
   request answers at once.
6. **Search:** the Media section's search uses the full-text index for names it
   already has where the query has terms, and is measured at a million items;
   a `LIKE` scan past budget gets an index of its own.
7. **Measured** in `media-library.bench.ts` and held in `media-scale.test.ts`:
   a folder of 1,000,000 files with 200 sub-folders, and one of 100,000
   sub-folders (the tree's first and last page, Load more), the folder view's first and last page, a filter, a sort by
   name, search, moving a 100,000-item folder, trashing it, restoring it and
   emptying the bin. Budgets in `docs/testing.md`, beside 197's.
8. **Docs and release note:** `docs/rendering.md` gains how the Media section
   behaves at scale; the release note names folders-first and the page-size
   setting.

## Out of scope

- Updating the page snapshot incrementally (197's other follow-up).
- A bundle's private files (188), which builds on this.

## Implementation (2026-11-03)

- **Tree:** migration 062 (`AddMediaTreeOrder`, release 0.46.0) adds
  `node.tree_group` (0 for an item of the built-in Folder type, 1 otherwise,
  set by `DocumentRepository.create`) and `ix_node_parent_tree`.
  `NodeRepository.children` orders by it, then sort order, then id; the
  client's own paging and Load more needed no fork change. `siblings` reads a
  window in SQL (`#siblingWindow`) instead of the whole folder. The page size
  stays the client's 100: making it a setting needed a fork change for little.
- **Folder view:** `collection` in `server/src/adapters/media.ts` pages through
  `MediaListingRepository.children` and `creators`; OFFSET, since the handler
  takes skip and take.
- **Moves and deletes:** `NodeRepository.move` is one `UPDATE` by path prefix;
  deletes are set-based; trash, restore, move, delete and empty bin of a branch
  over 5,000 items are queued (`CORE_JOB_OWNER`, `mediaJobHandlers`), the bin
  emptied 5,000 a transaction, deepest first.
- **Progress:** the node that queues a media job broadcasts
  `Crombolo:MediaJob` / `Queued` with the job id; the header app
  `media-jobs.js` polls `<plugin>/api/media-jobs/<id>` and reloads the Media
  tree and bin when it ends (`media-jobs-words.js`).
- **Found by measuring, and fixed:** `MediaAccessRepository.byUrl` matched a
  path against every node to find the nearest rule (now by the ancestor ids the
  path holds); `DocumentRepository#load` built its published-version join from
  every published version (now filtered by the node). The scale tests' scan
  check now catches those aliases and `document_version`.
- **Measured:** `docs/testing.md`, "The Media section at scale". One SQLite run
  at a million items saw a 401 midway through the 10,000 uploads; the run
  before 246's fixes and the two after it did not, so it is noted, not fixed.
- **Tests:** `media-scale.test.ts` (folders first, the sibling window),
  `media-scale-collection.test.ts`, `media-scale-moves.test.ts`,
  `media-jobs-words.test.ts`, `media.test.ts`, the dashboard manifest list.
