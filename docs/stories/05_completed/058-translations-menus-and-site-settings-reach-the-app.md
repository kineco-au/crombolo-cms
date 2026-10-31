# 058 — Translations, menus and site settings reach the app

**Epic:** F — Headless · **Priority:** could · **Size:** L
**Depends on:** 141

## Story

As a front-end developer, I want the site's translated labels, its menus and
its site-wide settings from the API, so that editors can change them without a
new release of the app.

## Context

A rendered site reads these through helpers: `dictionary('key')` for
translations ([`rendering.md`](../../rendering.md)), and `menu('header')` once
story 141 ships. Umbraco's Delivery API has no dictionary endpoint, so headless
Umbraco sites copy translations into the app or fetch a settings page by
convention. Site-wide settings (a phone number, social links, a banner) are
usually a page under the root that the app must find by content type.

## Decisions (2026-10-31)

1. **Site settings are a content type marked as the site's settings.** A type
   in `schema/` declares `site-settings = true`; editors keep one such page per
   site. `GET settings` answers the one under the request's root (its
   `Start-Item`, or its host's), as a content item; rendered templates get the
   same as a `settings` prop. Not chosen: settings as Library elements by alias,
   as menus are, which needs the app to know the aliases and a naming scheme
   for several sites; documenting the `fetch=children:/&filter=contentType:…`
   query that already works, which leaves templates out and the app to know
   the type's alias.
2. **The settings page is a direct child of its site's root, and visitors never
   see it.** It has no address: it is not routed, and is left out of the
   sitemap, search, navigation and menus. At most one per root: with two, the
   first in the tree's order wins and a status check names both; one deeper in
   the tree is not the site's settings, and the check says so. `content/item`
   by key still answers it. Not chosen: anywhere under the root, found by type
   (harder to explain and to find); the home page itself carrying the settings
   (mixes them into its own fields, and fails a site whose root is not the
   carrier).

## Plan

1. **The flag** (as `site-search` on a type is carried today):
   - migration 057, `AddSiteSettingsTypes`: `content_type.site_settings`,
     boolean, false; undone in every test rewind;
   - `site-settings = true` under `[content-type]` in `packages/schema`'s
     parser, model and export, and through the sync to the column, so the
     back office's type editor keeps it when it writes the file;
   - refused on an element type, which is never a page.
2. **The published cache** (`packages/render/src/published-cache.ts`): the
   snapshot keeps each root's settings page, the first child of the root whose
   type is a settings type. Settings pages get no route, and are left out of
   navigation, menus, the sitemap and search (their type's `site-search` is
   treated as off). `settings(rootKey, culture)` answers it.
3. **Templates:** a `settings` prop, the settings page under the current page's
   root, or `null`; in layouts too, as `dictionary` is
   (`docs/rendering.md`).
4. **The Delivery API** (`packages/api-delivery/src/handler.ts`, and its
   contract additions in `packages/contracts`):
   - `GET dictionary`: every item in the request's culture as
     `{ "key": "text" }`, each falling back as `dictionary()` does, `''` where
     none does; `?keys=a,b` narrows it, an unknown key answering `''`;
   - `GET settings`: the settings page under the request's root (`Start-Item`,
     else its host's root, else the first root), as a content item, `expand`
     and `fields` included; `404` when there is none;
   - both follow content access (an API key when the API is not public) and
     preview, and carry story 057's `Cache-Control`, `ETag` and purge tags (the
     page's keys for settings, the dictionary's for the dictionary).
5. **Clients:** `dictionary(keys?)` and `settings()` in
   `@crombolo/delivery-client` and the Next.js client; `crombolo generate
   --delivery` types `settings()` by the site's settings type.
6. **A status check** (group Site): two settings pages under one root, or one
   deeper than a root's child, each named.
7. **The demo:** Harbourstone gets a settings type and page for its footer,
   read by both the rendered site and the Next.js one.
8. **Tests** on SQLite and Postgres: the parser and sync; the cache leaving
   settings pages out of routes, navigation, menus, the sitemap and search; the
   template prop; both endpoints for culture, fallback, `keys`, `Start-Item`,
   host, access, preview and caching; the status check; the clients.
9. **Docs:** `docs/delivery-api.md` (sections for both, "Not built" updated),
   `docs/rendering.md`, the schema reference for `site-settings`, the release
   notes.

## Acceptance criteria

- [x] `GET .../dictionary` answers every item for a culture as a flat map of key
      to text, falling back as `dictionary()` does; `?keys=` narrows it
- [x] `GET .../menus/{name}` answers a menu for a culture with each item's label,
      URL and children, leaving out unpublished and members-only pages the
      caller cannot open — built with menus themselves, in story 141
      (`GET v2/menus/{alias}`)
- [x] Site settings are reachable in one request, `GET settings`: the settings
      page under the request's root, as decided above
- [x] A settings page has no address: it is left out of routing, navigation,
      menus, the sitemap and search; two under one root, or one deeper, are
      named by a status check
- [x] Rendered templates read the same page as a `settings` prop
- [x] `@crombolo/delivery-client` and the Next.js client have `dictionary()`
      and `settings()`, typed by `crombolo generate --delivery`
- [x] All three follow the API's access rules and the caching of story 057
- [x] Documented in `delivery-api.md`; tests on SQLite and Postgres

## What was built

- **The flag:** migration 057 (`AddSiteSettingsTypes`) adds
  `content_type.site_settings`; `site-settings = true` is parsed, written back,
  exported and synced as `site-search` is, and refused on an element type.
- **The published cache** (`packages/render/src/published-cache.ts`): a page of
  a settings type has URL `#` and no segment, so neither it nor anything below
  it is routed; it is left out of child lists, roots, menus (`menuPage`) and the
  sitemap, kept by id and key. Each culture view holds its roots' settings
  pages; `settings(rootKey, culture)`, `rootForHost(host)`,
  `settingsFindings()` and `dictionaryEntries(culture, keys)`.
  `Navigation.isSettings` lets the Delivery API give it route path `#`. Site
  search skips settings types, in the indexer and the re-index signature.
- **Templates:** the `settings` prop, in `usePage()` too.
- **The Delivery API:** `GET dictionary` (purge tag `crombolo-dictionary`) and
  `GET settings`, with content access, preview and story 057's caching.
- **Clients:** `dictionary(keys?)` and `settings()` in
  `@crombolo/delivery-client` and the Next.js client; `SettingsItem` narrows by
  the `settings` aliases `crombolo generate --delivery` now writes.
- **The status check** "Site settings" (group Site).
- **The demos:** both Harbourstones have a `siteSettings` type and page, and
  their footers read it.
- **Tests:** `tests/site-settings.test.ts`; 057 undone in every rewind.
- **Docs:** `docs/delivery-api.md`, `docs/rendering.md`, `docs/schema-as-code.md`,
  the release notes.
- **Not chosen while building:** any page of a settings type has no address,
  not only the one that counts, so one filed in the wrong place is never shown
  to visitors either.
