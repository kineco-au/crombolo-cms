# 315 — A typed SDK for extensions

**Epic:** I — Hardening · **Priority:** could · **Size:** L
**Depends on:** 308

## Story

As someone writing an extension, I want typed helpers for the areas my extension
uses, such as content, members, forms and the dictionary, so that I do not have to
work out the Management API's paths and request shapes for every call.

## Context

Story 308 gives an extension the Management API, gated by its grant, through one
`api` capability: `api.get('/document/…')`. That is complete, but untyped and
Umbraco-shaped. Site code has a typed `site().content` (story 298) for pages.

## The design

- **Typed helpers over `api`,** shipped in the extension SDK (story 311). Each calls
  the paths its permission covers, so it adds no reach of its own:
  - `content.get`, `children`, `create`, `update`, `publish`, `unpublish`, `delete`,
    with values by alias, as `site().content` has them;
  - members, users (read), forms and form entries, the dictionary, content types,
    webhooks and workflows, each with list, get and the writes its write permission
    allows.
- **Types** from the Management API's OpenAPI document, so they stay in step with it.
- **Errors** as `Outcome` values, as `site().content` answers them.

## Acceptance criteria

- [ ] Each area has typed helpers, and each refuses what the grant does not hold with
      the same words `api` uses.
- [ ] The helpers' types come from the OpenAPI document, and a test fails when they
      drift.
- [ ] Simple Redirects uses the helpers in place of raw paths.
- [ ] `bundles.md` documents them beside `api`.
