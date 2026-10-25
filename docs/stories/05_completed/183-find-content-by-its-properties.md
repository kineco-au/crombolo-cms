# 183 — Find content by its properties

**Epic:** E — Cross-cutting · **Priority:** should · **Size:** M
**Depends on:** 043

## Story

As someone working on a large site, or building a tool for people who do, I
want to find pages by their type, place, dates, state and property values,
so that "the news pages updated this month that have no summary" is one
question rather than a walk through the tree.

## Context

- **The Management API's document search** (`GetItemDocumentSearch`) is full
  text over draft names and bodies, filtered by permission
  (`docs/search.md`). It cannot filter by content type, date, state or
  property.
- **`GetCollectionDocumentById`** pages one node's children.
- **The template query builder** (`PostTemplateQueryExecute`) filters by type
  and dates, but returns only samples for the builder.
- **The Delivery API** filters by type and dates, but sees published content
  only.

A tool that needs "pages matching X" has to crawl, which is slow and costly
on a big tree. It also gets permission filtering wrong unless it repeats the
server's rules.

## Acceptance criteria

- [x] **`POST <backoffice>/crombolo/api/content-query`**, under the
      back-office session, answering as the signed-in user.
- [x] **Request:**
      ```
      { entity: 'document',
        contentTypes?: string[],                      // alias or key
        name?: { op: 'contains' | 'startsWith' | 'equals', value },
        text?: string,                                // the existing full-text index
        under?: key, parent?: key, maxDepth?: number,
        created?: { from?, to? }, updated?: { from?, to? },
        state?: ('published' | 'draft' | 'changed' | 'trashed')[],
        culture?: string,
        properties?: [{ alias, op: 'eq' | 'ne' | 'contains' | 'gt' | 'gte'
                        | 'lt' | 'lte' | 'exists' | 'empty', value? }],
        sort?: { by: 'name' | 'createDate' | 'updateDate' | 'path' | 'sortOrder', dir },
        skip?: number, take?: number }
      ```
  - At most five property clauses.
  - `take` defaults to 25, and is at most 100.
  - Trashed content is excluded unless asked for.
- [x] **Response:**
      ```
      { total, exact, items: [{ id, name, path: [{ id, name }],
        contentType: { id, alias }, state, createDate, updateDate, cultures? }] }
      ```
- [x] **A property comparison** reads the column its storage type uses, so
      numbers and dates compare as numbers and dates. A block or JSON value
      is matched only through `text`.
- [x] **`text`** reuses the existing full-text search (FTS5 on SQLite,
      `tsvector` on Postgres), not a new index.
- [x] **Permissions:**
  - start nodes limit the query itself;
  - Browse is checked as the document search does (`visibleSearch`,
    `permissionsForPath`), over a bounded window, and `exact: false` says
    when that window was cut;
  - a filter or sort on a property the user cannot read is refused with 400,
    so a filter cannot be used to learn values they cannot see;
  - members and users are never returned.
- [x] **Safe input:** `LIKE` patterns are escaped, unknown aliases are
      refused by name, and a statement timeout and the row window bound the
      cost.
- [x] **Media** is a follow-up: the request shape leaves room for
      `entity: 'media'`.
- [x] **Green on SQLite and Postgres both,** with tests for every operator,
      state, paging, start nodes, a granular Browse denial and a property
      the user cannot read.
- [x] **Documented** in `docs/search.md`, with examples.

## Findings (2026-10-25)

- **Where a document's facts live** (`packages/data/src/schema/content.ts`,
  `values.ts`):
  - **Place:** `node` holds `parent_id`, `level`, `path` (an ancestor list,
    so "under" is a prefix match on an indexed column), `sort_order`,
    `trashed`, `text` (the name) and `create_date`.
  - **State:** `document(published, edited)`, per culture in
    `document_culture_variation`.
  - **Updated:** the current `content_version`'s `version_date`.
  - **Values:** `property_value` is append-only, with the draft row marked
    `is_current`, in typed columns (`int_value`, `decimal_value`,
    `date_value`, `varchar_value`, `text_value`).
  - **Which column:** `STORAGE_COLUMN` (`packages/core/src/object-types.ts`)
    maps the data type's `db_type` to the column, so a comparison reads a
    number as a number and a date as a date.
- **State** is `stateFor(published, edited, trashed, available)`
  (`documents.ts`), the same rule the Management API answers with.
- **Full text** is `NodeRepository.search` over `search_document`. That is
  FTS5 on SQLite and a `tsvector` on Postgres, with terms built by
  `dialect.fullTextHits` / `fullTextQuery` and `searchTerms`. It indexes draft
  names and searchable text values.
- **Browse** is `visibleSearch` (`start-node-trees.ts`). It reads a window of
  1,000 rows, filters by start node and `permissionsForPath`, and pages after.
  It does not say whether the window was cut, which `exact` needs.
- **Reading a property is not enforced anywhere on the server.** Groups grant
  `Umb.Document.PropertyValue.Read` per property type
  (`propertyValuePermissions`, `permissions.ts`). Only Write is checked
  (`deniedPropertyWrite`). This endpoint is the first server-side Read check.
  Document properties have no sensitive flag; only member properties do.
- **The template query executor** filters in memory over the published cache
  by four fixed fields. Nothing in it is reusable here.
- **Plugin routes** are `if (pathname === …)` blocks in `server.ts`, with
  `authenticate` and `hasSection`. A plugin POST is audited as a write
  (`auditPluginWrite`), so this read needs to be exempt.
- **No statement timeout exists today.** LIKE escaping happens in one place
  (`audit.ts`), and the node search strips `%` and `_` instead.

## Plan

**Decided (2026-10-25):**
- **The draft:** property filters, name and dates compare against the current
  draft, as the full-text index does. `state` narrows to published or changed
  pages. There is no `version` field.
- **The Content section** is required, so a user without it gets 403.

### 1. The query, in the data layer

- `packages/data/src/content-query.ts`, `queryDocuments(db, query, scope)`.
  It builds one SQL statement from the request, with the dialect's fragments:
  - **type:** `content.content_type_id IN (…)`, aliases and keys resolved
    first, an unknown one refused by name;
  - **place:** `under` as a `node.path` prefix, `parent` as `parent_id`,
    `maxDepth` against `level`;
  - **dates:** `node.create_date`, and the current version's `version_date`;
  - **state:** published, draft, changed and trashed from `document`
    (per culture from `document_culture_variation` when `culture` is given);
    trashed only when asked for;
  - **name:** `LOWER(name) LIKE ? ESCAPE '\'`, through a new shared
    `escapeLike`, which `audit.ts` then uses too;
  - **text:** an `EXISTS` on the full-text hits, using the existing
    fragments;
  - **properties:** one `EXISTS` per clause on `property_value` (`is_current`,
    the clause's property type, the culture or invariant), comparing the
    column `STORAGE_COLUMN` names. `exists` and `empty` test for a row and
    for a non-blank value. A block or JSON value (text storage, a block or
    JSON editor) is refused for anything but `exists` and `empty`;
  - **sort and paging:** `ORDER BY` on name, the dates, path or sort order,
    with the key as a tiebreak.
- It returns ids, names, path chains, type, state and dates, plus `total`.

### 2. Permissions and cost

- **Start nodes** become `path` prefixes in the statement itself.
- **Browse:** when every group grants Read everywhere, the database pages.
  Otherwise up to 1,000 rows are read, filtered with `permissionsForPath`, and
  paged in memory. `visibleSearch` gains a `cut` flag for `exact`.
- **Property Read:** each filtered or sorted property is checked with
  `propertyValuePermissions` for every type in the request (all the types
  that carry the property when no type is named). A property the user cannot
  read is refused with 400, naming the property.
- **Cost:**
  - at most five property clauses; `take` at most 100;
  - Postgres runs the statement under `SET LOCAL statement_timeout` (5 s) in
    its own transaction;
  - SQLite has no timeout to set, so the row window bounds it.

### 3. The endpoint

- `POST <backoffice>/crombolo/api/content-query`, in `server.ts`, behind the
  back-office session and the Content section. The body is checked into a
  typed query, with each problem named in a 400. It is not audited, since it
  writes nothing. `entity` is required and only `document` is accepted, which
  leaves room for media.

### 4. Tests and docs

- `tests/content-query.test.ts`, on both dialects:
  - each operator on each storage type;
  - name and text;
  - each state, with trashed excluded by default;
  - culture;
  - under, parent and depth;
  - dates;
  - sorting and paging;
  - an unknown alias;
  - LIKE metacharacters;
  - start nodes;
  - a granular Browse denial, with `exact: false` past the window;
  - a property the user cannot read;
  - the session and section checks.
- `docs/search.md`: a "Finding content by its properties" section, with
  examples.

## Implementation (2026-10-25)

Built as planned, plus a command line (asked for while building):

- **`crombolo content find`** takes the query's filters as flags, with value
  tests as `--where "<alias> <op> [value]"`.
  - **Locally** it runs on the site's own database as the operator
    (`OPERATOR_SCOPE`), and resolves `--under` and `--parent` from page paths.
  - **With `--remote`** it answers as the signed-in person through a new
    remote-protocol capability, `content-query`
    (`POST <api>/environments/{id}/content/query`, `docs/remote-protocol.md`),
    under the same Content-section and scope rules as the endpoint.
- **Where the code is:**
  - `packages/data/src/content-query.ts` parses the request and runs the
    query;
  - `packages/server/src/content-query.ts` turns a principal into a scope
    (`contentQueryScope`) and answers the request (`answerContentQuery`),
    shared by the endpoint and the remote route;
  - `escapeLike` moved into `search-text.ts`, and the audit log's search uses
    it too.
- **Found on the way:**
  - a property alias stored differently on two types (a number on one, text
    on another) is refused unless a content type narrows it;
  - a 400 carries `code: bad-query` and a `title` as well as `problems`, so
    the remote client and the back office read it the same way.
- **The window size** is a scope option (`window`, default 1,000), so the cut
  window is tested with a small window rather than 1,000 pages.
- **Tests:**
  - `tests/content-query.test.ts` on both dialects:
    - every operator on number, date, text and boolean storage;
    - structured values;
    - name and LIKE metacharacters;
    - full text;
    - states and the recycle bin;
    - place and depth;
    - dates;
    - sorting and paging;
    - the item shape;
    - refusals by name;
    - start nodes;
    - a granular Browse denial and a cut window;
    - an unreadable property;
    - the endpoint's session and section checks;
    - the remote route.
  - `tests/cli-seed.test.ts`: `content find` locally.
  - `tests/remote.test.ts`: the capability list.

## Out of scope

- A query language or saved queries.
- Changing what the Umbraco contract's own search endpoints answer.
