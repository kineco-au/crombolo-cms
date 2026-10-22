# 054 — One lookup answers a route

**Epic:** F — Headless · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a front-end developer, I want to send the path a visitor asked for and be
told whether it is a page, a redirect or nothing, so that my app's router
behaves like the server-rendered site, and old links still work.

## Context

`item/{path}` resolves a published page or answers 404. It knows nothing of the
URL tracker's redirects, rules declared in `crombolo.config.ts`, or the
`simple-redirects` bundle ([`seo.md`](../../seo.md),
[`operations.md`](../../operations.md)), and nothing of the site's not-found
page. A server-rendered request gets all of that from the router. An app has to
rebuild it, so in practice old URLs break after a move.

Umbraco's Delivery API has the same gap; this is a Crombolo addition alongside
`search`.

## Acceptance criteria

- [x] `GET .../route?path=…` answers exactly one of: the page, as `item/{path}`
      would, with its culture; a redirect, with the target URL and whether it is
      permanent; or not found, with the site's configured not-found page when
      there is one
- [x] Redirects resolve in the order the server-rendered router uses: declared
      rules, the URL tracker, then bundle redirect providers
- [x] The hostname (a `Host`-style header or parameter) picks the root and
      culture the same way domains do for the rendered site
- [x] Members-only pages answer 401 or 403 as the item endpoints do; preview
      requests follow story 053 once it ships
- [x] Documented in `delivery-api.md`; tests on SQLite and Postgres

## What was built

- `GET v2/route` in `packages/api-delivery/src/handler.ts` (`routeLookup`): the
  published or draft cache's `resolve(host, path)` — domains, wildcard cultures
  and `umbracoRedirect` included — then `cache.redirect(host, path)`, then a new
  `notFound(host, path)` port the server answers from `seo.notFound`. The page
  goes through the item endpoints' own `servable`, access and output, in the
  culture the address chose (a new argument to `contentRequest`, winning over
  `Accept-Language`).
- *Decision:* every redirect source is already one table read in one order
  (configured, tracked, then the bundle's manual rules), so the lookup asks the
  same `redirect` the renderer does rather than ordering sources itself.
- *Decision:* a redirect and a page are `200`s with `kind`; not found is a `404`
  with a body, so a CDN and a browser treat it as the miss it is. Redirects are
  `no-store`, like the site's.
- Caching (story 057) and CORS (story 051) cover it like the other content
  endpoints; `@crombolo/delivery-client` gained `route()` and `RouteAnswer`.
- Tests: `tests/delivery-route.test.ts` (a page, `umbracoRedirect`, a hostname's
  root and culture, members-only, a draft in preview, declared before tracked, a
  live page beating a rule, the not-found page, a missing path) and the client's
  `route()` in `tests/delivery-client.test.ts`.
