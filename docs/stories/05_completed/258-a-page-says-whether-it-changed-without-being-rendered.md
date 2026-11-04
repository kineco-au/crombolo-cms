# 258 — A page says whether it changed without being rendered

**Epic:** F — Headless · **Priority:** should · **Size:** M
**Depends on:** 057, 174

## Story

As someone running a site behind a CDN, I want a kept copy of a page or an
API answer to be checked against the site without the site rendering it
again, so that the cache can ask often and cheaply, a publish is seen at the
next check, and nothing has to be purged.

## Context

Story `057` gave every public page and Delivery API answer an ETag and a
`304` for a matching `If-None-Match`. The ETag is a hash over the body
(`etagFor`, `packages/render/src/cache-policy.ts`), so answering "unchanged"
costs a full render: a `304` saves the bytes and nothing else. A CDN that
revalidates on every request, which is what a site with no purge hook wants,
therefore costs the site as much as serving the page.

Everything needed for a cheap answer already exists:

- **The content checkpoint** (`174`). Each published snapshot records the
  checkpoint whose changes it holds (`CacheSnapshot.checkpoint`,
  `packages/render/src/published-cache.ts`), and a later media-only
  checkpoint it is known to cover. Every publish, unpublish, move, sort,
  delete, dictionary change and media save advances it, on every node,
  through the cache instructions.
- **The code generation.** A deploy of the site's own code loads a new
  generation of its components and templates
  ([`rendering.md`](../../rendering.md)); a page rendered under a new
  generation may differ with no content change.
- **The CMS version** (`VERSION`), since an upgrade can change markup.

A validator built from these, rather than the body, changes whenever any of
them does. That is deliberately coarse: a publish of one page changes the
validator of every page, which is the only rule that is right for menus,
listings, breadcrumbs and related-content blocks without knowing a site's
structure. The cost of the coarseness is one render per page per edge after
a publish, instead of a purge.

**What it does not cover.** A page whose output depends on something other
than content, code and version: the time ("events this week"), a random
pick, an external call in an async component. Today's body hash catches
those by accident, because the body differs. The validator here would
answer `304` until the next publish.

### Decisions

- **Time-dependent pages. Decided (2026-11-04): opt in.** Every page keeps
  today's ETag over its body until the site asks for the cheap one, for the
  whole site (`cache.validator = 'published'`) or for a content type
  (`cache.types[alias].validator`, `'published'` or `'body'`, the type's
  setting winning). A site turns it on knowing which of its pages read the
  clock. Opting out per type, with everything else cheap by default, was
  turned down: an existing site's time-dependent pages would have gone stale
  on upgrade with nothing said.
- **Where a `304`'s headers come from. Decided (2026-11-04): each server
  remembers.** A `304` repeats the lifetime and purge tags the full answer
  would carry, and those come from rendering (a template's own `revalidate`
  among them). Each server keeps a bounded in-memory list, by address, of the
  last ETag it sent and the headers with it. A matching check is answered from
  it; one it does not hold, after a restart or on another server, renders once
  as today and is remembered. Nothing is written to the database. A shared
  table was turned down for the writes every render after a publish would
  make; working the headers out again, for leaving `revalidate` pages always
  rendering.
- **Strong or weak. Decided (2026-11-04): weak** (`W/"…"`): two renders under the same
  validator are not promised byte-identical, and nothing here needs a strong
  one. A range request never reaches a page.
- **What a `304` costs. Decided (2026-11-04): find the page and check public
  access.** The page is found in the published snapshot, as the validator
  needs its key, and public access is checked as every render checks it now
  (`PublicAccessRepository.entryFor`: the page's row, then the nearest
  protected entry on its path, two small indexed queries). Nothing is
  rendered and no value is resolved. The check cannot be dropped: saving
  public access rebuilds only that server's snapshot and does not move the
  content checkpoint, so the validator alone would keep confirming a public
  copy of a page that has since become members-only, on every server.
  - *Optional:* each server holds the public access rules in memory, a small
    table, and an access change moves the checkpoint so it reaches every
    server. Every validator then changes with it, which is correct, and a
    `304` reads nothing from the database.

## Acceptance criteria

- [x] With the cheap validator turned on, a public page's ETag is derived
      from the snapshot's newest checkpoint, the code generation, the CMS
      version and the page's key and culture, not from the body; a matching
      `If-None-Match` is a `304` with no render, which a test shows by
      counting renders. Without it, every ETag is over the body, as today.
- [x] A publish, an unpublish, a move, a media save, a dictionary change, a
      code deploy and an upgrade each change every public page's validator.
- [x] Delivery API answers for items, queries and search take the same
      validator, with the query string in it.
- [x] A content type whose `validator` is `body` keeps the hash over the
      body and renders to answer, on a site that turned the cheap one on.
- [x] Members-only pages, previews and a member's token stay `private,
      no-store` with no validator, as `057` left them.
- [x] A `304` without a render still checks public access: a page made
      members-only after a public copy was sent is never confirmed from it,
      which a test shows.
- [x] A `304` without a render is answered only to a request with no member
      session, preview or form-answer cookie: a member whose browser kept the
      signed-out page is rendered for, never confirmed from it.
- [x] A CDN can tell a signed-in request from an anonymous one: "Behind a CDN"
      gives the rule to skip the cache when the member cookie is present, or
      the site sends a header a CDN can key on.
- [x] `operations.md` "Behind a CDN" is rewritten around revalidation: a
      cache that keeps copies and checks back is correct without a purge
      hook; the webhook purge remains documented as the way to cut the
      window to nothing.
- [x] Tests on SQLite and Postgres, and across two nodes: a publish on one
      changes the validator the other answers with.

## Out of scope

- Per-page precision (a validator that changes only when a page's own
  dependencies change). It would need a dependency set per render, and the
  coarse rule is what a tagless CDN can use anyway.
- Lifetimes and their defaults: `259`.
- Hashed addresses for stylesheets and scripts: `260`.
- Caching pages that show the signed-in member: their personal parts are
  fetched on their own in `263`.

## Implementation

- `packages/render/src/cache-policy.ts`: `Validator`, `validatorFor` (an
  answer is `published` only when every type in it is), `publishedEtag`,
  `RememberedAnswers` (bounded, most recent kept), `rememberedHeaders` and
  `unchanged`; `cacheable` takes the ETag to use.
- `packages/server/src/server.ts`: a page's ETag is made from the served
  checkpoint, the views generation, a hash of the site's `package.json` and
  `bun.lock` (bundle code installed with a restart), `VERSION`, and the page's
  key, culture, host and query, the basis taken before the render.
  `unchangedPage` answers a remembered address with no render, after
  `members.decide` for a visitor; a request carrying the member, preview,
  form-answer or action cookie renders.
- `packages/api-delivery/src/handler.ts`: the same for API answers, the
  address including the headers they vary by; the access rules and media
  rules, hashed, stand in for the page's access check. An answer holding a
  form keeps its body hash.
- Public access moves the checkpoint: `appendCacheInstruction` with
  `publicAccess` from both the content operations and the port, so a page
  that leaves out what a visitor may not open changes everywhere. It keeps
  the media cache (`PAGE_ONLY`).
- `CROMBOLO_CACHE_VALIDATOR`; "Behind a CDN" in `operations.md`.
- Tests: `tests/published-validator.test.ts` (render counting, publish,
  template edit, access changed behind the server's back, signed-in and
  preview visitors, a type's override, the Delivery API, two nodes).
