# 053 — An app previews drafts

**Epic:** F — Headless · **Priority:** should · **Size:** L
**Depends on:** 051

## Story

As an editor on a headless site, I want the backoffice's Preview button to show
my unpublished changes in the real app, so that I can check a page before I
publish it.

## Context

Two things are missing. The Delivery API accepts `Preview: true` with the API
key but answers from the published cache. And the Preview button opens the
backoffice's own preview of the server-rendered page
([`rendering.md`](../../rendering.md), "Preview"), which a headless site does not
have.

Umbraco serves drafts to a preview request with the API key and leaves the
button to a URL provider registered in C#. An API key is a server secret, so an
app running in the browser cannot hold it; previewing in a browser-only app
needs a short-lived token issued to a signed-in editor instead.

Today's server-rendered preview loads the one page being previewed
(`draftModel`, `loadDraftNode`) and takes everything else — navigation, routes,
pickers — from the published cache, so an unpublished child, a link to an
unpublished page, or a page under an unpublished parent is missing from it.
There is no draft cache: `PublishedCache` is published-only by design, but it is
generic over a `PublishedContentSource`, and `DocumentRepository.loadCurrent()`
already reads what an editor sees now.

Umbraco's Preview button runs the first `previewOption` workspace action menu
item registered for `Umb.WorkspaceAction.Document.SaveAndPreview`, which calls
`GET document/{id}/preview-url?providerAlias=…`; an answer with
`isExternal: true` opens in a new window, and an external preview asks for a
new URL on every click, "to obtain a fresh preview token". A `previewOption`
manifest is JSON only. Crombolo's handler ignores `providerAlias` today.

### Decisions (2026-10-21)

- **Credential:** the API key keeps working, as in Umbraco, for a server; an app
  in the browser gets a **preview token**, signed with a key kept in the
  database (`ensureKeyValue`, as forms and member cookies are) and sent as
  `Preview-Token`.
- **Scope:** a token reads every draft **the editor may read** — start nodes and
  Read, checked page by page, as `canReadDocument` checks the built-in preview —
  so the app can follow links inside the preview.
- **Lifetime:** **60 minutes**, configurable; each Preview click issues a new one.
- **The button:** with an app preview URL configured, **Preview opens the app**;
  the built-in preview stays in the button's menu.
- **Live reload: not in this story.** Clicking Preview saves and reopens the
  same window. A save notice for apps is a later story if someone asks.

## Plan

1. **A draft cache.** A second `PublishedCache` over a draft source (the
   published source with `loadCurrent` in place of `loadPublished`), built on
   the first preview request and dropped on any document save, so a site that
   never previews pays nothing. Unpublished pages are in its navigation, so
   their routes and the pickers that point at them resolve.
2. **The Delivery API reads it.** `createDeliveryApi` takes the draft cache as a
   port and uses it for content when `Preview: true` carries a valid key or
   token. A page with no route gets Umbraco's `preview-<key>` path, and
   `item/preview-<key>` resolves only in preview. Members-only rules still
   apply. Search stays published (its index is); media has no drafts.
   Preview answers are `Cache-Control: no-store`.
3. **The token.** `{ user, expires }` plus the user's security stamp, signed
   with HMAC-SHA256 (`crombolo/previewTokenKey`). On every request: the
   signature, the expiry, the user still approved, not locked out and with an
   unchanged stamp, and `canReadDocument` for each page served — a page the
   editor may not read is answered as if it were not there. `Preview-Token`
   joins the CORS allowed headers (story 051).
4. **Settings**, in code or the environment, as the rest of `deliveryApi`:
   `preview.url` (`CROMBOLO_DELIVERY_API_PREVIEW_URL`), `preview.urls` per
   content type alias (code only), and `preview.tokenMinutes`
   (`CROMBOLO_DELIVERY_API_PREVIEW_TOKEN_MINUTES`, default 60). A URL without a
   scheme and host is said at boot and ignored.
5. **The button.** A `previewOption` manifest, "Preview in app", provider alias
   `cromboloAppPreview`, weighted above the built-in one, included only when a
   preview URL is configured. `GetDocumentByIdPreviewUrl` branches on the
   provider: for the app it issues a token, fills `{path}`, `{id}`,
   `{culture}` and `{token}`, answers `isExternal: true` and sets no preview
   cookie; otherwise it does what it does today.
6. **Docs and tests.** `delivery-api.md` ("Preview"), `rendering.md`'s preview
   section, `configuration.md` regenerated; tests on SQLite and Postgres.

## Acceptance criteria

- [x] With `Preview: true` and a valid key or preview token, item, items, path
      and query requests answer from the latest saved version: unpublished
      pages, drafts of published pages, and pickers and blocks pointing at
      either; without one it is refused as today
- [x] `item/preview-<key>` resolves a page by key only in preview (every page in
      the draft cache has a route, so none needs `preview-<key>` as its path)
- [x] Draft answers are `Cache-Control: no-store` and never reach a published
      answer; the draft cache is built only when someone previews and is dropped
      on any save
- [x] A preview token is issued only to an editor allowed to read the page,
      lasts `preview.tokenMinutes` (60 by default), reads only what that editor
      may read, and stops working when the editor is locked out, disapproved or
      their security stamp changes
- [x] Members-only rules still apply to a preview request; with a member token
      the app sees what that member would see
- [x] With `preview.url` set (or a `preview.urls` entry for the page's type), the
      Preview button opens the app at that URL with `{path}`, `{id}`,
      `{culture}` and `{token}` filled in; the built-in preview stays in the
      button's menu. With neither set, nothing changes
- [x] The settings can be set in code or the environment, and a malformed URL is
      said at boot
- [x] Documented in `delivery-api.md` and `rendering.md`; tests on SQLite and
      Postgres

## What was built

- **Drafts in the data layer.** `DocumentRepository.loadDrafts()` reads every
  page not in the bin as last saved, in `loadPublished`'s shape and slices, its
  cultures those with a name (`available`); the current-value reading it shares
  with `loadCurrent` is `#currentValueRowsFor`. `latestContentVersionId(db)` is
  the staleness check. `restore` now posts a content instruction, the one tree
  change that announced nothing.
- **The draft cache** (`server.ts`): `createPublishedContentSource(…, { drafts:
  true })` under a second `PublishedCache`, made on demand, replaced when the
  newest version id moves, and dropped through a new `onInvalidate` option on
  the published cache.
- **The Delivery API** takes a `preview(request, keyed)` port. `previewAccess`
  decides: drafts for the key or a valid token, a 401 otherwise. The content
  request reads from the chosen cache, and `mayRead` — `canReadDocumentAt`, a
  synchronous form of `canReadDocument` split out in `authorization.ts` — leaves
  out what the editor may not read. Answers get `Cache-Control: no-store`.
  `Preview-Token` joined the CORS headers.
- **Tokens**, `packages/server/src/preview-tokens.ts`: `{ user, stamp, expires }`,
  HMAC-SHA256 with a key in `key_value`; the stamp is a digest of the user's
  security stamp. `AuthService.identityOf(userId)` resolves an editor without a
  session, and `principalFrom` (split out of `authenticate`) makes the
  principal.
- **The button**: `plugin/app-preview/umbraco-package.json`, served only when
  `previewsInApp` (and the API is on); `PreviewPort.inApp` and
  `APP_PREVIEW_PROVIDER` in the Management API; the document handler branches on
  the provider. The page's path is its draft URL's path.
- **Settings**: `preview.url`, `preview.urls`, `preview.tokenMinutes` in
  `DeliveryApiSettings`; `CROMBOLO_DELIVERY_API_PREVIEW_URL` and
  `CROMBOLO_DELIVERY_API_PREVIEW_TOKEN_MINUTES`; `previewProblems` at boot.
- Tests: `tests/delivery-preview.test.ts` (drafts with the key, no-store and the
  preview address, refusals, a save another node made, members-only, the button
  and its manifest, a restricted editor's token, lockout and stamp changes, a
  type with no address, token tampering and expiry, the URL rules), and the
  settings in `tests/config-env.test.ts` and `tests/settings-list.test.ts`.
