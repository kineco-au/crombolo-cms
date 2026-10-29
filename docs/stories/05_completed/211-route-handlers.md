# 211 — Route handlers

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** 206, 210

## Story

As a developer used to Next.js, I want to add HTTP endpoints to my site's own
addresses: an API my pages and islands call, a webhook receiver, a JSON feed.
Then they live in the site's code, with no server bundle.

## Context

Next.js has route handlers (`app/api/…/route.ts`) that export `GET`, `POST`
and so on, taking a `Request` and returning a `Response`. Crombolo's site code
can only accept requests through a server bundle's member and public routes
(186), at `/crombolo/bundle/<id>/…`, which is a packaging mechanism, not a
site's own address.

Nature's Calendar needs endpoints: its record wizard posts to an API, it
uploads photos, and the map reads JSON.

Server actions (`'use server'`), which the first draft of this story also
covered, are story 219.

## Decided (2026-10-29)

1. **Route handlers only.** Server actions are story 219.
2. **Routes are listed in `crombolo.config.ts`, with a published contract,**
   as 210 lists middleware:

   ```ts
   import { route } from '@crombolo/crombolo/routes'
   import { recordsApi } from './routes/records.ts'

   export default defineConfig({
     routes: [
       route('/api/records/:species', { GET: recordsApi.list, POST: recordsApi.add }),
       route('/hooks/inbound', { POST: inbound }, { csrf: false, rateLimit: { perMinute: 120 } }),
       ...recordsBundle.siteRoutes,
     ],
   })
   ```

   - **The contract is in `@crombolo/common`,** so a package or a bundle can
     offer routes. Only the config adds them.
   - **They load at boot,** as the config does.
   - **`fromRouteModule(path, module)`** takes a Next.js-style module (exports
     `GET`, `POST`, …) as it is.
3. **A route wins at its declared path.**
   - **Hiding a page:** when a published page sits at an address a route
     covers, the status checks raise a finding naming both. Content changes at
     runtime, so a clash cannot be refused at boot.
   - **Reserved paths:** routes under `/umbraco`, `/crombolo`, `/media` or the
     back office path are refused at boot.
4. **A handler is `(request, context) => Response | Result`.**
   - **The context:** `params` from the path, `url`, `cookies` (readable,
     with `setCookie`), `site()` (206's services as the caller), `member()`
     (looked up when asked) and `signal`.
   - **What it returns:** a `Response` goes out as it is; an `Ok` is sent as
     JSON; an `Outcome`, returned or thrown, answers its status, so 206's
     navigation functions and `unwrap()` work.
   - **206's `cookies()`, `headers()` and navigation** work inside a handler.
   - **Methods:** `GET`, `HEAD` (from `GET` when not given), `POST`, `PUT`,
     `PATCH`, `DELETE` and `OPTIONS`. Any other gets a 405 with `Allow`.
5. **Only 210's `request` stage applies to routes.** Routes are matched in its
   innermost step, before content finding. The `route` and `page` stages are
   for content pages.
6. **Errors** answer `application/problem+json`, or 206's status page when the
   request prefers HTML.
   - **A 500** carries a reference the log line shares, and its details show
     only with `CROMBOLO_SHOW_ERROR_DETAILS`.
   - **The time limit** is `CROMBOLO_ROUTE_TIMEOUT_MS`, 10 seconds by default.
     Running past it answers 504, and the handler's `signal` aborts.
7. **Caching is `private, no-store` unless the handler sets `Cache-Control`.**
   Only `GET` and `HEAD` may be cached.
8. **CSRF protection is on by default.**
   - **Who must prove it:** a cookie-authenticated `POST`, `PUT`, `PATCH` or
     `DELETE` must be same-origin (`Sec-Fetch-Site`, or a matching `Origin`)
     or carry the member's anti-forgery token (186) as a header or form field.
     Otherwise it gets a 403.
   - **Exempt:** bearer-token calls.
   - **Turning it off:** `{ csrf: false }` per route, for a webhook receiver.
9. **A site-wide rate limit, high enough to trip only on a flood.**
   - **The default:** 2,000 requests a minute per caller (the member when
     signed in, else the address), per server, answering 429 with
     `Retry-After`.
   - **Setting it:** `CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE`, with `0` for
     off. Each route may set its own `rateLimit`, or `rateLimit: false`.
10. **Bundle routes are retired, and replaced by route handlers a bundle
    defines in this contract,** with no backwards compatibility. Existing
    bundles break.
    - **Back-office routes** become route handlers too, with
      `audience: 'backoffice'`. They answer under
      `<backoffice>/crombolo/api/bundle/<id>/…`, only a bundle may declare
      them, and crombolo checks the signed-in user and the bundle's section
      first. `context.principal` is the user.
    - **A bundle's site routes** answer at paths the bundle declares, mounted
      when the site lists the bundle in `bundles`. A factory option moves them
      (`redirects({ routesAt: '/go' })`), and a clash refuses the boot by
      name.
    - **A bundle's capabilities** (`tables`, `media`, members) reach its routes
      as `context.bundle`, typed by what it declares. Site routes have none.
    - **186's rate limits and CORS** become `route()` options for every route.
    - **Removed:** `ServerBundleRoute`, audiences, `/crombolo/bundle/<id>/…`
      and `bundle.js`'s route helpers. `simple-redirects` and `entra` move
      over.
    - **The bundle schema version is incremented.** There is no explicit one
      today, so this story introduces `crombolo.schemaVersion` in a bundle's
      `package.json` at `2` (absent means `1`). A bundle below `2` is refused
      at boot and at install, with a message naming the route change and
      `docs/bundles.md`.

## Acceptance criteria

- [x] `@crombolo/common` has the route contract (`route`, `RouteHandler`,
      `RouteContext`, `SiteRoute`), and `@crombolo/crombolo/routes`
      re-exports it bound to crombolo's types, with `fromRouteModule`. The API
      surface snapshot and `docs/api.md` list it.
- [x] `routes` in the config answers each declared path with its params, at
      the site's own addresses, ahead of content finding.
  - Paths under `/umbraco`, `/crombolo`, `/media` or the back office path,
    and two routes claiming one pattern, refuse the boot by name.
  - A route that hides a published page is a finding.
- [x] Methods: as declared, `HEAD` from `GET`, `OPTIONS` answering with
      `Allow`, and any other a 405 with `Allow`.
- [x] A handler's context and return values work as decided:
  - a `Response`, an `Ok` (as JSON), or an `Outcome` (thrown or returned);
  - 206's `cookies()`, `headers()`, navigation and `site()`;
  - `setCookie`;
  - `member()`.
- [x] 210's `request` stage wraps routes, and a request-stage rewrite can
      target a route.
- [x] Errors are problem+json or the HTML status page, as the request prefers,
      and a 500 has a reference. `CROMBOLO_ROUTE_TIMEOUT_MS` answers 504 and
      aborts `signal`.
- [x] Caching is `private, no-store` unless the handler sets `Cache-Control`,
      and only `GET` and `HEAD` may be cached.
- [x] CSRF is checked as decided, with bearer calls exempt and `csrf: false`
      per route.
- [x] Rate limits: the 2,000-a-minute default
      (`CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE`) and per-route `rateLimit`,
      answering 429 with `Retry-After`.
- [x] Bundles define routes in this contract:
  - back-office routes gated by user and section;
  - site routes mounted with the bundle and movable;
  - capabilities as `context.bundle`.

  186's route machinery and `/crombolo/bundle/` are gone. `simple-redirects`
  and `entra` use the new routes. No browser test drives their screens; their
  screens call the same back-office paths as before, which their unit tests
  cover.
- [x] `crombolo.schemaVersion` is `2` for bundles. Below it, a bundle is
      refused at boot and install with a message pointing at the change.
- [x] `docs/rendering.md` ("Route handlers"), `docs/writing-components.md`
      (the Next.js table), `docs/configuration.md` and `docs/bundles.md`
      describe it. Unit tests cover routing, reserved paths, clashes, methods,
      the context, results, middleware, errors, the time limit, caching, CSRF,
      rate limits and bundles.

## Implementation (2026-10-29)

- **`packages/common/src/routes.ts`:** the contract. `route()` refuses
  method names HTTP has no handler for. `RouteOptions` covers `csrf`,
  `rateLimit`, `members`, `cors` and `audience`.
- **`packages/server/src/routes.ts`:**
  - `siteRouteProblems` refuses reserved paths, paths that are not paths, bad
    patterns and clashes.
  - `createRoutes` returns `match`, `handle` and `invoke`. `invoke` handles,
    in order: CORS, then the method, the rate limit, members, CSRF, the
    handler under `requestScope` and the time limit, the result, cookies and
    caching.
  - Problems are `application/problem+json`, and the status page answers a
    request that prefers HTML.
- **`server.ts`:** one route table, the config's routes followed by each
  listed bundle's site routes.
  - `siteFiles` consults it first, inside the `request` middleware stage, so a
    rewrite can reach a route. The `route` and `page` stages never run for one.
  - Bundles' back-office routes go through the same `invoke`, with the checks
    off, since the back office has already authenticated and checked the
    section.
  - The status checks gain a Site group with "Routes and pages"
    (`adapters/health.ts`), fed by `hiddenByRoutes`.
- **Bundles (`bundles.ts`):** the route types, audiences, limiters and
  `/crombolo/bundle/` dispatch are gone.
  - `ServerBundle.routes` is `BundleRoute[]`, and its context adds `bundle`,
    `caller` and, on a back-office route, `principal`.
  - Validation refuses back-office routes that are not plain paths, or that
    carry `members`, `rateLimit` or `cors`. It also refuses duplicate routes,
    and a server bundle below `crombolo.schemaVersion` 2.
  - `backoffice-host`'s `validateBundlePackage` refuses the same schema
    version at install (`BUNDLE_SCHEMA_VERSION`).
- **`@crombolo/crombolo/routes`** binds the contract to `SiteServices` and
  `RequestMember`, and adds `fromRouteModule` for Next.js `route.ts` modules.
- **Config:** `routes`, `routeTimeoutMs` (`CROMBOLO_ROUTE_TIMEOUT_MS`, 10000)
  and `routeRateLimitPerMinute` (`CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE`,
  2000).
- **Tests:** `tests/routes.test.ts`, which replaces
  `bundle-site-routes.test.ts`, covers:
  - the pipeline with stand-in members: declaring, methods, results, errors,
    the time limit, caching, other origins, CSRF, members and limits;
  - the route-module adapter and the anti-forgery script;
  - a real site: the site's and a bundle's routes, members by cookie and
    bearer token, middleware around routes, the hidden-page check, and an
    `api` node.

  `server-bundles`, `bundle-media`, `security` and every fixture with a
  server half were moved to the new shape.

**Found while building:**
- **The bundle's member caller was always marked `via: 'cookie'`.** The
  route's `extra` is now told which way the member signed in.
- **CORS was decided as a route option but not in the first cut.** It reuses
  the Delivery API's allow-list and its pre-flight helpers.
