# 051 — An app on another site reads the API

**Epic:** F — Headless · **Priority:** must · **Size:** S
**Depends on:** —

## Story

As a front-end developer building a single-page app, I want my app at
`app.example.com` to call the Delivery API from the browser, so that I can
build it without a server of my own in between.

## Context

The Delivery API answers no cross-origin requests: nothing in the server writes
an `Access-Control-*` header or answers a pre-flight `OPTIONS` (checked
2026-10-21). A browser refuses the response, so today only server-side and
build-time frontends can use the API, and every other headless story here
assumes this one. Umbraco leaves CORS to ASP.NET Core middleware configured in
`Program.cs`; here it is configuration.

The member sign-in endpoints (`/umbraco/delivery/api/v1/security/member/**`)
need it too: an app exchanges its code and refreshes its tokens with `fetch`.
`authorize` and `signout` are navigations, not `fetch` calls, so they need no
CORS. The Management API and the backoffice stay same-origin.

## Acceptance criteria

- [x] `deliveryApi.cors.allowedOrigins` (and `CROMBOLO_DELIVERY_API_CORS_ORIGINS`,
      comma separated) lists exact origins; the default is none, so nothing
      changes for a site that does not set it
- [x] A request from a listed origin gets `Access-Control-Allow-Origin` naming
      that origin and `Vary: Origin`; any other origin gets no CORS headers.
      `*` is accepted only while `publicAccess` is on and is never combined with
      credentials
- [x] A pre-flight `OPTIONS` to content, media, search and the token, revoke
      and userinfo endpoints answers `204` with the allowed methods and the
      headers the API reads: `Api-Key`, `Authorization`, `Accept-Language`,
      `Start-Item`, `Preview`, `Content-Type`
- [x] A refused request (the API's empty 401, 403 and 404) still carries the
      CORS headers, so the app can read the status
- [x] A misconfigured origin (a path, no scheme) is said at boot and ignored
- [x] Documented in `delivery-api.md`; unit tests for allowed, refused and
      pre-flight requests

## What was built

- `packages/api-delivery/src/cors.ts`: the policy (`corsPolicy`), checked once
  when the API is created, the pre-flight answer and the headers added to every
  other answer. `createDeliveryApi` wraps its routing in it, and only for the
  paths `corsMethodsFor` names, so `authorize`, `signout` and anything outside
  the API are untouched.
- The setting is `deliveryApi.cors.allowedOrigins` in code or
  `CROMBOLO_DELIVERY_API_CORS_ORIGINS` (a `list` in the settings registry, so
  `docs/configuration.md` and the product site's docs carry it); code wins,
  field by field, as for `media`. Ignored origins join the member sign-in
  problems as boot warnings.
- No `Access-Control-Allow-Credentials`, ever: nothing the API reads is a cookie.
- An origin that is not listed gets a bare `204` to its pre-flight rather than a
  refusal status: the browser blocks it either way, and a bare answer says
  nothing about which origins are allowed.
- Tests: `tests/delivery-api.test.ts` ("requests from another origin") for the
  policy, allowed, refused and pre-flight requests, refusals carrying the header
  and the unchanged default; `tests/config-env.test.ts` for the environment and
  code.
