# 446 — A site open only to its back-office users

**Epic:** D — Members and identity · **Priority:** should · **Size:** M
**Depends on:** 031, 305

## Story

As someone running a copy of a site that isn't for the public (an intranet, a staging
copy, the place content is made before it is served elsewhere), I want the whole site
open only to people who can sign in to its back office, so that nothing on it is seen by
anyone else, whatever its pages' own rules say.

## Context

A page's Public Access decides which members may see it. Nothing decides that a whole
site is closed to everyone but its own staff. Today that takes a proxy in front of the
CMS. But only the CMS knows its own cookies, how a session is refreshed, which of its
paths are its sign-in, and which roles serve the back office. A `web` node serves no back
office, so a proxy in front of one can't ask who a request signs in as.

`031` lets a back office sign people in through a provider, and with
`allowLocalLogin: false` that provider is the only way in. Even so, the back office
still shows its login screen with one button.

## The design

- **A setting:** `siteAccess: 'public' | 'users'` (`CROMBOLO_SITE_ACCESS`), `public` by
  default.
- **With `users`, every request needs a signed-in back-office user**, on every role:
  pages, media, the site's own routes, member sign-in pages, search, the hubs and the
  Delivery API. The session is the back office's own, read and refreshed as the back
  office does.
- **Not gated:** the back office's sign-in flow and its assets, and `/health`. Neither is
  anything that checks its own credentials: the Management API, the plugin's API routes,
  and the remote (`364`'s token exchange included).
- **Someone not signed in:**
  - a browser `GET` or `HEAD` goes to the back office's sign-in, coming back to the same
    path, kept to a path on the site;
  - anything else is `401` with problem details.
- **A user signed in is let in whatever their groups.** Who may sign in at all is for
  the provider and the back office to decide, as now.
- **The Delivery API** also takes its key (`CROMBOLO_DELIVERY_API_KEY`), so a front end
  with the key still reads it.
- **A workspace's address keeps its own access** (`379`): a link made for someone with no
  account still opens it.
- **Every answer is marked `X-Robots-Tag: noindex, nofollow`** and
  `Cache-Control: private`, and `robots.txt` disallows everything.
- **No login screen when there is one way in:** with `allowLocalLogin: false` and a
  single provider, the back office goes straight to that provider, here and with
  `public` too. A refused or failed sign-in shows the back office's error, with a way to
  try again, and is never sent round the sign-in again.
- **Preview** is the back office's, and is unchanged. A preview link (`368`) still opens
  its draft for a browser with no session, as a workspace's link does.

## Decided (2026-11-27)

1. **An expired access token: a live refresh token lets the request in, never
   rotated.** Refreshing rotates the token, and presenting an already-rotated one ends
   the session (`AuthService.refresh`). A page's parallel requests refreshing at once
   would sign the person out, so the gate never refreshes. Instead it reads the refresh
   cookie and checks it as the access path checks a token: unrevoked, unexpired, its
   session alive and its user active. That gives the refresh token nothing it can't
   already do at the token endpoint. Reading the site never extends the session, and
   signing out, an ended session or a disabled user closes the site at once. Rejected:
   - bouncing through sign-in each time the access token expires, which breaks a
     page's calls midway through;
   - a site-only cookie, which is a second credential to issue and revoke.
2. **The back office's cookies are stripped** from the headers the renderer, the site's
   code and its middleware see, with `public` too. Today every page request carries a
   signed-in editor's access and refresh tokens to the site's own code.
3. **The setting:** `siteAccess: 'public' | 'users'` (`CROMBOLO_SITE_ACCESS`), `public`
   by default.
4. **Going straight to the provider needs no setting of its own.** With
   `allowLocalLogin: false` and one provider, the screen offers nothing else.

## The plan

- **Why any node can check a session:** sessions are reference tokens in the shared
  database, and the cookies are `Path=/` with no domain. `AuthService` is built on every
  role, `web` included, so the gate (`site-access.ts`) resolves a session there with no
  back office.
- **The same host:** the cookies are host-only, so the site and its back office must
  be on one host. `docs/configuration.md` says so, and boot logs a warning when
  `applicationUrl`'s host isn't one the site answers on.
- **Let through:**
  - the back office's sign-in flow and its assets, and `/health`;
  - the Management API, the plugin's API routes and the remote, `364`'s exchange
    included, because each checks its own credentials;
  - the Delivery API with its key;
  - a workspace's link (`379`, `415`) and a preview link (`368`), each by its own token.
- **Everything else** needs a back-office user in any group: pages, media, the site's
  routes, member sign-in pages, search, the hubs, and the Delivery API without its key.
- **Writes from another site:** a write that relies on the cookie and comes from
  another origin is refused, as `identify()` refuses one today.
- **Not signed in:** a browser `GET` or `HEAD` goes to the back office's sign-in, with
  `returnPath` kept to a path on this site. Anything else gets a `401` with problem
  details.
- **Headers:** every answer gets `X-Robots-Tag: noindex, nofollow` and
  `Cache-Control: private`, overriding a page's own, and `robots.txt` disallows
  everything.
- **The provider's sign-in:** the login route sends the browser to the one provider's
  challenge, keeping the return path. A callback that comes back with an error shows the
  screen with the error and Try again, and doesn't redirect again.
- **The refresh token is never logged.**

## Acceptance criteria

- [x] **With `users`,** a browser not signed in at a page, a protected page, media, a
      member's sign-in page or a site route goes to the back office's sign-in and back
      to that path; an API call without a session is `401`, and a write relying on the
      cookie from another site is refused.
- [x] **Signed in,** each opens as it would on a public site, on an `all` node and on a
      `web` node, including after the access token has expired while the session lives.
- [x] **Signing out, an ended session or a disabled user** closes the site at once, and
      reading the site never extends a session.
- [x] **The site's code never sees the back office's cookies,** with either setting.
- [x] **The Delivery API** answers with the key and without a session.
- [x] **The Management API** with a bearer token is unchanged.
- [x] **A workspace's link and a preview link** each open for a browser with no account.
- [x] **Every answer** carries `noindex, nofollow`, and `robots.txt` disallows all.
- [x] **With one provider and no password sign-in,** the back office opens on the
      provider, not the login screen; a refused sign-in shows its error and doesn't loop.
- [x] **With `public`,** the site behaves as today.
- [ ] **Tests** on both dialects and both roles; the browser suite covers the sign-in;
      `docs/configuration.md`, `docs/changes.md` and the release notes updated.

## Built

- **The gate** is `packages/server/src/site-access.ts`, used by `route()` in `server.ts`.
  `/health` answers first; the Delivery API asks for its key or a user before it
  dispatches; the remote and everything `serveBackOffice` answers (the sign-in, its
  assets, the Management API, the plugin's API routes) go through untouched, as each
  checks its own credentials; then everything else needs a user, except `robots.txt`
  (disallow all) and a request already inside a workspace's site. A preview link is let
  through on its first use (`?crombolo-preview=`), then by its cookie for its one page and
  what a page loads (`/css/`, `/scripts/`, islands, generated scripts, deferred parts,
  `/media/`, public files). The event hubs' WebSocket upgrade asks the same.
- **Signed in** is `createSiteGate`: a real bearer access token; else, from the cookies,
  the access token, then the refresh token, then the session, each read only:
  `AuthService.resolveRefreshToken` (unrevoked, unexpired, its session open, its user
  approved and not locked out) and `AuthService.resolveActiveSession`. Nothing is
  refreshed or rotated, nothing logged but a refused cross-site write's method and path.
  A cookie-carried write from another origin is refused by the same `isSameOrigin` rule
  `identify()` uses.
- **Deviation: the session cookie counts too.** A sign-in through the login page, by
  password or by provider, leaves only the session cookie: the access and refresh tokens
  are issued later, by the back office's own OAuth exchange. Without it, coming back
  to the page asked for would be sent round the sign-in again. It is read as the
  back office's authorize endpoint and `/device` page read it, and ended by sign-out.
- **Not signed in:** `notSignedIn` sends a browser navigation (`GET`/`HEAD`, no
  `Authorization`, `Sec-Fetch-Mode: navigate|no-cors`, or without it an `Accept` not
  JSON alone) to `<backoffice>/login?returnUrl=<path+query>`, kept local by
  `localReturnUrl`; everything else, and the Delivery API always, is a 401 problem.
- **Every answer** is marked in `traced()` (`privateAnswer`): `private` in place of
  `public`/`s-maxage`, the rest kept, and `X-Robots-Tag: noindex, nofollow`.
- **Cookies stripped:** the site part of `route()` (member routes, actions, scripts,
  media, middleware, site routes, pages) is handed `siteSeenRequest(request)`, the socket's
  peer kept, with the original in an `AsyncLocalStorage` that only crombolo's own preview
  check (`editorOf`) reads. `pageRequest()` strips the renderer's headers too, and the
  back office's site routes (story 431) and an extension's routes are handed the stripped
  request. Both settings.
- **One way in:** the login route answers 303 to the one provider's start, with the
  return path, when `allowLocalLogin` is false, there is exactly one back-office provider,
  and the request carries neither `externalLoginError` nor `flow`; with an error the
  screen shows it, the button reading Try again (`login.js`).
- **The same host:** boot warns when `applicationUrl`'s host isn't among the site's
  bound hostnames (none bound: none to check).
- **Config:** `siteAccess` / `CROMBOLO_SITE_ACCESS`, a misspelt value refused. No
  migration.
- **Tests:** `tests/site-access.test.ts` (an `all` and a `web` node on one database;
  each exemption; browser and API answers; an expired access token with a live refresh
  token, not spent or extended; sign-out, an ended session, a locked-out user; cross-site
  writes; cookies hidden from views, middleware and routes, with both settings; headers
  and robots; the provider redirect and no loop); `tests/external-sign-in.test.ts`
  updated for the redirect. Browser journey `tests/browser/site-access.browser.ts`
  against a third, closed, site `serve.ts` boots. Postgres and the browser suite are run
  after merging.
