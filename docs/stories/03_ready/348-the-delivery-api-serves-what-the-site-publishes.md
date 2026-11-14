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
- **The upgrade note** says plainly that after this release a site's public pages are
  readable as JSON, and how to turn it off.

## Acceptance criteria

- [ ] With no Delivery API settings, a fresh site answers its public published pages
      through the API, from another origin, with no key.
- [ ] A members-only page is left out without its member's token and served with it;
      a draft only with a preview token; an unpublished page never.
- [ ] `enabled: false` turns it off; listed origins narrow CORS; `publicAccess: false`
      needs the key and allows no origin unless listed.
- [ ] `docs/delivery-api.md`, `docs/configuration.md` (regenerated) and the release
      notes' upgrade notes say what changed.
- [ ] Tests on both engines.
