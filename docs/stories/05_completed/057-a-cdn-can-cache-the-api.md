# 057 — A CDN can cache the site and the API

**Epic:** F — Headless · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As someone running a site behind a CDN, I want pages, Delivery API answers and
media to say how long they may be kept and whether they changed — site-wide,
per content or media type, and per page or media item when an editor needs it —
so that repeat requests are served without reaching the site, and nothing
private is ever kept.

## Context

Checked 2026-10-22:

| Response | Cache-Control | ETag |
|---|---|---|
| Rendered pages | nothing | none |
| Delivery API answers | nothing (a preview: `no-store`, story 053) | none |
| Media files and resized images | `public, max-age=31536000, immutable` | the store's |
| `/sitemap.xml`, `/robots.txt`, the form script | `public, max-age=3600` (`no-cache` in development) | none |
| Redirects | `no-store, must-revalidate` | — |

- **No content or media type has a caching setting**, in the schema or the type
  editor. Umbraco has none either: its only control is a server-side output
  cache for the Delivery API (`DeliveryApi:OutputCache`, a content and a media
  duration), in configuration, with no headers.
- **Members-only pages and server-rendered previews send nothing**, so a CDN set
  to cache HTML can keep a member's page or an editor's draft and serve it to
  anyone. This story fixes that whatever else is configured.
- **A media file's address never changes content**: a replaced file is placed in
  a new random folder (`media-files.ts`), so `immutable` is right for the bytes.
  What an editor may want per item is the opposite — not to keep copies of a
  file that might have to be withdrawn.
- When the media store serves its own files (`publicUrl`: a bucket or CDN), only
  the redirect is ours; the file's headers are the store's.
- Purging on publish is already possible with a webhook
  ([`webhooks.md`](../../webhooks.md)), but only the whole CDN at once.

### Decisions (2026-10-22)

- **Pages and the Delivery API share one setting.** Media files keep their own
  default.
- **Nothing is kept unless a site says so.** Public pages and API answers send
  no lifetime by default, so no site starts serving stale pages on upgrade.
  ETags and the private fix apply regardless.
- **Three levels, each optional:** site-wide in code or the environment;
  per content or media type alias in code; per page or media item, set by an
  editor, when the type opts in. The narrowest one set wins.
- **Cache tags, off by default:** an optional header listing the content keys
  in an answer, so a CDN can purge only what a publish changed.

### Also decided

Proposed with the plan and built as proposed:

- **Media files stay `immutable` for a year** unless a media type or item says
  otherwise. Changing the default to "keep nothing" would make every image a
  round trip to the site for no gain, since the bytes at an address never
  change.
- **Per page and per item is a composition**, as `seoFields` is: a system
  content type (`cacheFields`) and a system media type (`mediaCacheFields`) a
  site composes into the types whose editors should see it. One property,
  "Keep copies for", a dropdown: *Site default*, *Don't keep copies*, *1
  minute*, *5 minutes*, *1 hour*, *1 day*. Shipping a system *media* type to
  compose is new; `seoFields` is a document type only.
- **The settings live under a new top-level `cache` section**, not
  `deliveryApi`, since they cover pages too.
- **A query answer** (a list of pages) takes the shortest lifetime among the
  pages in it, and the site default when it is empty.

## Plan

1. **Settings.** `cache: { maxAge, staleWhileRevalidate, types: { [alias]: {
   maxAge, staleWhileRevalidate } }, tagHeader }` in `crombolo.config.ts`;
   `CROMBOLO_CACHE_MAX_AGE`, `CROMBOLO_CACHE_STALE_WHILE_REVALIDATE` and
   `CROMBOLO_CACHE_TAG_HEADER` (`Surrogate-Key` or `Cache-Tag`). Media types sit
   in `types` with content types, by alias. Unset: no lifetime.
2. **The per-item compositions.** `cacheFields` and `mediaCacheFields`, seeded
   with the built-in types and composable from `schema/`, with the dropdown
   above. Read by alias (`cacheKeepFor`), so a site that never composes them
   pays nothing.
3. **One policy.** A pure `cachePolicy(settings, item)` in `@crombolo/render`:
   the item's own value, else its type's, else the site's — `public,
   max-age=…, stale-while-revalidate=…`, `no-store` for *Don't keep copies*, or
   nothing. Anything that varies by who is asking — a member signed in, a
   members-only page, a non-public API with its key, a preview — is `private,
   no-store`, always.
4. **Pages.** `renderSite` sets the page's policy, an ETag over the HTML, and
   answers `If-None-Match` with a `304`. Members-only and preview renders get
   `private, no-store`.
5. **The Delivery API.** Items and media items take their own policy, queries
   and search the shortest of what they hold; an ETag over the JSON and `304`s;
   `Vary` already names the headers an answer depends on.
6. **Media files.** `immutable` unless the item's or its type's setting says
   otherwise; `no-store` for *Don't keep copies*. Resized images follow their
   original.
7. **Cache tags**, when `tagHeader` is set: a page lists its own key and its
   ancestors'; an API answer every content key it contains and, for a query,
   the page it fetched from; a media file its key. The docs show a publish
   webhook purging the published page's and its ancestors' tags.
8. **Docs and tests.** `delivery-api.md`, `rendering.md`, `operations.md`
   ("Behind a CDN"), `configuration.md` regenerated; tests for each level, the
   private cases, `304`s and tags. Schema changes for the compositions mean a
   migration and the dialect runs.

## Acceptance criteria

- [x] With nothing configured, public pages and API answers carry no lifetime,
      as today; media files stay `immutable`
- [x] `cache.maxAge` and `cache.staleWhileRevalidate` (code or environment) set
      the lifetime of public pages and API answers
- [x] `cache.types` sets a content or media type's lifetime by alias, in code
- [x] A type that composes `cacheFields` or `mediaCacheFields` shows "Keep
      copies for" to editors, and a page's or media item's choice wins over its
      type's and the site's; *Don't keep copies* sends `no-store`
- [x] Members-only pages, answers to a member's token or a non-public API's key,
      and previews are `private, no-store` whatever is configured
- [x] Pages and API answers carry an ETag, and a matching `If-None-Match` is a
      `304` with no body
- [x] With `cache.tagHeader` set, answers list the content keys they hold in that
      header; without it, no tags are sent
- [x] A query answer's lifetime is the shortest of the pages it holds
- [x] `operations.md` documents running behind a CDN, with a publish webhook
      purging by tag and by everything
- [x] Tests on SQLite and Postgres

## What was built

- **Fields.** `cacheFields` (a system content type, beside `seoFields`) and
  `mediaCacheFields` (a built-in media type with a new `composition` flag, so it
  is not allowed at the root and is left out of `crombolo generate --delivery`'s
  media types), each with one `cacheKeepFor` property on the new seeded
  `keepCopiesFor` dropdown (`KEEP_COPIES_FOR` in core). All ensured at boot by
  key, so no migration. The two properties need different keys: a property key
  is unique across every type, and sharing one left the page type's empty.
- **Settings.** `cache` in `CromboloConfig`; `CROMBOLO_CACHE_MAX_AGE`,
  `CROMBOLO_CACHE_STALE_WHILE_REVALIDATE`, `CROMBOLO_CACHE_TAG_HEADER`.
- **The policy**, `packages/render/src/cache-policy.ts`: `resolveCacheSettings`,
  `lifetimeFor` (item, type, site — `{ site: false }` for media files),
  `shortest`, `cacheControl`, `etagFor` / `notModified`, `tagValue`, and
  `cacheable`, which finishes a public `200` with all of them or answers `304`.
- **Pages** (`renderSite`): personal when a member is signed in, for a preview
  or a form's answer, or when the access check finds the routed page protected
  — checked as an anonymous visitor in the renderer's `access` callback, so the
  login page shown at a members-only address is caught too.
- **The Delivery API**: each answer records what it holds (`holding`), and
  `finish` sets the lifetime, ETag and tags, or `private, no-store` for a member's
  token (with member sign-in on) or a non-public API (`personal`). `keysIn`
  collects every key in the JSON for tags.
- **Media files**: `PublishedCache.mediaAt(url)` (a per-snapshot map) finds the
  item; its or its type's lifetime replaces `immutable`; resized images follow.
- Tests: `tests/cache-headers.test.ts`.
