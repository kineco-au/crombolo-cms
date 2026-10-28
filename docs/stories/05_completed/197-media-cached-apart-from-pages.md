# 197 — Media cached apart from pages

**Epic:** M — Running at scale · **Priority:** should · **Size:** L
**Depends on:** 171, 174, 196

## Story

As a site with a media library of millions of items, I want media cached apart
from published pages, item by item and within a memory budget, so that the
library can grow without every server holding all of it in memory, and an
upload never makes a server rebuild its pages.

## Context

Each server keeps one published snapshot in memory
(`packages/render/src/published-cache.ts`).
- **What it holds:** every published page, every media item (`loadMedia`), the
  dictionary, the redirects and the elements.
- **How it changes:** any invalidation, whether a publish or a media save,
  drops the whole snapshot, and the next request rebuilds it from the database.
  - A media save writes a `content` cache instruction with `{ media: true }`
    (`content/src/media-operations.ts`).
  - Every server answers any `content` instruction with `cache.invalidate()`
    (`server.ts`, `onInstruction`).
- **What reads it:**
  - **Rendering**, synchronously, through a value context built once per
    snapshot view (`media: (key) => media.get(…)`). Four kinds of value
    resolve media:
    - `Umbraco.MediaPicker3`, through `model.media()`;
    - rich text, whose local media links resolve in `model.html()`;
    - `Umbraco.MultiNodeTreePicker` picking media;
    - `Umbraco.MultiUrlPicker` linking to media.

    Menus (`menus.ts`) resolve media the same way. Values are converted on
    every access and never stored, so dropping a cached item takes effect at
    once.
  - **`/media/<path>`** finds its item through a URL map built over all media
    (`mediaAt`).
  - **The Delivery API** builds its media tree from `allMedia()`
    (`api-delivery/src/handler.ts`).
  - **SEO defaults** read images from it (`server/src/seo.ts`).

Raised by Nature's Calendar (`wt-natures-calendar` stories 014 and 044):
millions of observation photos, uploaded continually, are kept in the media
library. Story 196 protects them, and this story makes the library hold them.

## Decided (2026-10-28)

- **Media leaves the snapshot.** The snapshot keeps pages, elements, domains,
  the dictionary and redirects. Media is held in a cache of its own.
- **That cache keeps itself within a memory budget.**
  - It holds the most recently used media items, keyed by key and by URL, and
    evicts the least recently used once an estimate of their size passes the
    budget.
  - It is filled from indexed database lookups.
  - The budget is a setting in megabytes. An item's size is estimated from the
    JSON of its values and properties, so the limit is approximate.
- **It is invalidated per item.** A media change carries the keys it touched,
  and every server drops just those, plus the descendants whose URLs changed. A
  media change no longer invalidates the page snapshot, and a page change does
  not drop media.
- **A server that missed changes empties and refills.** A server that finds a
  gap in the instruction log, or is behind past what the log keeps (pruned
  instructions), empties its media cache and refills it on demand.
- **Media is read asynchronously.** The value converters await a media lookup.
  The accessors that resolve media return promises: `model.media()`,
  `model.html()`, and picker and link values that can name media. Views
  `await` them. The JSX runtime already renders promise children and async
  components.
- **In one minor, breaking views, with a checker.** The accessors change in
  place in the release that ships this. `crombolo components check` already
  type-checks views, so it flags every view that uses one of these values
  without awaiting it. The release notes list each changed accessor, its new
  type, and the change to make.

  This release breaks story 173's deprecate-first promise. The notes say so,
  and why: keeping synchronous media for a minor would mean keeping every media
  item in memory for that minor, which is the problem being fixed.
- **`/media/` uses 196's index.** Story 196 adds the indexed `file_url` column,
  and this story resolves `/media/<path>` through it, with no map over all
  media. 197 therefore follows 196.

## Plan (2026-10-28)

1. **The media cache** (`packages/render/src/media-cache.ts`).
   - `MediaCache`: `byKey(key)`, `byKeys(keys)` (one query for many) and
     `byUrl(url)`, all asynchronous. Behind them is a least-recently-used map
     with a size estimate per item, and an eviction loop held to the budget.
     Lookups for the same key in flight at once share one query.
   - A source the server implements, over indexed queries:
     - `loadMediaByKeys` uses the node key;
     - `loadMediaByUrl` uses 196's `file_url`.
     Each returns `PublishedMediaNode` as `loadMedia` does today.
   - `drop(keys)`, `dropUnder(path)` and `clear()`.
   - Settings: `mediaCacheMegabytes` and `CROMBOLO_MEDIA_CACHE_MB`. The default
     is to be measured during the work: a starting value of 64, recorded in
     `docs/configuration.md`.
2. **The snapshot loses media** (`published-cache.ts`).
   - `loadMedia` leaves `PublishedContentSource`, and `snapshot.media` goes.
   - `allMedia()` and `mediaAt()` are removed. Their callers move to the media
     cache, or to SQL (step 6).
   - The value context's `media` becomes `(key) => Promise<PublishedMedia | undefined>`,
     bound to the media cache. `mediaUrlOf` is unchanged.
3. **Asynchronous values** (`values.ts`, `model.ts`, `menus.ts`, `blocks.ts`).
   - `convertValue` becomes asynchronous for the four editors that resolve
     media. Every other editor keeps returning synchronously, so `text()` and
     the like do not change.
   - The accessors:
     - `media()` returns `Promise<MediaWithCrops[]>`;
     - `html()` returns `RawHtml | Promise<RawHtml>`, which JSX already
       accepts, so `{model.html('body')}` keeps working unchanged;
     - `value()` for a media picker, a multi-node tree picker or a multi URL
       picker returns a promise. The generated model types say which: a
       `Promise<…>` for those aliases.
   - Blocks and elements resolve their media the same way, inside their own
     async render.
   - Menus: `buildMenu` resolves its media items with one `byKeys` call.
4. **Invalidation per item.**
   - Media operations append `{ kind: 'content', payload: { media: [keys],
     moved?: [paths] } }`.
   - `onInstruction` drops those keys, or everything under a moved path, from
     the media cache, and leaves the page snapshot alone when the instruction
     names only media.
   - A server that finds a gap in instruction ids, or whose checkpoint is
     behind the oldest kept instruction, calls `clear()`.
   - `cms media import`, the bulk importer, appends one instruction per batch,
     with its keys.
5. **`/media/<path>`** looks its item up with `byUrl`, which uses 196's
   `file_url`: its caching headers and its access rules. A miss answers 404,
   as 196 decides.
6. **The Delivery API's media endpoints** (`api-delivery/src/handler.ts`).
   - The media tree, an item by path, children and the listing become SQL over
     `node` (`parent_id`, `sort_order`, `path`, `level`), paged in the
     database.
   - The order stays Umbraco's: `sort_order`, then the node id.
   - The indexes each needs are added to both dialects in this story's
     migration, if they are missing.
   - The responses are byte-for-byte the same documents: held to that by the
     existing tests, before and after.
7. **SEO** (`server/src/seo.ts`). The default share image and the per-page
   image are resolved through the media cache, asynchronously.
8. **The view checker and the starter views.**
   - `crombolo components check` reports each now-asynchronous accessor used
     without `await`. It comes from the type checker, and the message names
     the accessor and the change to make.
   - Every view in `sites/` and the templates is updated:
     - `const [hero] = await model.media('hero')`;
     - components that read media become `async`.
   - The generated docs pages are regenerated.
9. **Tests.**
   - **The cache:** a budget held under load; least recently used evicted;
     the same key shared while in flight; drop, dropUnder and clear.
   - **Invalidation:** a media change drops only its keys and does not rebuild
     the page snapshot; a gap or a far-behind server clears it.
   - **Rendering:** each of the four editors, menus, blocks and rich text
     render the same markup as before, with views awaiting.
   - **The Delivery API:** the media endpoints answer the same documents,
     paged.
   - **The checker:** it flags an unawaited `model.media(…)`.
   - **Scale, on both dialects:**
     - a library of 1,000,000 media items: boot, render, serve a file, and
       page the Delivery API's media, within budgets recorded in
       `docs/testing.md`;
     - 10,000 uploads while pages are served: no page-snapshot rebuild.
10. **Docs and the release notes.**
    - `docs/rendering.md` and `docs/architecture.md`: the two caches, and
      what each change invalidates.
    - `docs/api.md`: the changed accessors.
    - The release notes: every changed accessor with its replacement, and the
      exception to 173's promise.

## Acceptance criteria

- [x] Building the page snapshot loads no media. Its memory and build time do
      not grow with the size of the media library.
- [x] Media is resolved by key and by URL through the media cache. It stays
      within its memory budget, and falls back to an indexed query.
- [x] Saving, moving, replacing or deleting a media item drops only that item,
      and its descendants where its URL changed, on every server. It does not
      rebuild the page snapshot.
- [x] A server that missed changes empties its media cache and refills it.
- [x] Media-bearing values are read asynchronously. A rendered page shows the
      same media as before, with each image's crops, focal point and alt text.
- [x] `crombolo components check` flags a view that uses an asynchronous media
      value without awaiting it. Every view this repository ships is updated.
- [x] `/media/<path>` finds its item through 196's index, with no map over all
      media.
- [x] The Delivery API's media endpoints answer the same documents, paged by
      the database rather than in memory.
- [x] A test library of 1,000,000 media items on both dialects: a server boots,
      renders a page using some of them, serves a file and pages the Delivery
      API's media list. Memory and the snapshot build stay within a stated
      budget, recorded in `docs/testing.md`'s performance table.
- [x] Upload throughput: 10,000 uploads while pages are being served cause no
      page-snapshot rebuild.
- [x] `docs/rendering.md`, `docs/architecture.md` and `docs/api.md` describe
      the two caches and the asynchronous accessors. The release notes give
      the change and the exception to 173's promise.

## As built (2026-10-28)

- **The media cache** (`packages/render/src/media-cache.ts`). `MediaCache`
  with `byKey`, `byKeys`, `byUrl` (all async), `drop`, `dropUnder`, `apply`,
  `clear` and `stats`. A least-recently-used `Map` with an estimated size per
  item (`estimateMediaBytes`: twice the JSON of its properties, name, key and
  path, plus 400); evicts past the budget, never holds an item bigger than the
  whole budget. Lookups made in the same tick are batched into one
  `loadMediaByKeys` call (a microtask flush), a key in flight is shared, misses
  are not remembered. A load overtaken by `drop` answers but is not kept; one
  overtaken by `clear` or `dropUnder` (a generation counter) likewise.
  `PublishedMediaNode` moved here from `published-cache.ts`.
- **The source** (`createMediaSource`, `server/src/adapters/documents.ts`):
  `DocumentRepository.loadCurrent(filter?)` now takes `{ keys }`, `{ ids }` or
  `{ urls }` (through `content.file_url`), answers in the order asked, and
  carries each item's own access settings, so `itemSettings()` is no longer
  read for the snapshot.
- **Settings.** `mediaCacheMegabytes` / `CROMBOLO_MEDIA_CACHE_MB`, default 64,
  in `docs/configuration.md` (generated). Measured: a generated image is about
  850 bytes in the estimate, so 64 MB holds tens of thousands of items; the
  default stays at the plan's 64.
- **The snapshot loses media.** `loadMedia`, `snapshot.media`, `allMedia()`
  and `mediaAt()` are gone. `PublishedCache` takes `options.media` and exposes
  it as `cache.media`; the value context's `media` is `(key) =>
  media.byKey(key)`. The published and draft caches share one media cache.
  `menuIn`/`menuItemsIn` are async; `menusIn` and `cache.menus(culture)` read
  every menu in a view with one `byKeys`, and the renderer reads them before
  rendering, so `PageProps.menu()` stays synchronous (`menuMediaKeys`).
- **Asynchronous values** (`values.ts`, `model.ts`). `convertValue` returns a
  promise for `MediaPicker3`, `MultiNodeTreePicker` and `MultiUrlPicker`
  (`ASYNC_EDITORS`), and for `RichText` only when a local link names media
  (`resolveLocalLinks` resolves page links at once). `model.media()` →
  `Promise<MediaWithCrops[]>`; `html()` → `RawHtml | Promise<RawHtml>`;
  `text()` never waits (`convertValueNow`: rich text's media links are `#`,
  the three async editors read as empty). `PublishedElement` gains `media()`
  and the same `html()`/`text()`. Helpers `isPending`, `textOf`, `htmlOf`,
  `picksOf`. `effectiveMeta` and `SeoHead` are async.
- **Invalidation per item.** Media operations append `{ media: [keys],
  moved?: [old paths] }` (`mediaChangePayload`); move, trash, delete, restore
  and empty-bin name the old paths of the branches; sort names the children.
  `DocumentRepository`'s own instruction for a media node is `{ media: [key] }`.
  `onChange(change)` applies it to this server's cache, not
  `cache.invalidate()`. The media-access API appends `{ media: [key] }` when an
  item's own settings change. `crombolo media import` appends one per 500 new
  items.
- **The poller** (`server/src/schema.ts`). `instructionEffects(kind, payload)`
  in `@crombolo/data` classifies an instruction: `components` keeps both;
  `schema`, `{ media: true }`, `all`, `bundle`, `revert` and anything
  unrecognised clear media; `key`, `redirects`, `domains`, `dictionary`,
  `elements`, `urls` keep it; a `media` array drops its items and leaves the
  pages. Each poll reads the latest checkpoint first, then every instruction
  numbered after the one it followed (`instructionsBetween`), its own
  included. A missing number (pruned), a reset count, or more than
  `MEDIA_REPLAY_LIMIT` (5,000) behind → `clear()`. Checkpoints whose changes
  left the pages alone are remembered, and `PublishedCache.covered(n)` moves
  the served checkpoint over them, so the page snapshot is not rebuilt.
  `served()` reports the covered checkpoint.
- **`/media/<path>`** reads the item through `mediaCache.byKey` of the owner
  `MediaAccessRepository.byUrl` already found through `file_url` (one fewer
  query than a second `byUrl`); `MediaCache.byUrl` exists and is tested.
- **The Delivery API** (`server/src/delivery-media.ts`, `MediaListingRepository`
  in `@crombolo/data`). A `media` port: `byKeys` (through the cache, in order),
  `byPath` (a level at a time, case-insensitive; on SQLite a non-ASCII name
  falls back to matching in JS), `children` (a `COUNT` and a `LIMIT/OFFSET`
  page, `sort_order, id` after any sort, filters in SQL, access decided in SQL
  from the rule above the folder, each child's own rule and each item's
  policy) and `paths`. Only the tables a filter or sort needs are joined.
  `output.ts` became async throughout. Without the port the media endpoints
  answer empty lists and 404.
- **Migration 051 `AddMediaPagingIndexes`** (expand, 0.35.0):
  `ix_node_parent_sort (parent_id, node_object_type, trashed, sort_order, id)`
  and `ix_cache_instruction_checkpoint`. Undone in `tests/support/db.ts`
  (`undoMediaPagingIndexes`, called first by `undoMediaAccess`),
  `upgrade-from-release.test.ts`, `permissions.test.ts`, `media-access.test.ts`
  and `integration/first-boot.integration.ts`.
- **Found by the upload benchmark:** a new node's sort order was
  `MAX(sort_order)` over every sibling, read across the whole folder because
  `trashed` was not fixed — about a second an upload into a million-item
  folder. `NodeRepository.#nextSortOrder` now takes one maximum per `trashed`,
  each read off the end of `ix_node_parent_sort`.
- **SEO.** The default share image and the page's image go through
  `cache.media`.
- **The checker.** `unawaitedMedia(source)` in `server/src/components.ts`:
  `media()` indexed, read from, destructured or iterated without `await` is a
  problem with its line and the change to make; `withAwaitHint` adds that
  change to `tsc`'s messages about `Promise<MediaWithCrops|Link|…>`.
  **Deviation:** the plan had the type checker do it all; it is optional for a
  site, so the source scan is what always runs.
- **Generated types:** `Promise<MediaWithCrops[]>` (or `| null` single),
  `Promise<PublishedContent[]>`, `Promise<Link[]>`, and `string |
  Promise<string>` for rich text. `MediaWithCrops` and `PublishedMedia` are now
  exported types (`docs/api/surface.json` regenerated).
- **Views.** Harbourstone's pages and bottling card are async and await
  `media()`; every `setInnerHTML={{ __html: model.text(…) }}` for rich text in
  `sites/`, `apps/site` and the `basic` template is `{model.html(…)}`. The docs
  seed and the demo bundle were rebuilt.
- **Tests.** `tests/media-cache.test.ts` (the cache, the instruction effects,
  the payload, and the poller on both dialects: per-item drops, no rebuild, a
  page change, a gap, a reset, far behind, bulk and schema);
  `tests/media-values.test.tsx` (each editor, rich text, blocks, menus, the
  checker); `tests/media-rendering.test.ts` (a rename and a trash drop the item
  with no snapshot rebuild; the snapshot's statements do not grow with the
  library; a file served through the cache); `tests/delivery-api.test.ts`
  (paging, sorts, filters, totals, items order, paths); `tests/media-scale.test.ts`
  (20,000 generated items on both dialects: no media read by the snapshot,
  query plans with no full scan of `node`, `content`, `content_version` or
  `property_value`, a render and a file, the cache within a 1 MB budget, a page
  near the end of the folder). `tests/load/media-library.bench.ts` (bench
  suite): 1,000,000 items and 10,000 uploads, numbers in `docs/testing.md`,
  "Media at scale". `tests/support/media-library.ts` generates a library in SQL.

## Out of scope

- Updating the page snapshot incrementally instead of rebuilding it: the
  follow-up for sites with very many pages.
- The back office's Media section at this scale: whether its tree pages in the
  database is to be checked here, and fixed in a story of its own if it does
  not.
