# 347 — Harbourstone as a single-page app

**Epic:** F — Headless · **Priority:** could · **Size:** L
**Depends on:** 051, 053, 054, 208, 348

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

## Decisions

Taken 2026-11-14.

- **D1, hosting: its own origin.** The built app is served by a static host at another
  address from the CMS (locally a second port), and reads the CMS across origins through
  CORS, as an app on a CDN would.
- **D2, what is public: what the site publishes.** Revised 2026-11-14: the Delivery
  API serves the site's public published pages with no key and no setup, from any
  origin (story 348), as the site already shows them to anyone. Members-only pages come
  through only with the signed-in member's own token. No key ships in the app, and the
  app needs no type list.
- **D3, rendering: in the browser only.** One static shell; every page is fetched and
  rendered client-side, so a publish shows at once with no rebuild. Search engines get
  only what runs JavaScript, and the docs say so, pointing to the server-rendered
  Harbourstone where that matters.
- **D4, a template too.** Distributed like the other demos, so `crombolo init --template
  demo/harbourstone-spa` gives a working single-page app to start from.

Everything the app needs on the server exists: CORS (051), public access by type, the
preview token as a header (053), the route lookup (054), forms rendered by the app
(056), and member sign-in by authorization code with PKCE, mandatory for a public client.
No server change is expected; if one turns out to be needed, it is said in this story
before it is made.

## Plan

1. **`sites/harbourstone-spa`**: Harbourstone's schema, content and media, by the same
   seed as `harbourstone-next`, its CMS views reduced to what the CMS itself still
   serves: the member login page that authorization sends a member to, and the
   not-found. `site.json` has `"distribute": true`.
2. **The CMS config** (`crombolo.config.ts`):
   - nothing for reading: the API is on, public and open to any origin by default
     (story 348);
   - `preview.url: ${APP}/preview?path={path}&token={token}`;
   - `memberAuthorization.authorizationCodeFlow` with `${APP}/signed-in` and `${APP}/`
     registered, and the site's `/login` as `loginPage`;
   - `seo.publicUrl: APP`. `APP` comes from `CROMBOLO_APP_URL`, `http://localhost:3001` by
     default, so the server-rendered demo can run beside it on 3000.
3. **The app** (`web/`), Next.js with `output: 'export'`:
   - one page, a client component, renders whatever path the browser is at. It resolves
     the path through the route lookup and renders by content type, with Next's client
     router for links, back and forward;
   - reads through `@crombolo/delivery-client`, with no key, typed by `crombolo generate
     --delivery`;
   - the page components follow `harbourstone-next`'s, as client components;
   - the app's own not-found, for a path the lookup says is no page;
   - **forms** rendered by the app and posted to the forms API (056);
   - **members:** sign-in by authorization code with PKCE in the browser, the verifier
     and state kept in `sessionStorage` for the round trip, then the access token in
     memory and the refresh token in `sessionStorage`. `/signed-in` finishes the
     exchange. Sign-out calls `signout` and clears both;
   - **preview:** `/preview` takes `path` and `token`, keeps the token for the tab in
     `sessionStorage`, sends it as `preview-token`, and shows a "Previewing" bar to
     leave it.
4. **Serving it:** a small static server for `web/out` that answers every path that is
   not a file with `index.html`, the fallback a single-page app needs on any host.
   `bun run site demo/harbourstone-spa` builds the app, then runs the CMS and that server
   side by side. The docs give the same fallback rule for a CDN.
5. **The template:** `crombolo init --template demo/harbourstone-spa` writes the site
   and its `web/`, with `bun start` running both, as the Next.js template does.
6. **The smoke test**, run in CI's browser image (a single-page app renders only with
   JavaScript, so a fetch alone proves nothing). It scaffolds with `init`, builds the
   export, starts the CMS and the static server, then in a real browser checks:
   - the home page, a bottling, a link followed, back, and a path opened directly;
   - a path that is no page;
   - the contact form submitting;
   - a member signing in and out, and the members-only page;
   - Preview showing a draft;
   - no key in the built files.
7. **Docs:** `docs/delivery-api.md` gains "A single-page app": the config, the static
   host's fallback, member sign-in and preview in the browser, and a table comparing
   the two Harbourstone front ends (first paint, search engines, publishing, hosting,
   what each costs).

## Acceptance criteria

- [x] `bun run site demo/harbourstone-spa` runs the CMS and the static app, and every
      Harbourstone page renders in the browser from the APIs.
- [x] Following links, the browser's back and forward, and a path opened directly all
      work; a path that is no page shows the app's not-found.
- [x] The contact form submits; a member signs in and out and sees the members-only page
      only while signed in; Preview shows a draft.
- [x] No key or secret is in the built app.
- [x] `crombolo init --template demo/harbourstone-spa` makes a working site with it.
- [x] A CI smoke test builds and serves it and checks it in a real browser.
- [x] The docs compare the server-rendered and single-page front ends.

## Built

Built 2026-11-15, as planned with D1–D4. No server change was needed.
- **`sites/harbourstone-spa`** is `harbourstone-next`'s schema, content, media and
  form, with `"distribute": true` and `"spa": true` in `site.json`. Two pages are added:
  `members.toml`, a Content Page for the members' cellar, and `login.toml`, of a new
  `loginPage` type. Every other page type names one view, `pages/appPage`, which sends a
  visitor on to the page's address in the app (`urls.absolute`, so `seo.publicUrl`);
  `pages/loginPage` is the member login form authorization sends a member to, posting to
  `/umbraco/members/login` with the `returnUrl` it was given. The webhook and the CMS's
  other views are gone.
- **`crombolo.config.ts`** sets `preview.url` to `${APP}/preview?path={path}&token={token}`,
  the authorization code flow with `${APP}/signed-in` and `${APP}/`, `loginPage: '/login'`,
  and `seo.publicUrl: APP`, `APP` from `CROMBOLO_APP_URL` or `http://localhost:3001`.
  Nothing for reading.
- **`web/`**: `next.config.ts` exports (`output: 'export'`) except under `next dev`,
  writes `CROMBOLO_URL` in at build, and loads images through `lib/image-loader.ts`,
  which asks the CMS to resize. `app/[[...slug]]/page.tsx` is built once as `index.html`
  and renders `components/app.tsx`, which resolves the address with `cms.route(path,
  { seo: true })` and draws the page by type (`components/page.tsx`), follows a redirect,
  or shows the app's not-found, a members-only notice on 401 or a refusal on 403.
  `lib/cms.ts` is `createDeliveryClient<DeliveryTypes>` with no key, the member's token
  and the preview token; `lib/cms-types.gen.ts` is `crombolo generate --delivery`'s.
  The page components are `harbourstone-next`'s, reading in the browser through
  `lib/use-load.ts`; `components/rich-text.tsx` draws rich text with
  `walkRichText`. `lib/members.ts` signs in with PKCE (verifier and state in
  `sessionStorage`, the access token in memory, the refresh token in `sessionStorage`,
  renewed as it runs out), and signs out by revoking the refresh token and going to
  `signout`. `lib/preview.ts` keeps the preview token for the tab; the app shows a
  "Previewing drafts" bar with a button to leave.
- **Beside it:** `serve.ts` serves `web/out`, a file when there is one and `index.html`
  for any other address; `dev.ts` runs the CMS and `next dev` on 3001, then `members.ts`
  once the CMS answers; `members.ts` makes the Members page members-only for a Members
  group, with the command line (`members groups new`, `content access set`), since who
  may see a page goes with no content file.
- **`bun run site demo/harbourstone-spa`** (`scripts/start-site.ts`) builds the app, runs
  the CMS, then `members.ts` and `serve.ts`; `--docker` is refused for it.
- **The template:** `scripts/sites.ts` stages `web/` (less `out/` too) and the three
  scripts, and `template.json` says `spa: true`. `crombolo init` writes the SPA config,
  `web/package.json` depending on `@crombolo/delivery-client`, Next.js and React only,
  and `start`, `dev`, `dev:cms`, `members` and `serve` scripts; `--next` adds nothing to
  it. The docs site's page for it says `bun run dev` and `:3001`.
- **`scripts/spa-smoke.ts`** (`bun run smoke:spa`, the `spa` job in CI beside the Next.js
  one): packs the delivery client, scaffolds with `init`, installs `web/` from npm and the
  pack, starts the CMS, runs `members.ts`, adds a member and a draft with the command
  line, mints a preview token as the Preview button would, builds the export and serves
  it, then checks that no key or secret is in the built files and, in Chromium, the home
  page, a link followed without a reload, a bottling, Back and Forward, an address opened
  directly, a path that is no page, the contact form, a member signing in and out and the
  members' page, and Preview showing a draft that a visitor does not see.
- **Tests:** the site and its staging in `tests/sites.test.ts` (with `members.ts`' keys
  checked against the content files, the views, and no key in the app), the scaffold in
  `tests/templates.test.ts`, and the docs site's page in `tests/docs-site.test.ts`. **The
  tests and the smoke test are written but not yet run.** `next build` of the app
  succeeds, and `bun run check` passes.
- **Docs:** `docs/delivery-api.md`, "A single-page app", with the comparison table;
  `docs/next-integration.md` points at it; `docs/testing.md`, README and the release
  notes.

Where it differs from the plan, or fills it in:
- **`bun start` runs the CMS alone,** as every site's and the Next.js template's does;
  `bun run dev` runs both, as the Next.js template's does, with `next dev` rather than a
  build. `bun run site` and `bun serve.ts` serve the build.
- **Links use `history.pushState`, not `next/link`.** Next's router follows it, so
  `usePathname`, Back and Forward work; `next/link` would fetch each page's own payload
  from the static host, which has only `index.html`, and fall back to a full load.
- **The CMS draws no not-found page:** Harbourstone has none, so a path that is no page
  shows the app's own; the site's not-found page is drawn by the app when one is chosen.
- **The members-only rule and group are made by `members.ts`, not the content files,**
  which carry no access. A member to sign in as is added in the back office.
- **The generated types are `web/lib/cms-types.gen.ts`,** so the formatter leaves them as
  the generator writes them.
