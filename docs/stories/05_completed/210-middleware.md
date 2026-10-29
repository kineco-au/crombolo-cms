# 210 — Middleware

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer used to Next.js, I want a `middleware.ts` in my site that runs
before any page is resolved. It should redirect, rewrite, set headers and
cookies, or answer outright for the paths it matches. Then concerns that
belong to the request, not a page, live in one place.

## Context

Next.js runs `middleware.ts` (renamed `proxy.ts` in Next.js 16) before routing,
for paths its `matcher` selects. It returns `NextResponse.next()`,
`redirect()`, `rewrite()` or a response, and can set headers and cookies on
the way through. Typical uses:
- geography or language redirects;
- A/B cookies;
- legacy URL patterns too broad for a redirect table;
- security headers;
- an early 401 for an area.

Crombolo has fixed request handling. Its redirects (`simple-redirects`,
`umbracoRedirect`) match exact URLs, and anything broader means editing the
server. Story 206 handles what happens inside a page; this is what happens
before one is found.

## Decided (2026-10-29)

1. **A chain in the config, not a file found by name.** Middleware is code a
   site imports and lists, as it lists server bundles:

   ```ts
   // crombolo.config.ts
   import { securityHeaders } from '@acme/crombolo-security'
   import { regionRedirect } from './middleware/region.ts'

   export default defineConfig({
     middleware: {
       request: [securityHeaders(), regionRedirect({ default: 'en' })],
       route: [legacyPaths()],
       page: [auditTrail],
     },
   })
   ```

   - **Explicit:** the import is the switch, and deleting the line turns it
     off.
   - **One path:** every way a site starts reads it from the config.
   - **Loaded at boot.** In development `bun --watch` restarts on an edit; in
     production a change is a deploy, as for the config itself.
   - **No `middleware.ts` or `proxy.ts` convention.**
2. **The contract is published,** so anything meeting it can be inserted:
   the site's own code, an npm package's factory, or a server bundle's.

   ```ts
   export type Middleware = MiddlewareHandler | {
     name: string                   // for logs and errors
     matcher?: string | string[]    // Next.js's matcher syntax; every site path when left out
     handle: MiddlewareHandler
   }

   export type MiddlewareHandler = (
     request: Request,
     next: (request?: Request) => Promise<Response>,
     context: MiddlewareContext,
   ) => Response | Promise<Response>

   export interface MiddlewareContext<Site = unknown> {
     url: URL
     cookies: ReadonlyRequestCookies  // reading marks the answer personal
     site(): Site                     // 206's site(), as the visitor
     page?: PublishedContent          // the page found, in the route and page stages
     member?: RequestMember           // the signed-in member, in the page stage
     preview: boolean
     signal: AbortSignal              // the chain's time limit, or the visitor leaving
   }
   ```

   - **The chain is an onion, outermost first.** A middleware answers
     outright by not calling `next`, changes the request by calling
     `next(changed)`, and changes the answer by returning `next()`'s
     `Response` altered. The innermost `next` is Crombolo: redirects, public
     access, content finding and rendering.
   - **Changed request headers and cookies** reach 206's `headers()` and
     `cookies()`.
   - **`next(rewrite(request, '/other'))`** renders `/other` at the address
     asked for. Only site paths may be targets.
   - **Plain web types:** `Request` and `Response`, with Crombolo's extras in
     `context`. The helpers are `rewrite(request, path)` and
     `withCookie(response, cookie)`.
   - **Guarantees:**
     - it runs for site requests only;
     - a `matcher` is applied before the handler;
     - reading `context.cookies`, or a `Set-Cookie` on the answer, makes it
       `private, no-store`, while path-only redirects and rewrites stay
       cacheable;
     - one time limit for the whole chain, 2 seconds by default, with a throw
       or overrun answering 206's error page and the log naming the
       middleware;
     - in preview it runs with the editor as the visitor, and a redirect
       shows the editor a notice.
   - **Bundles may supply middleware** through an optional `middleware` field,
     but only the config puts it in the chain.
   - **`fromNextMiddleware(fn, { matcher })`** wraps a Next.js-style
     `(request: NextRequest) => NextResponse` as one link.
3. **`@crombolo/common` holds the contracts the outside world codes against.**
   - It is a new package with no dependencies and nothing server-side, built
     to JavaScript with types, like the delivery client, and supported in
     `docs/api.md`.
   - It holds 206's `Result`, `Ok`, `Outcome`, `ok`, `isOk`, `isOutcome`,
     `FieldError` and `assertSafeLocation` (moved from `@crombolo/core`, which
     re-exports them), and this story's middleware contract and helpers.
   - `@crombolo/crombolo/server` and a new `@crombolo/crombolo/middleware`
     re-export it for sites, the latter with `MiddlewareContext` bound to
     `SiteServices`.
   - `@crombolo/next-integration` depends on it, and its copy of `result.ts`
     and the parity test go. This revisits 208's decision 8.
   - It is the first step of this story. Sites and apps see no change: the
     same names come from the same entry points.

4. **The chain sees site requests only:**
   - site pages, the not-found page included;
   - story 211's site routes;
   - `/css/` and `/scripts/`.

   It never sees the back office, the Management or Delivery APIs, member
   sign-in, form posts, `/crombolo/islands`, bundle endpoints, `/media/`,
   `/sitemap.xml` or `/robots.txt`, and a rewrite into any of them is refused.
   A per-middleware opt-in for more (`scope: 'media'`) can come later if a site
   needs it.

5. **Matchers are evaluated with Bun's built-in `URLPattern`,** whose path
   syntax is Next.js's: `:param`, `*`, regex groups and negative lookaheads.
   There is no new dependency. The object form `{ source, has, missing }`
   adds Next.js's conditions on cookies and headers. Tests cover the examples
   in Next.js's documentation.

6. **A rewrite goes to a site path and is resolved in full, once:** the
   redirect tables, public access, content finding and rendering, as a request
   for that path would be.
   - A rewrite to a page that redirects answers the redirect, and a rewrite to
     a members-only page applies its rules.
   - The page sees the rewritten request's query, or the original one when
     the rewrite gives none.
   - The address stays as the visitor asked, and the answer is cached under
     it. `<SeoHead>`'s canonical names the page that rendered.
   - Rewriting to another origin, as a proxy, would be a later story.

7. **The site chooses where each middleware runs, among three named stages,
   and access always applies.** `middleware` in the config groups them:

   | Stage | Runs | Can see | Can do |
   |---|---|---|---|
   | `request` | first, before the redirect tables and content finding, as Next.js runs middleware | the request | answer, redirect, rewrite, change headers and cookies |
   | `route` | after the redirect tables and content finding | `context.page` | redirect, rewrite (the new path is resolved again), answer |
   | *access* | *always, on the page that finally renders* | | |
   | `page` | after access, before rendering | `context.page`, `context.member` | change the answer's headers, cookies and body; a rewrite is refused |

   - **Each stage is its own onion.**
   - **Access is checked on the final page,** after every stage that can
     change which page that is, so no position skips it. `context.site()`
     acts as the visitor everywhere.
   - **The member's session is looked up only when it is needed:** in the
     `page` stage, or when a middleware asks for it.
   - **Crombolo's internal steps are not public API;** only the three stages
     are.
   - **A per-middleware default `stage`,** for packages, can be added later.

## Acceptance criteria

- [x] **`@crombolo/common`** exists:
  - no dependencies, built to JavaScript with types and published;
  - it holds `Result`, `Ok`, `Outcome`, `ok`, `isOk`, `isOutcome`, `FieldError`
    and `assertSafeLocation`, moved from `@crombolo/core` (which re-exports
    them), and the middleware contract with `rewrite` and `withCookie`;
  - `@crombolo/next-integration` depends on it, and its copy of `result.ts`
    and the parity test are gone;
  - sites and apps import the same names from the same entry points as
    before.
- [x] **`@crombolo/crombolo/middleware`** exports the contract, with
      `MiddlewareContext` bound to `SiteServices`, plus `fromNextMiddleware`.
      The API surface snapshot and `docs/api.md` list it.
- [x] **`middleware: { request, route, page }`** in the config runs each
      stage's middleware as an onion, in the order listed:
  - **`request`:** before the redirect tables and content finding;
  - **`route`:** after content finding, with `context.page`;
  - **`page`:** after public access, with `context.page` and
    `context.member`. A rewrite there is refused.

  Public access is always checked on the page that finally renders.
- [x] **Only site requests** pass through: pages (the not-found page
      included), 211's routes, `/css/` and `/scripts/`. Never the back
      office, the APIs, member, form, island or bundle endpoints, `/media/`,
      `/sitemap.xml` or `/robots.txt`. A rewrite into any of them is refused.
- [x] **Matchers** use `URLPattern` with Next.js's syntax, including negative
      lookaheads and `{ source, has, missing }`, and are tested against
      Next.js's documented examples. Without a matcher, a middleware runs
      for every site path.
- [x] **Each outcome works:**
  - answering outright;
  - redirecting;
  - `next(changed)`, whose request headers and cookies reach 206's
    `headers()` and `cookies()`;
  - a rewrite, resolved in full at the new path, with its query (or the
    original carried over), the address unchanged and the canonical naming
    the real page;
  - changing the answer's headers and cookies after `next()`.
- [x] **Caching:** reading `context.cookies`, or a `Set-Cookie` on the answer,
      makes it `private, no-store`. A redirect or rewrite decided from the
      path alone stays cacheable.
- [x] **Errors:** the chain has one time limit (2 seconds by default,
      `CROMBOLO_MIDDLEWARE_TIMEOUT_MS`). A throw or overrun answers 206's
      error page with a reference, the log names the middleware, and other
      requests are unaffected.
- [x] **Preview:** the chain runs with the previewing editor as the visitor,
      `context.preview` true, and a redirect shows the editor a notice.
- [x] **Bundles:** a server bundle may export `middleware`, and it runs only
      where the config lists it.
- [x] **Docs:** `docs/rendering.md` ("Request pipeline") shows the stages.
      `docs/configuration.md` covers `middleware`, and `docs/bundles.md`
      covers a bundle's middleware. Unit tests cover each stage, matching,
      every outcome, exclusions, access after a rewrite, caching, errors,
      preview and the adapter.

## Implementation (2026-10-29)

- **`packages/common`** (`@crombolo/common`): `result.ts`, moved from core,
  which re-exports it; and `middleware.ts`, the contract, `rewrite`,
  `withCookie` and the cookie types (render's `headers.ts` now uses those).
  - It is built to JavaScript by `scripts/built-package.ts`, renamed from
    `next-integration.ts` and now covering both packages.
  - `@crombolo/next-integration` imports `Result` from it. Its copy and the
    parity test are gone, and the smoke test packs `common` too.
- **`packages/server/src/middleware.ts`**:
  - `runStage`, the onion. Each handler is timed against the chain's shared
    budget, with its clock stopped while it awaits `next()`.
  - `matches` (`URLPattern`, plus `has` and `missing`), `isSitePath`,
    `requestCookies` and `MiddlewareError`.
- **`server.ts`:** `siteRequest` runs the `request` stage around `siteFiles`
  (`/css/`, `/scripts/`, pages).
  - `renderSite` runs the `route` stage after content finding. An address the
    redirect tables or `umbracoRedirect` answer skips the later stages.
  - `pageStage` runs after the access decision and refuses a rewrite.
  - `finishChain` makes the answer private when cookies were read or set, and
    turns a redirect in preview into the notice.
  - `middlewareFailure` logs by name with a reference and answers the error
    page.
  - Site services take the member lazily, so the session is looked up only
    when it is needed.
- **Config:** `middleware: { request, route, page }` and `middlewareTimeoutMs`
  (`CROMBOLO_MIDDLEWARE_TIMEOUT_MS`, 2000). `ServerBundle` gains `middleware`.
- **`@crombolo/crombolo/middleware`** binds the contract to `SiteServices`,
  `PublishedContent` and `RequestMember`, and adds `NextResponse` and
  `fromNextMiddleware`.
- **Tests:** `tests/middleware.test.ts`, covering matchers, the helpers, every
  stage and outcome, exclusions, rewrites (including refused ones), caching,
  errors and the time limit, the Next.js adapter, and preview. Also additions
  to `packaging`, `api-surface` and `next-integration`.

**Found while building:**
- **Spreading the context would read `cookies`** and mark every answer
  personal, so the runner assigns `stage` instead of spreading.
- **Reading through `site()` in middleware does not mark the answer
  personal,** as it does in a page: the render scope isn't there. A
  middleware deciding per visitor says so through `context.cookies` or its
  own `Cache-Control`, as the docs tell it to.
