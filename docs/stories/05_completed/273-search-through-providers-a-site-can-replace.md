# 273 — Search through providers a site can replace

**Epic:** E — Cross-cutting · **Priority:** could · **Size:** L
**Depends on:** 043, 140

## Story

As the developer of a large site, I want the back office's search and the
site's own search to each run on a provider I choose, with Crombolo's database
search as the one it ships, so that I can put either on a service I already
use, such as Elasticsearch, OpenSearch, Meilisearch or Algolia, without
changing Crombolo.

## Context

On Umbraco's roadmap ("Search Abstraction Layer", Umbraco 19+, Q4 2026),
checked 2026-11-05: Umbraco is putting a layer in core so Examine can be
swapped for an outside engine.

Crombolo's two searches (`docs/search.md`) share one queue and one indexer:

- **Backoffice search** (story `043`): drafts, for editors.
  - Rows in `search_document`, searched with FTS5 on SQLite and `tsvector` on
    Postgres.
  - It is read in five places. The Examine dashboard (`SearchIndex.query`) and
    item search ask for it directly. Tree search
    (`NodeRepository.search`), member search (`MemberRepository`) and "find
    content by its properties" (`content-query.ts`) join
    `dialect.fullTextMatches` into their own SQL.
- **Site search** (story `140`): published pages, for visitors.
  - Rows in `site_search_document` (`SiteSearch.query`), read by `search()` in
    components and `GET delivery/api/v2/search`, through `siteSearchFor`
    (`packages/server/src/site-search.ts`).
  - The person's access to protected branches (`branchAccess`) is applied in
    the query, and hits are checked against the published cache.

The queue (`search_index_queue`) is a transactional outbox: a write queues
its item in its own transaction. `SearchIndex.indexQueued` then claims each
row, works out the item's documents (`entriesFor`, `siteEntriesFor`), and
writes both indexes.

## Decisions

- 2026-11-05: no outside service ships. The database search becomes the
  default provider of an interface, wired in code and overridable.
- 2026-11-05: backoffice search and site search are each overridable on their
  own, `search.backoffice` and `search.site`.
- 2026-11-05: a migration records each removal (`search_removal`), so a
  provider outside the database is told of every delete, durably.
- 2026-11-05: the queries that join the full-text match ask a provider for
  the matching items' ids and scores, up to a limit, and filter with them in
  the database. The database provider keeps its join.
- Not asked, as the way the rest already works:
  - Crombolo still works out each item's documents and hands them to the
    provider, so `searchable`, `site-search` levels and the blocks rules mean
    the same whatever the provider.
  - The queue stays the outbox for every provider: a write that fails leaves
    its row to be tried again.
  - Access is still decided by Crombolo: the provider is given the denied and
    allowed branches to filter on, and hits are checked against the published
    cache.

## Plan

1. **The interfaces** (`packages/core`, so a provider package needs nothing
   else). Both are passed what they index as plain documents, with the
   item's key, kind, content type alias, path of node ids, culture and
   trashed flag:
   - `BackofficeSearchProvider`:
     - `write(item, entries)` and `remove(item)`;
     - `matches(terms, { kinds, limit })`, giving ids and scores, best first;
     - `query(term, index, paging)`, giving the dashboard's hits with their
       stored fields;
     - `stats(index)`;
     - `clear(index)`, before a rebuild;
     - `health()`.
   - `SiteSearchProvider`:
     - `write(item, entries)` and `remove(item)`;
     - `query(term, { culture, types, access, skip, take })`, giving keys,
       scores and the text excerpts are cut from;
     - `stats()`, `clear()` and `health()`.
2. **The database providers** (`packages/data`): `databaseBackofficeSearch(db)`
   and `databaseSiteSearch(db)`, made from what `SearchIndex` and `SiteSearch`
   do now. The backoffice one also offers `sqlMatches(terms)`, the join the
   three queries use today, so with it nothing changes and nothing is capped.
3. **Wiring** (`packages/server`):
   - `defineConfig({ search: { backoffice, site } })` takes either provider.
     Each is a factory given the database and a logger, as `mediaStore` is
     configured; both default to the database ones.
   - One `SearchProviders` object is built at boot and handed to the indexer
     job, the Management API's search adapter, the tree, member and content
     query search, `siteSearchFor`, and the Delivery API.
   - Nothing reaches `SearchIndex` or `SiteSearch` except through it.
4. **The indexer** (`SearchIndex.indexQueued`) claims a queue row and works
   out both documents. It then:
   - writes them to each provider that is not the database inside the claim's
     transaction, and to the database one as now;
   - deletes the row only when every write succeeded;
   - otherwise logs the failure and leaves the row, to be tried on the next
     tick.
5. **Queries that join** (tree search, member search, `content-query`): with
   a provider offering `sqlMatches`, the join as now. Otherwise they call
   `matches` with a limit (`search.matchLimit`, default 1,000), and the
   query filters `id in (…)` and orders by score. A total past the limit is
   capped, and the answer says so in the log once per process.
6. **Rebuild** from the Search indexes dashboard and `crombolo index rebuild`:
   `clear`, then queue everything, as now. Stats come from the provider, and
   `pending` from the queue.
7. **A status check** (group Search) reports each provider's `health()`, and
   which is in use. `describeSettings` shows the providers' names, read-only.
8. **A conformance suite** (`packages/remote-conformance`, or a new
   `@crombolo/search-conformance`): the tests every provider must pass. They
   cover writing, removing, culture, access, ranking order, paging, totals
   and rebuild. It runs against both database providers, and against an
   in-memory provider the tests define, which proves the interface works
   without the database.
9. **Docs:** `docs/search.md` gains "Providers", covering:
   - the interfaces and what each method is given;
   - what Crombolo decides and what a provider decides;
   - the match limit;
   - a worked example of a provider in `crombolo.config.ts`.

   `docs/configuration.md` lists `search`.

## Acceptance criteria

- [x] Backoffice search and site search each go through a provider, and the
      database ones are the defaults: every existing search test passes
      unchanged, on both engines, with the same query counts.
- [x] `crombolo.config.ts` can replace either provider on its own. A site
      with an in-memory provider for both indexes, searches, rebuilds and
      reports stats with no full-text rows written.
- [x] Tree, member and "find by properties" searches work through a provider
      without `sqlMatches`, filtered and ordered by its matches, capped at the
      match limit.
- [x] Permissions, members-only pages, culture and the published cache still
      decide what a person sees, whatever the provider.
- [x] A provider that fails a write leaves the item queued and logged, and
      it is indexed once the provider recovers. A failing `health()` shows on
      the status check.
- [x] The conformance suite passes against both database providers and the
      in-memory one.
- [x] `docs/search.md` and `docs/configuration.md` describe it.

## Out of scope

- An adapter for any outside service. Each can be a bundle or an npm package
  built on the interfaces, tested with the conformance suite.

## Implementation

- **The interfaces**, in `packages/core/src/search-providers.ts` and
  re-exported by `@crombolo/crombolo`:
  - `BackofficeSearchProvider` and `SiteSearchProvider`, with `SearchItem` and
    the documents each is given;
  - `openTo(path, access)`, the access rule a provider applies;
  - `searchWords` and `searchTerms`, moved here from `@crombolo/data`, which
    still re-exports them.

  A provider's `write` with no entries means there is nothing to find.
- **The database providers** (`packages/data/src/search-providers.ts`):
  `databaseBackofficeSearch` and `databaseSiteSearch` are what `SearchIndex`
  and `SiteSearch` did. They are marked `inDatabase`, so the indexer writes
  them inside the claim's transaction (`writeIn`). The backoffice one offers
  `sqlMatches`.
- **The registry:** `useSearchProviders(db, …)` and `searchProvidersOf(db)`,
  keyed by the connection's lock manager, which every transaction and snapshot
  of it shares. The database providers are the default.
- **The joining queries:** `fullTextHits(db, query, kinds)` serves tree
  search (`NodeRepository.search`), member search (`MemberRepository.filter`)
  and `content-query`.
  - With the database provider, it is its match.
  - With any other, it is the provider's matches as a `UNION ALL` table of
    values, capped at `matchLimit`. Hitting the cap is reported once a process
    (`onCapped`).
- **The indexer** (`SearchIndex.indexQueued`):
  - first tells providers outside the database of the `search_removal` rows,
    deleting each once done;
  - then writes each queued item to them before its claim, skipping the claim
    on a failure, which goes to `onError`.

  `rebuild` calls `clear` where a provider has one. `stats` and `query` go
  through the provider. The dashboard's query drops hits for items that no
  longer exist.
- **Migration 063** (`AddSearchRemovals`, `search_removal`):
  - `deleteNodeRows` records every page, media item and member it deletes,
    descendants and members included.
  - With a provider outside the database, a move queues the moved branch,
    read at its new path.
  - The test rewinds undo it (`tests/support/db.ts`, the integration
    upgrade test, `upgrade-from-release`, `permissions`).
  - Its `release` is `0.48.0`, the next release. So `tests/migrations.test.ts`
    "no step claims a release that does not exist yet" fails until
    `release:version 0.48.0` raises `VERSION`.
- **The server:**
  - `search: { backoffice, site, matchLimit }` in `CromboloConfig`, each a
    factory given the database.
  - `useSiteSearchProviders` (`packages/server/src/database.ts`) registers
    them in `bootstrapDatabase` and `attachDatabase`, so the server, the
    workers and the CLI all use them, with logging for failures and the cap.
  - `siteSearchFor` and the Delivery API's search ask `searchProvidersOf(db).site`.
  - The status checks gain a **Search** group, "Search providers", naming
    each provider and whether it answers. Troubleshooting lists them.
- **The conformance suite:** `searchProviderConformance` (in
  `packages/core/src/search-conformance.ts`) has ten checks and answers a
  report.
- **Tests** (`tests/search-providers.test.ts`, on SQLite and Postgres):
  - The suite passes against the database providers, over real pages, media
    and members, and against an in-memory one (`tests/support/memory-search.ts`).
  - A provider that does not remove fails the suite.
  - A site configured with the in-memory providers:
    - indexes with no `search_document` or `site_search_document` rows;
    - is found by item search, `search()`, the Delivery API and the
      dashboard;
    - passes a delete for good to the provider, and a move with its new path;
    - retries after a failure;
    - shows the providers on the status check;
    - still answers a query past the match limit.

  Every existing search test passes unchanged, with the same query counts.
- `docs/search.md` ("Providers") and `docs/configuration.md` describe it.
