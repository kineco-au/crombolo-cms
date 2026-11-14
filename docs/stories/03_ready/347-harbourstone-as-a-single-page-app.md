# 347 — Harbourstone as a single-page app

**Epic:** F — Headless · **Priority:** could · **Size:** L
**Depends on:** 051, 053, 054, 208

## Story

As a developer choosing how to build a front end on Crombolo, I want the Harbourstone
demo as a single-page app, built with Next.js and run entirely in the browser
against the headless APIs, so that I can see how a client-side app reads pages,
media, forms, members and previews, beside the server-rendered version.

## Context

`sites/harbourstone-next` is Harbourstone with a Next.js front end in `web/`, but it
renders on the server. Its pages are fetched on the server with
`@crombolo/next-integration`, the Delivery API key stays on the server, Draft Mode and
the preview go through Next's own route handlers, and member sign-in keeps its session
in a cookie that only the server reads.

A single-page app has none of that. Next.js builds it as static files
(`output: 'export'`), and the browser does everything:

- **It calls the APIs across origins.** Every read crosses from the app's origin to the
  CMS, which story 051's CORS settings allow. A key in the bundle would be public, so
  what the app reads has to be publicly readable (`deliveryApi.publicAccess`), or
  narrowed by type.
- **Routing is the app's.** A path the browser opens, and every link it follows, is
  resolved through the route lookup (story 054) and rendered client-side. A path that
  is not a page needs the app's own not-found, since the static host answers every path
  with the app.
- **Members sign in from the browser,** with the authorization code flow and PKCE
  (`memberAuthorization.authorizationCodeFlow`), and the app holds the token.
- **Preview** reaches the app with a token in its address (story 053), which the app
  sends to the API rather than setting a server cookie.
- **Search engines** get what a static build prerenders, or the shell alone for
  anything only the browser renders.

## Proposed

- **`sites/harbourstone-spa`**: the same schema and content as Harbourstone, by the
  same bundle, with a Next.js app in `web/` built as a static export.
- **Every Harbourstone page**: home, the bottlings and one bottling, the comparison,
  the contact form and a members-only page. Each is fetched in the browser through
  `@crombolo/delivery-client`, typed by `crombolo generate --delivery`.
- **Forms** rendered by the app itself (story 056) and posted to the forms API.
- **Members:** sign in and out through the authorization code flow with PKCE, and a
  members-only page that shows only once signed in.
- **Preview:** the Preview button opens the app on the draft.
- **A smoke test** in CI, as the Next.js front ends have (`smoke:next`): build the
  export, serve it beside the CMS, and check a page, a bottling, the form and preview
  through a real browser.
- **Docs:** `docs/next-integration.md` (or `delivery-api.md`) compares the two
  Harbourstone front ends: what each costs and when to choose it.

## Decisions to take

- **D1, where the app is served:** from the CMS's own `public/` (one origin, no CORS,
  but tied to the CMS), or a separate static host on another origin (the honest SPA
  case, needing CORS).
- **D2, what is public:** the whole Delivery API readable without a key, or only the
  types the app shows (`allowedContentTypeAliases`), with members-only pages through the
  member's token.
- **D3, prerendering:** pure client rendering (one `index.html`, simplest, invisible to
  search engines without JavaScript), or a static export that prerenders every page at
  build time and fetches only what changes, at the cost of a rebuild to publish.
- **D4, a template or a demo only:** offered by `crombolo init --template` as a starting
  point, or kept in the repository as a demo.

## Acceptance criteria

- [ ] `bun run site demo/harbourstone-spa` runs the CMS and the static app, and every
      Harbourstone page renders in the browser from the APIs.
- [ ] Following links, the browser's back and forward, and a path opened directly all
      work; a path that is no page shows the app's not-found.
- [ ] The contact form submits; a member signs in and out and sees the members-only page
      only while signed in; Preview shows a draft.
- [ ] No key or secret is in the built app.
- [ ] A CI smoke test builds and serves it and checks it in a browser.
- [ ] The docs compare the server-rendered and single-page front ends.
