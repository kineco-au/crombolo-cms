# 208 — A Next.js front end

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer who wants the full React and Next.js experience (client
components, streaming, the npm component ecosystem), I want a supported way
to build a site's front end in Next.js against Crombolo. Then I get Next.js's
tooling while editors keep Crombolo's back office, preview and publishing.

## Context

Crombolo renders pages itself, with its own JSX runtime, and stays that way:
templates are editable at runtime, routing comes from the content tree, and
caching is shared across servers (see the 2026-10-29 discussion recorded in
206). For sites that want Next.js instead, most of what a headless front end
needs already exists:
- **The Delivery API** (`docs/delivery-api.md`) gives pages, media, menus,
  forms, search, search-and-sharing details, members-only pages and route
  lookup. Route lookup answers a redirect as
  `{ kind: 'redirect', location, statusCode }`.
- **Preview** has preview tokens and a Preview button that opens an
  external app (`preview.url`).
- **Typed content:** `@crombolo/delivery-client` is a typed client with no
  dependencies. `crombolo generate --delivery` writes the site's types for it.
- **Member sign-in** works through Delivery API member tokens.
- **Webhooks** fire on publish, with a secret header. Pages carry purge tags
  (their own key and their ancestors').

What is missing is the Next.js glue every such site would otherwise write
again: the catch-all route, Draft Mode, revalidation on publish, images,
rich text and blocks as React components, and metadata.

## Decided (2026-10-29)

1. **Where it lives:** `packages/next-integration`, published as
   `@crombolo/next-integration`. It is released with the rest, built to
   JavaScript like `@crombolo/delivery-client`, and depends only on that
   client. App Router only.
2. **Next.js versions:** the current major and the one before (16 and 15).
   There is one internal caching adapter per major, and both are built and
   smoke-tested in CI.
3. **Caching is hybrid:**
   - **Static public pages** use tagged data-cache entries and the full-route
     cache, cleared by the publish webhook with `revalidateTag`.
   - **Pages rendered per request** (reading cookies or the query) revalidate
     each fetch with `If-None-Match` against a kept copy, reusing it on 304.
   - **Member and Draft Mode fetches** are never kept.
   - **`revalidate: 'etag'`** uses ETags everywhere, for a site that wants no
     webhook.

   Tags come from both sources: the content keys the client collects from
   each answer, and the Delivery API's purge-tag header when the CMS sends
   one.
4. **Clearing parent pages:** a webhook payload option, `payload =
   "crombolo"`, adds `ContentType` and `Ancestors`. They are captured when
   the change is committed, so they survive a delete. The revalidation
   handler clears the item's tag and each ancestor's.
5. **Member sessions:** authorization code with PKCE in route handlers. The
   access and refresh tokens are kept in one encrypted, http-only cookie
   (`CROMBOLO_NEXT_SECRET`, `SameSite=Lax`, `Secure`) and refreshed on the
   server when the access token expires. Sign-out revokes the refresh token.
6. **Starter shape:** every template uses one layout, the Crombolo site at
   the root and a Next.js app in `web/`, with the Next dependency added or
   removed as needed. One `bun dev` starts both.
   - `crombolo init --template next` is the empty site template plus the
     Next.js app and its dependencies.
   - `demo/harbourstone-next` is Harbourstone rebuilt on Next.js from the
     same schema and seed. The TSX Harbourstone stays as the demo of
     Crombolo's own rendering.
   - harbourstone-next adds a **whisky comparison page**, rendered in the
     browser. A `comparisonPage` content type places it. A server component
     fetches every expression once, cached and tagged, and hands them to a
     `'use client'` component. Visitors choose bottlings on the fly, filtered
     by kind and product type, up to four side by side. The comparison
     shows the bottle, ABV, age, batch and summary, with tasting notes
     aligned by aspect and differences highlighted. The selection is kept in
     the URL (`?compare=a,b,c`).
7. **Rich text:** the API's HTML for now. `<RichText>` sets it as HTML and
   makes internal links client-side navigations. Rich text as a JSON tree is
   story 216, and `<RichText>` renders that tree once 216 ships.
8. **`Result`:** 206's `result.ts` is copied into the package, with a test
   that keeps the two identical. Code across the two checks outcomes with
   `isOutcome` (a shared `Symbol.for` brand), never `instanceof`.

## Acceptance criteria

- [x] `@crombolo/next-integration` exports `createCrombolo({ url, apiKey })`, built on
      `@crombolo/delivery-client` and typed by `crombolo generate --delivery`
      output. It gives `page(slug)`, a `Result` (route lookup, answering content, a
      redirect or not-found), `menu`, `search`, `forms` and the media helpers.
- [x] **A catch-all route:** the starter's `web/app/[[...slug]]/page.tsx`
      resolves through `page()`, calls Next.js's `redirect()` or
      `notFound()` on those outcomes, and picks a component by content type
      from a map.
- [x] **`generateMetadata`** from the page's search-and-sharing details:
      title, description, canonical, alternates and the share image.
- [x] **Draft Mode:** a route handler verifies a Crombolo preview token,
      enables Draft Mode and redirects to the page. In Draft Mode, fetches send
      `Preview: true` and the token. Crombolo's `preview.url` points the
      Preview button at it.
- [x] **Revalidation:** a route handler checks the webhook's secret in
      constant time and revalidates by tag, the page's key and its
      ancestors' from the `crombolo` payload. Every cached fetch is tagged
      with the keys it read, or the purge-tag header. Pages rendered per
      request revalidate with `If-None-Match`. Member and Draft Mode
      fetches are never kept.
- [x] **Webhook payload:** a webhook may set `payload = "crombolo"` to
      receive `{ Id, ContentType, Ancestors }`, with the ancestors captured
      at commit.
- [x] **Images:** a `next/image` loader that writes Crombolo's imaging query
      (width, quality, format, crop and focal point). Protected media works
      for a member through their token.
- [x] **Content:** `<RichText>` and `<BlockList>` / `<BlockGrid>` React
      components render Crombolo's values, with a component map for blocks.
      Unknown blocks render nothing in production and a notice in Draft Mode.
- [x] **Members:** sign-in and sign-out through Delivery API member tokens
      with PKCE. The tokens are kept in an encrypted http-only cookie and
      refreshed when they expire, with members-only pages resolved for the
      member.
- [x] **Starter:** `crombolo init --template next` scaffolds the empty site
      with the Next.js app in `web/`, wired for preview, revalidation and
      member sign-in, and `bun dev` starts both. Every template uses the same
      layout.
- [x] **`demo/harbourstone-next`** renders Harbourstone's content through
      Next.js, with the whisky comparison page above. The route lookup's
      not-found item honours 206's `pages.notFound`.
- [x] Unit tests cover the client, the route handlers and the components with
      a fake Delivery API. A CI job builds the starter against both supported
      Next.js majors and runs a smoke test of route, preview and revalidation.
- [x] `docs/delivery-api.md` gains "A Next.js front end", and the README
      mentions it.

## Implementation (2026-10-29)

- **`packages/next-integration`** (`@crombolo/next-integration`):
  - `index.ts`: `createCrombolo`, `page()` as a `Result`, `resolvePage`,
    `metadataOf`, the `fresh` reads and `member()`;
  - `cache.ts`, plus `cache-16.ts` (`'use cache'`, `cacheTag`, `cacheLife`) and
    `cache-15.ts` (fetch tagged with the site's tag);
  - `route-handlers.ts`: preview, exit, revalidate, member sign-in, callback,
    sign-out, and media;
  - `middleware.ts`: session refresh and route answers;
  - `session.ts`: AES-GCM cookies, PKCE and constant-time secrets;
  - `components.tsx` and `client.tsx`: `<RichText>`, `<BlockList>`,
    `<BlockGrid>`;
  - `image-loader.ts`;
  - `result.ts`: 206's, copied, with a parity test.

  It is built to JavaScript by `scripts/next-integration.ts` (`tsc`, file for
  file, so directives stay put) and published by `scripts/publish-packages.ts`.
- **The delivery client** gained `preview`, `seo`, `onAnswer` with
  `contentKeysIn`, `conditional` with `memoryConditionalStore`, `sitemap` and
  `form`.
- **The server:**
  - the route lookup's not-found item comes from `resolveStatusPage` first;
  - `WebhookDefinition.payload` (`'crombolo'`, file-only) and `webhookPayload`
    send `ContentType` and `Ancestors`, read in the change's transaction by
    `itemFacts`, with the original parent for a trashed page.
- **The CLI:**
  - `packages/cli/next-app/` is the app skeleton;
  - `templates/next` is the empty site with it;
  - `scaffoldFiles` writes `web/` when the template says `next` or `init
    --next` asks. It also writes the generated `web/package.json`, both `.env`
    files with fresh secrets, the revalidation webhook and `dev.ts`.
  - `scripts/sites.ts` ships a repo site's `web/` in its template.
- **`sites/harbourstone-next`** is Harbourstone's schema and seed, with a
  `comparisonPage` type and a Next.js app in `web/`, including the comparison
  page.
- **Tests:** `tests/next-integration.test.ts` (Next.js's modules stood in for,
  against a real Delivery API), plus additions to `webhooks`, `delivery-client`,
  `delivery-route`, `templates` and `packaging`. `scripts/next-smoke.ts`
  (`bun run smoke:next`) builds and runs a scaffolded app per Next.js major, and
  CI's `next` job runs it for 15 and 16 on both templates.

**Found while building:**
- **Partial Prerendering sends a page's status before its content streams,** so
  `notFound()` or `redirect()` in a page that was not prerendered cannot
  change it. The proxy therefore looks each page address up first (revalidated
  by ETag), and a static `app/crombolo/not-found` route answers misses with a
  404. That also keeps a CMS redirect's own 301 or 302, which Next's
  `redirect()` cannot send.
- **`cacheComponents` needs the catch-all's paths:** `generateStaticParams`
  lists the sitemap's pages, and the home page so it is never empty.
- **Next.js 15 reads `next.config.ts` through TypeScript's JavaScript API,**
  which TypeScript 7 lacks, so a site on 15 keeps TypeScript 5.
- **A type with no template has no address to the sitemap and site search,**
  as in Umbraco. `demo/harbourstone-next` therefore keeps Harbourstone's
  templates, plus one for `comparisonPage`, so the CMS can still render each
  page. Counting such pages on a site an app renders is story 217.
- **Biome's React and Next.js rules** are scoped to `sites/*/web`,
  `packages/cli/next-app` and `packages/next-integration`. The root listing
  `react` would otherwise apply them to Crombolo's own JSX.
- **The package re-exports the delivery client's `Api*` types,** so an app
  depends on it alone.
- **Crombolo's payload is set in the webhook's file only.** The Management API's
  webhook model has no field for it, so a database column would have been
  unreachable.
