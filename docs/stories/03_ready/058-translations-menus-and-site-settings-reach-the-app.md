# 058 — Translations, menus and site settings reach the app

**Epic:** F — Headless · **Priority:** could · **Size:** M
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

### Decision to make before starting

- **Site settings:** a named entry point (a content type marked as the site's
  settings, read by one request) or documentation of the
  `fetch=children:…&filter=contentType:settings` convention that already works.

## Acceptance criteria

- [ ] `GET .../dictionary` answers every item for a culture as a flat map of key
      to text, falling back as `dictionary()` does; `?keys=` narrows it
- [x] `GET .../menus/{name}` answers a menu for a culture with each item's label,
      URL and children, leaving out unpublished and members-only pages the
      caller cannot open — built with menus themselves, in story 141
      (`GET v2/menus/{alias}`)
- [ ] Site settings are reachable in one request, as decided above
- [ ] All three follow the API's access rules and the caching of story 057
- [ ] Documented in `delivery-api.md`; tests on SQLite and Postgres
