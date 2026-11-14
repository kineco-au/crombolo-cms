# 348 — The Delivery API serves what the site publishes, with no setup

**Epic:** F — Headless · **Priority:** should · **Size:** S
**Depends on:** 050, 051

## Story

As a developer building a front end on a Crombolo site, I want the Delivery API to
answer with the site's public published pages straight away, from any origin, so that
reading what anyone can already see in a browser needs no key, no environment
variables and no configuration.

## Context

The Delivery API is off unless a site turns it on (`enabled: false`,
`CROMBOLO_DELIVERY_API`), as Umbraco's `DeliveryApi:Enabled` is. When it is on, it is
public by default (`publicAccess: true`). It leaves out members-only pages unless the
request carries a member's own token, and never serves unpublished or draft content
without a preview token. Reading across origins needs each origin listed
(`cors.allowedOrigins`, `CROMBOLO_DELIVERY_API_CORS_ORIGINS`). `*` is accepted only
while the API is public.

So a browser app on another origin, such as story 347's, needs two settings before it
can read pages anyone can already open as HTML. Neither protects anything: the public
read answers are the site's public pages.

## The design

- **On by default.** `enabled` defaults to `true`. `enabled: false` (or
  `CROMBOLO_DELIVERY_API=false`) still turns it off.
- **It serves what the site shows.** As now: published content only, members-only
  pages only to their members' tokens, drafts only with a preview token, and the
  type filters where a site sets them. A key opens nothing a visitor cannot see
  unless `publicAccess` is turned off.
- **Any origin for public reads.** `cors.allowedOrigins` defaults to `*` while
  `publicAccess` is on. No credentials are allowed: member and preview tokens travel in
  headers, never ambient cookies, so a page elsewhere cannot borrow them. Listing
  origins narrows it. With `publicAccess` off, the default is no origins, as now.
- **Media** stays off by default (`media.enabled`). Its files are already served at
  their own addresses; the media API is a separate decision.
- **`CROMBOLO_DELIVERY_API_PRIVATE`** replaces `CROMBOLO_DELIVERY_API_PUBLIC`
  (decided 2026-11-14). Unset or anything but `true`, the API follows what the site
  publishes; `true` makes it private, every request needing the key. In the config it
  stays `deliveryApi.publicAccess`, Umbraco's name, and the config wins over the
  variable as everywhere. `CROMBOLO_DELIVERY_API_PUBLIC` has shipped: a site that set
  it to `false` to be private would quietly become public if it were ignored, so while
  it is set the server refuses to start, saying to use `CROMBOLO_DELIVERY_API_PRIVATE`,
  as `CROMBOLO_CONTENT_FILES_READONLY` is refused (story 343).
- **The upgrade note** says plainly that after this release a site's public pages are
  readable as JSON, and how to turn it off.

## Plan

1. **The defaults**, in one place, `resolveDeliveryApiSettings`
   (`packages/api-delivery/src/settings.ts`):
   - `enabled` defaults to `true`, in place of `false`;
   - `cors.allowedOrigins`, when nothing sets it, defaults to `['*']` while
     `publicAccess` is on, and to none while it is off. An explicit list, empty
     included, is kept as given, so a site can still close it with `allowedOrigins: []`.

   The environment path (`config.ts`) already leaves an unset variable undefined, so
   it falls through to these. `corsPolicy` (`cors.ts`) already turns `*` into "any
   origin" only while the API is public, with no credentials; nothing changes there.
2. **The settings list** (`packages/server/src/settings.ts`), and `config.ts`:
   - `CROMBOLO_DELIVERY_API` defaults to `true`, said as "on; `false` turns it off";
   - `CROMBOLO_DELIVERY_API_PRIVATE` (boolean, default `false`) in place of
     `CROMBOLO_DELIVERY_API_PUBLIC`, read into `publicAccess: !private`. The old name
     is read only to refuse it, and is named in `tests/settings-list.test.ts` as
     retired;
   - `CROMBOLO_DELIVERY_API_CORS_ORIGINS` defaults to "any origin while the API is
     public".

   `docs/configuration.md`'s table is regenerated (`bun run docs:config`).
3. **What a site scaffolds:** `crombolo init`'s Next.js config (`NEXT_CONFIG` in
   `packages/cli/src/templates.ts`) and `sites/harbourstone-next` set `enabled: true`
   and an origin list. Both stay as they are, since they still say what the site needs
   and an explicit list is honoured. The product site and the docs' examples are
   checked for anything now redundant or misleading.
4. **Docs:**
   - `docs/delivery-api.md`: "Settings" (on by default, why, and how to turn it off)
     and "Requests from another origin" (any origin for public reads by default, why it
     is safe, and how a list narrows it);
   - `docs/features.md` if it says the API is opt-in;
   - the release notes, a Features bullet and an **upgrade note**: after this release a
     site's public published pages, members-only and drafts excepted, are readable as
     JSON at `/umbraco/delivery/api/v2/` and `/crombolo/delivery/api/v2/`, from any
     origin; `CROMBOLO_DELIVERY_API=false` or `deliveryApi.enabled: false` turns it off.
     A second note: `CROMBOLO_DELIVERY_API_PUBLIC` is refused; a site that set it to
     `false` sets `CROMBOLO_DELIVERY_API_PRIVATE=true` instead, and one that set it to
     `true` removes it.
5. **Tests:**
   - `tests/delivery-api.test.ts`, "settings": on by default, with `*` while public and
     none while private;
   - a default site's public page read cross-origin with no key, the answer carrying
     `Access-Control-Allow-Origin: *` and no credentials;
   - a members-only page left out without its member's token and served with it;
   - a draft only with a preview token;
   - `enabled: false` answering 404;
   - an explicit origin list narrowing CORS, and `allowedOrigins: []` closing it;
   - `publicAccess: false` needing the key and allowing no origin;
   - `CROMBOLO_DELIVERY_API_PRIVATE=true` making it private, unset leaving it public,
     and `CROMBOLO_DELIVERY_API_PUBLIC` set at all stopping the start with the message.

   The existing tests that assumed the API off by default
   (`contentAccess(resolveDeliveryApiSettings(), …)` is false, and the default-off
   assertions) are rewritten to the new default, not deleted. Both engines.

## Acceptance criteria

- [x] With no Delivery API settings, a fresh site answers its public published pages
      through the API, from another origin, with no key.
- [x] A members-only page is left out without its member's token and served with it;
      a draft only with a preview token; an unpublished page never.
- [x] `enabled: false` turns it off; listed origins narrow CORS; `publicAccess: false`
      or `CROMBOLO_DELIVERY_API_PRIVATE=true` needs the key and allows no origin unless
      listed.
- [x] `CROMBOLO_DELIVERY_API_PUBLIC`, still set from before, stops the server at start,
      naming `CROMBOLO_DELIVERY_API_PRIVATE`.
- [x] `docs/delivery-api.md`, `docs/configuration.md` (regenerated) and the release
      notes' upgrade notes say what changed.
- [x] Tests on both engines.

## Built

- `resolveDeliveryApiSettings` (`packages/api-delivery/src/settings.ts`): `enabled`
  defaults to `true`; with no origin list, `cors.allowedOrigins` is `['*']` while public
  and none while private, and a list given, an empty one too, is kept as it is.
- `CROMBOLO_DELIVERY_API_PRIVATE` in place of `CROMBOLO_DELIVERY_API_PUBLIC`
  (`deliveryApiPublic`, `server/src/config.ts`), the old name refused at start; the
  settings list and `docs/configuration.md` say the new defaults.
- `docs/delivery-api.md`, "Settings" and "Requests from another origin"; the release
  notes, with two upgrade notes.
- Tests: `tests/delivery-api.test.ts` (the defaults, a default site read across origins
  with no key, off answering 401, an empty list closing CORS), `tests/config-env.test.ts`
  (the variable, and the old one refused), `tests/settings-list.test.ts`. Members-only,
  draft and unpublished handling is unchanged, under its existing tests.
