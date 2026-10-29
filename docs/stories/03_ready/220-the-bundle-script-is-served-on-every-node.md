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

## Acceptance criteria

- [ ] `/crombolo/bundle.js` is served on `api`, `web` and `all` nodes, with
      the same caching as `/crombolo/forms.js`.
- [ ] `tests/routes.test.ts` holds it: an `api` node answers the script, and
      still answers 404 for a site route.
- [ ] `docs/rendering.md`, "Route handlers", says which `/crombolo/` paths a
      proxy must send to a node that serves the site and which may go to any
      node.
