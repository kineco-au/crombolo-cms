# 186 — Member and public routes for server bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 030, 063

## Story

As a site whose visitors and members use an application beside its content, I
want a server bundle to serve routes to anonymous visitors and to signed-in
members, so that the site's browser code has an API to call without a second
server.

## Context

A server bundle's routes mount under `<backoffice>/crombolo/api/bundle/<id>/`
and the host authenticates a back-office user and checks the bundle's section
before dispatch: "a handler never sees an anonymous request, and a bundle cannot
declare a public route" (`packages/server/src/bundles.ts`). That was the right
default for screens in the back office, and it leaves no way for a site to give
its members an API.

Raised by Nature's Calendar (`wt-natures-calendar` story 012), whose API is
mostly member-facing (a member's records, places and photos) and partly public
(species lists, map data, recent records). Templates already receive the
signed-in member (`PageProps.member`, `docs/rendering.md`); a route needs the
same. Other customers with an application beside their content will meet the
same wall. Nothing a site writes outside a bundle is an alternative on Crombolo
Cloud, which runs its own `server.ts`.

## Decided (2026-10-28)

- **Where they mount: `/crombolo/bundle/<id>/…`.** `/crombolo/` is already the
  site's own namespace, holding the form submissions and the form script, so
  no page URL can collide and there is nothing to check at boot. Back-office
  routes stay where they are, under `<backoffice>/crombolo/api/bundle/<id>/`.
- **Which nodes: wherever the site is served.** `all` and `web` nodes answer
  public and member routes, writes included, as they answer form submissions
  and member sign-in today. `api` nodes serve no public site, so they do not
  answer them. A route does not declare itself read-only.
- **Who the member is: the member cookie or a member token.** A route
  identifies its member from the site's member cookie, which templates already
  use, or from a Delivery API member bearer token (030), for apps.
  - Either way the handler gets the same frozen member: key, name, username,
    email and groups, and nothing of the back office.
  - A token's scopes never widen what the route allows.
- **Cross-site writes need an anti-forgery token.** For a cookie-authenticated
  member request with a method other than GET or HEAD, the request must carry
  a valid `Crombolo-Antiforgery` header.
  - The token is an HMAC of the member's session, keyed by the site's secret.
    Nothing is stored, and it ends with the session.
  - Views get a component, `<AntiforgeryMeta />`, that writes
    `<meta name="crombolo-antiforgery" content="…">` while a member is signed
    in. A site puts it in its layout.
  - A small script, `/crombolo/bundle.js`, gives browser code a `fetch`
    wrapper that reads the meta tag and sends the header.
  - A request with a bearer token is not cookie-driven, so it needs no
    anti-forgery token.
- **Rate limits are per server, in memory.** A route declares
  `rateLimit: { max, perSeconds, by: 'member' | 'caller' }`. Each server
  counts by itself, as sign-in throttling already does (`AttemptLimiter`), so
  behind N servers the site allows up to N times the limit in total. The docs
  say so. Going over answers 429 with `retry-after`. `caller` is the real
  client address (`X-Forwarded-For` behind a trusted proxy). A member route
  limited by member counts the member's key.
- **Other origins use the Delivery API's allow-list.** Origins already allowed
  for the Delivery API (story 056) get CORS headers. A cross-origin member call
  must use a bearer token, since cookies are not sent across sites. Everything
  else is same-origin only.

## Plan (2026-10-28)

1. **Declaring an audience** (`server/src/bundles.ts`).
   - `ServerBundleRoute` gains:
     - `audience`: `'backoffice'` (the default), `'member'`,
       `{ member: { groups: [...] } }` or `'public'`;
     - an optional `rateLimit`.
   - `validateServerBundles` checks them. A `rateLimit` is refused on a
     back-office route, and an unknown audience or group name is refused.
   - `BundleRequest` gains `member?: BundleMember`. For a back-office route,
     `principal` stays the back-office user. For a member route the handler
     gets `member`, and no principal. A public route gets neither.
2. **A second dispatcher.** `createServerBundles` returns a `site` handler
   beside the back-office `handle`.
   - It matches `/crombolo/bundle/<id>/<path>`, and answers only routes whose
     audience is `member`, `member` with groups, or `public`.
   - Back-office routes are never reachable this way, and member and public
     routes are never reachable under the back-office prefix.
   - Unmatched paths answer 404, and a wrong method 405, as now.
3. **Wiring** (`server.ts`). In the site branch, beside the form routes and
   before the renderer, `/crombolo/bundle/` goes to the site dispatcher on
   every node that serves the site (`role !== 'api'`).
4. **Identifying the member** (`member-auth.ts`, `delivery-members.ts`).
   - The member cookie goes through `resolve`.
   - Otherwise an `Authorization: Bearer` member token goes through the
     Delivery API's token check. The token must be live and belong to a
     member who is approved and not locked out.
   - Both become a `BundleMember` (key, name, username, email, groups),
     frozen.
   - A member route refuses an anonymous caller with 401, and a member outside
     its groups with 403.
5. **Anti-forgery** (new `auth/src/antiforgery.ts`).
   - `antiforgeryToken(secret, ticket)` is an HMAC over the member ticket's
     id and security stamp.
   - `verifyAntiforgery` compares in constant time.
   - The site dispatcher requires a valid header on cookie-authenticated
     member writes, and answers 403 with a message that names the meta tag.
   - `<AntiforgeryMeta />` is a render component reading the request's member
     from the render context. It is exported from `@crombolo/crombolo`, as a
     site API (173's snapshot is updated).
   - `/crombolo/bundle.js` is the fetch wrapper, served like `forms.js`.
6. **Rate limits.** A limiter per route and per server, built on the same
   counting as `AttemptLimiter`, keyed by the member's key or by the caller's
   address. Over the limit answers 429 with `retry-after`.
7. **CORS.** The site dispatcher answers preflights, and adds CORS headers for
   origins on the Delivery API's allow-list, reusing `corsPolicy` (the same
   code `formCors` uses).
8. **Capabilities stay per bundle.** The route gets the capabilities its
   bundle declared, whatever its audience. A public route reaches no more than
   a back-office one.
9. **Tests** (`tests/server-bundles.test.ts`, and a new
   `tests/bundle-site-routes.test.ts`).
   - **Defaults:** a route with no audience answers only under the back
     office, and no route is public unless declared.
   - **Audiences:**
     - public answers anonymously;
     - member gives 401 anonymous, 403 outside its groups, and 200 with the
       member as given;
     - the member token works the same as the cookie;
     - a back-office route is not reachable on the site path, and a site
       route is not reachable under the back office.
   - **Anti-forgery:**
     - a write without the header gives 403;
     - a write with a valid token gives 200;
     - a token from another session, or after sign-out, is refused;
     - a bearer write needs none;
     - `<AntiforgeryMeta />` renders only for a member.
   - **Rate limits:** a 429 after `max` requests, counted by member and by
     caller, with `retry-after`.
   - **CORS:** an allowed origin gets headers, and others get none.
   - **Nodes:** a `web` node answers, and an `api` node does not.
10. **Docs.**
    - `docs/bundles.md`, Part 3: the audiences, the site path, the member,
      the anti-forgery token with the layout line and the script, rate limits
      (per server), and CORS.
    - `docs/api.md`: `BundleMember`, `audience`, `rateLimit` and
      `AntiforgeryMeta`.
    - The release notes.

## Acceptance criteria

- [x] A bundle route declares its audience: `backoffice` (today's, and the
      default), `member`, `member` with named groups, or `public`.
- [x] A member route is refused before dispatch without a signed-in member (or one
      outside its groups), and receives the member otherwise; a public route
      receives no principal.
- [x] A state-changing member route called with the member cookie needs a valid
      anti-forgery token, which `<AntiforgeryMeta />` and `/crombolo/bundle.js`
      provide; one called with a member token needs none.
- [x] Every public and member route can declare a rate limit, keyed by member or
      by the real caller, counted per server.
- [x] Capabilities stay per bundle, as declared; a public route reaches no more
      than a back-office one.
- [x] `docs/bundles.md` Part 3 gains the audiences, and `tests/server-bundles.test.ts`
      holds the defaults (no public route unless declared).

## As built (2026-10-28)

- **Declaring** (`server/src/bundles.ts`). `ServerBundleRoute` is a union on
  `audience`: `BackofficeBundleRoute` (no audience, or `'backoffice'`),
  `MemberBundleRoute` (`'member'` or `{ member: { groups } }`) and
  `PublicBundleRoute` (`'public'`); the last two take an optional
  `rateLimit: BundleRateLimit`. Each variant types its handler's context:
  `BundleRequest` keeps `principal: Principal`, `BundleMemberRequest` has
  `member: BundleMember` and no principal, `BundlePublicRequest` has neither,
  so the existing bundles (`simple-redirects`, `entra`, the consumer fixture)
  type-check unchanged. `routeProblems` in `validateServerBundles` refuses an
  unknown audience, malformed groups, a `rateLimit` on a back-office route, a
  limit that is not whole numbers above 0 or counts by anything but `member`
  or `caller`, and `by: 'member'` on a public route. A back-office route and a
  site route may share a method and path, since they mount apart.
- **The caller.** Every handler gets `caller: BundleCaller`, frozen:
  `{ kind: 'backoffice', principal }`, `{ kind: 'member', member, via:
  'cookie' | 'token' }` or `{ kind: 'public' }` (always `public` on a public
  route, even with a member signed in). Capabilities are built per request by
  `contextFor(bundle, caller)`: `ServerBundlesOptions.callerHost` is an
  optional factory per capability, `(caller) => capability`, used in place of
  the shared one in `host`. That is the hook story 198's `media` uses to act as
  the member and refuse a public caller. A capability with no factory is the
  shared object, as before.
- **The site dispatcher.** `createServerBundles` returns `site(request, url)`
  beside `handle`, and `sitePath` (`/crombolo/bundle/`); `MountedBundle` gains
  `sitePrefix` and each route's `audience`. `site` considers only member and
  public routes, `handle` only back-office ones, so each 404s on the other's
  path. Order in `site`: CORS pre-flight, route match (404/405), a
  caller-counted limit, then for a member route: bearer token (a bad one is
  401, never a fall back to the cookie) or cookie session (401 without), the
  anti-forgery check on a cookie write (403), the groups (403, matched in any
  case as `memberMay` matches), a member-counted limit, dispatch. A member
  route's response gets `cache-control: private, no-store` unless the handler
  set one. Its options (`BundleSiteOptions`) are `session`, `memberByToken`,
  `cors`, `callerAddress` and `now`; without them every member route is 401.
- **Wiring** (`server.ts`). The bundles are created on every role now (when
  any are configured), and `bundleChains` is computed on every role so a `web`
  node's routes have their `tables` capability; only owners migrate them. The
  back-office dispatch is still reached only through `serveBackOffice`.
  `/crombolo/bundle.js` and `/crombolo/bundle/…` answer before the renderer
  where `role !== 'api'`; on an `api` node they fall through to its 404.
  `deliverySettings` and `formCors` moved up so the dispatcher can share
  `formCors`. A group a route names that is not a member group is a boot
  warning, not a refusal (see below).
- **The member** (`member-auth.ts`). `MemberAuth.session(request)` returns the
  member, the session's anti-forgery token and a `verify(token)`; `resolve` is
  now `session()?.member`. A bearer token goes through
  `deliveryMembers.member` (live, approved, not locked out) and then
  `MemberRepository.byKey` for the name and e-mail, only when member
  authorization is enabled for the Delivery API.
- **Anti-forgery** (`auth/src/antiforgery.ts`). `antiforgeryToken(secret,
  ticket)` is HMAC-SHA256 over a purpose label, the member key, the security
  stamp and the ticket's expiry, base64url; `verifyAntiforgery` checks it with
  `crypto.subtle.verify` (constant time). The key is the member cookie's
  signing key (`crombolo/memberCookieKey`), shared by every node. The 403 names
  `<AntiforgeryMeta />` and `/crombolo/bundle.js`.
- **The view side** (`render/src/bundle-script.ts`). `AntiforgeryMeta` reads
  the token from the render scope (`RenderRequest.antiforgery`, set by
  `renderSite` from the session) and writes the meta tag only while a member
  is signed in. `BUNDLE_SCRIPT` defines `crombolo.fetch`, which adds the header
  from the tag for same-origin URLs only. Exported from `@crombolo/crombolo`;
  the new bundle types from `@crombolo/crombolo/bundle`; snapshot updated.
- **Rate limits** (`server/src/rate-limit.ts`). `RateLimiter.take(key)` is a
  sliding window like `AttemptLimiter`, returning the seconds to wait; idle
  keys are swept once 10,000 are held. One limiter per route, per server.
  `callerAddress(peer, forwardedFor)` uses the socket's peer, or the last
  `X-Forwarded-For` entry when the peer is a private or loopback address.
- **Tests.** `tests/bundle-site-routes.test.ts`: validation, every audience,
  cookie and token, anti-forgery (missing, valid, another session's, read,
  bearer and public exemptions, the HMAC's inputs), rate limits by caller and
  by member with `retry-after`, CORS and pre-flight, per-bundle and per-caller
  capabilities, the handler's typing; on a real site: sign-in, the meta tag
  only for a member and its token accepted, another member's refused, sign-out
  and a rotated stamp refused, a Delivery API token, the script, and a `web`
  node answering where an `api` node does not. `tests/server-bundles.test.ts`
  holds the defaults (no audience is back office; nothing is on the site unless
  declared).

### Deviations

- **The token covers the session's expiry too**, not only the member and the
  stamp, so a token ends with the session it was issued for rather than
  surviving into the member's next sign-in.
- **A group that does not exist warns at boot instead of refusing it.** Member
  groups are made in the back office while the site runs, so refusing the boot
  would tie a deploy to content; until the group exists nobody passes the
  check. Malformed groups are refused.
- **There is no trusted-proxy setting;** the caller address trusts
  `X-Forwarded-For` only from a private or loopback peer.
- **A route's handler types are split by audience** (three request types)
  rather than one `BundleRequest` with optional `member` and `principal`, so
  existing back-office handlers keep a non-optional `principal`.

## Out of scope

- Server-side rendering by a bundle (pages stay templates).
- A bundle widening a core route's access.
