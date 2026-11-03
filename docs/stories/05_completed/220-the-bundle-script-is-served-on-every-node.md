# 220 — `/crombolo/bundle.js` is served on every node

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** 211

## Story

As a site whose api node and renderers are split behind one proxy, I want
`/crombolo/bundle.js` served wherever the other site scripts are, so that
`crombolo.fetch` loads however the proxy divides the paths.

## Context

`server.ts` serves `/crombolo/forms.js`, the form submissions,
`/crombolo/islands.js` and `/crombolo/islands/*` on every role, but
`/crombolo/bundle.js` only where `config.role !== 'api'`, a leftover of story
186 ("A bundle's member and public routes, wherever the site is served"). A
deployment that routes `/crombolo/*` to its api node, which is the natural
split since the back office and the Management API live there, answers 404
for the one script on that prefix the public site loads. The layout's
`<script src="/crombolo/bundle.js">` then fails, and a member's cookie write
from browser code falls back to the same-origin check alone.

## Plan (2026-11-02)

Confirmed against `server.ts`: the islands loader, `/crombolo/islands/*`,
`/crombolo/forms.js` and `/crombolo/forms/*` are answered on every role, and
`/crombolo/bundle.js` alone sits behind `config.role !== 'api'`. Its caching is
already the same as `forms.js` (`no-cache` in development, `public,
max-age=3600` otherwise).

1. **`server.ts`:** drop the role guard round `BUNDLE_SCRIPT_PATH`. The four
   static site scripts answer through one small helper, so their headers
   cannot drift apart again.
2. **The test in `tests/server-roles.test.ts`, not `routes.test.ts`.** That file
   already boots `all`, `web` and `api` nodes on both dialects; `routes.test.ts`
   boots none. Each node answers `/crombolo/bundle.js` with the script, the same
   `content-type` and `cache-control` as `/crombolo/forms.js`; the `api` node
   still answers 404 for a declared site route and for a server action.
3. **`docs/rendering.md`, "Route handlers":** a short "Behind a proxy" table of
   the `/crombolo/` paths:
   - **any node:** `/crombolo/bundle.js`, `/crombolo/forms.js`,
     `/crombolo/islands.js`, `/crombolo/islands/*`, `/crombolo/forms/*` (a
     submission), and the Delivery API under `/crombolo/delivery/api/`;
   - **a node that serves the site (`web` or `all`):** `/crombolo/actions/*`
     (server actions, story 219), the site's declared routes, its pages,
     `/css/`, `/scripts/`, `/sitemap.xml` and `/robots.txt`;
   - **a node that serves the back office (`api` or `all`):** the back office,
     the Management API and the remote protocol under the back-office path.
   - So `/crombolo/*` to the `api` node is safe once actions are carved out
     to a `web` node.
4. Release note: a fix line naming the split deployment.

No migration, no setting, no decision outstanding.

## Acceptance criteria

- [x] `/crombolo/bundle.js` is served on `api`, `web` and `all` nodes, with
      the same caching as `/crombolo/forms.js`.
- [x] `tests/server-roles.test.ts` holds it: an `api` node answers the script, and
      still answers 404 for a site route and a server action.
- [x] `docs/rendering.md`, "Route handlers", says which `/crombolo/` paths a
      proxy must send to a node that serves the site and which may go to any
      node.

## Implementation (2026-11-02)

- `server.ts`: `siteScript(body)` answers the islands loader, `forms.js` and
  `bundle.js` with one set of headers; the role guard round `bundle.js` is gone.
- `tests/server-roles.test.ts`: all three roles answer `/crombolo/bundle.js` with
  `forms.js`'s headers; the `api` node answers 404 for a declared site route and
  a server action. Both dialects.
- `docs/rendering.md`, "Behind a proxy", and the release note.
