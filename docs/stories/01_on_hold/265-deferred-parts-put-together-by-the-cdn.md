# 265 — Deferred parts put together by the CDN

**Epic:** O — Building a site · **Priority:** could · **Size:** S
**Depends on:** 263

## Story

As someone running a member site behind a CDN that supports Edge Side
Includes, I want each `'use deferred'` part written as an `<esi:include>`, so
that the CDN puts the visitor's part into the shared page before it reaches
the browser: one complete page, with no script, no flash of the fallback, and
the real part for crawlers.

## Context

Story `263` writes each deferred part as a placeholder holding its fallback,
and a loader script fetches the part from its private route and fills it in.
That works in every browser, behind any CDN or none.

ESI is a tag a CDN understands. The shared page keeps
`<esi:include src="…">` where the part goes; on each request the CDN fetches
that address from the site with the visitor's cookies, and swaps the tag for
the answer. Varnish and Akamai support it, Fastly in part, and Cloudflare
through Workers; CloudFront and most others do not. Without a CDN that
supports it, the raw tag reaches the browser and nothing is shown, so it is
off unless a site turns it on.

The private route and its signed address are `263`'s and do not change: only
the markup written in the shared page does.

## Acceptance criteria

- [ ] A setting, off by default, writes each deferred part as
      `<esi:include>` with the part's signed address, instead of the loader's
      placeholder, and no loader script.
- [ ] The part's route answers an ESI request as it answers the loader:
      rendered for the cookies passed on, `private, no-store`.
- [ ] A part that fails, or that the CDN cannot fetch, shows its fallback
      (`<esi:try>`/`<esi:except>`, or `onerror="continue"` where that is all
      the CDN supports).
- [ ] "Behind a CDN" in `docs/operations.md` says which CDNs support it, how
      to turn it on, and what a site sees if it is on behind one that does not.
- [ ] Tests cover the markup with the setting on and off, and the route
      answering an include.

## Out of scope

- Writing the WICG fragment-include markup (`<template for src>`), which
  waits for browsers to ship it.
