# 263 — Personalised parts of a shared page

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer building a site with members, I want the parts of a page that
show the signed-in visitor, such as their name or profile link, to be fetched
on their own, so that the rest of the page is shared, kept by a CDN and checked
cheaply, instead of every page being rendered for every member.

## Context

A page that reads the member, cookies, headers or the query string anywhere is
marked personal (`markPersonal()`, `packages/render/src/context.ts`) and
answered `private, no-store`. A header that greets the member therefore makes
every page on a member site uncacheable, and 258's cheap validator never
applies to them. Only a page whose personalised parts arrive separately can be
shared.

Other frameworks call this partial prerendering (Next.js, with `<Suspense>` as
the boundary), server islands (Astro, `server:defer`) or ESI (Varnish, Akamai,
Fastly). The browser has a matching proposal, fragment includes
(`<template for src>`, WICG `declarative-partial-updates`, a Chromium prototype
since July 2026).

**Decided (2026-11-04): the boundary is a file directive, `'use deferred'`**,
as `'use client'` makes an island. A component file starting with it is a
personalised part, deferred to its own request: the module transform that makes an island's stub
(`snapshots.ts`, `beforeSwap`) makes it a stub that writes the fallback and a
placeholder, with its props as JSON, and the part's route renders the real
component for the visitor. `<Suspense>` was decided first and turned down
once the runtime was checked: `jsx-runtime.ts` calls every component as it
meets it, children before their parent, so in `<Suspense><Greeting/></Suspense>`
the greeting has already read the member before the boundary exists. Next.js
can because React elements are descriptions rendered later. A function child
(`<Suspense>{() => <Greeting/>}</Suspense>`) looked like Next.js and behaved
differently, and a lazy runtime would change every page's render path.

The name says how the part is delivered, as Astro's `server:defer` does,
rather than why: `'use personalised'` and `'use member'` were the others.

**Decided (2026-11-04): no streaming.** The
page renders whole, as today, so it is complete when sent: every outcome keeps
its true status and its headers are right. In the page, a personalised part writes its
fallback and a placeholder. The browser fetches each
personalised part from its private route and fills it in. Streaming slow parts in
the same response is 212.
258's validator makes the shell cheap to check, but this story does not need
it.

**Different from Next.js:** there, the personalised part streams in the same
response as the cached shell, which works because Vercel's edge understands it.
An ordinary CDN would keep the streamed part with the shell. Here a personalised
part arrives through its own request.

## Decisions

- **Where the fallback comes from. Decided (2026-11-04): a `fallback` prop**
  on each use, as `<Suspense fallback>`:
  `<Greeting fallback={<a href="/sign-in">Sign in</a>} />`. It is rendered
  into the shared page and never sent to the part's route; a use without one
  leaves an empty placeholder. A `Fallback` export beside the part was turned
  down for one stand-in for every use.
- **How a part is found: by the directive,** following from the boundary,
  so the render does not have to work it out.
- **Whether a page depends on the member. Decided (2026-11-04): found per
  page, from its files.** When a views snapshot is taken, each view file is
  read once and flagged when it mentions `member` (`props.member`, `{ member }`,
  `usePage().member`), `cookies()` or `headers()`. The JSX runtime's component
  hook records the files a page rendered, and the page depends on the member
  only when one of them is flagged. A spread such as `<Layout {...props}>`
  passes `member` on without depending on it: what counts is whether
  `layout.tsx` mentions it. A component from outside the views tree, such as a
  package's, counts as depending on it, and reads inside Crombolo (a form's
  antiforgery token, member search, `site()`) mark the page personal as they
  do today. A page that does not depend on the member is rendered the same for
  a member as for anyone, and is shared.
- **What the CDN is told. Decided (2026-11-04): `Vary: X-Crombolo-Member`**
  on a page that depends on the member, and nothing on one that does not. The
  CDN sets `X-Crombolo-Member` at its edge from whether the member cookie is
  present (Fastly, Cloudflare and Akamai can), so a member misses the shared
  copy of a page that shows them and gets a private render, and shares the
  copy of every other page. This replaces 258's rule to skip the cache
  whenever the member cookie is present. A site-wide switch, rendering every
  page without the member, was turned down for per-page detection.
- **How the part is fetched. Decided (2026-11-04): a loader script.** The
  part's route (`/crombolo/deferred/…`) renders it for the visitor with their
  cookies, answered `private, no-store`; the placeholder carries its address,
  with the props in it, signed so a visitor cannot change them. A small
  script, carrying the page's nonce as the islands loader does, fetches each
  placeholder's address and swaps the part in. It works in every browser and
  behind any CDN. ESI, where the CDN puts the part in before the page leaves
  it, is `265`; the WICG fragment-include markup waits for browsers to ship
  it, and the placeholder's address will not change when it does.
- **What identifies a part: its module path and export, and its props,**
  which the placeholder carries, following from the directive; the views
  generation it was rendered under says which code renders it.
- **What a crawler and a visitor without JavaScript see:** the fallback.
- **What a part can read:** its props, which must survive JSON as an
  island's do (a function or JSX prop is refused in development, naming the
  part), and the page it sits on through `usePage()`, as the address names
  the page and culture. The member, cookies and headers are the visitor's.

## Acceptance criteria

- [x] A page whose only member-reading component is a personalised part is
      public: it carries a lifetime and 258's validator, and its HTML holds the
      fallback, never the member's data.
- [x] The part is fetched with the visitor's cookies, answered
      `private, no-store`, and fills the boundary with no layout jump beyond
      the fallback's.
- [x] A component outside a part that reads the member still makes the
      page personal for a member, as today, and development mode names its
      file.
- [x] A page none of whose rendered files mention the member is shared for
      a signed-in member too; one that does is private for them and carries
      `Vary: X-Crombolo-Member`.
- [x] The page records why it became personal, for 264 to show.
- [x] "Behind a CDN" in `docs/operations.md` and `docs/rendering.md` describe
      personalised parts. Tests cover the cut, the route, the fill, the fallback
      without script, and that no member data reaches a shared copy.

## Out of scope

- The back office's side of it: 264.
- ESI output for a CDN that puts parts together: 265.
- Per-member caching of the part itself.

## Implementation

- `packages/render/src/deferred.ts`: the `'use deferred'` transform, a stub
  that imports the part's source kept beside it (`<name>.deferred-source.tsx`,
  `SnapshotTransform`'s `beside` in `snapshots.ts`); the placeholder
  `<crombolo-deferred src="/crombolo/deferred?d=…&s=…">` holding the fallback;
  the address, its props as JSON (`serializeProps(…, 'part')`, which refuses
  server actions too); and the loader, which fetches each part with the
  visitor's cookies and dispatches `crombolo:deferred`.
- `packages/render/src/renderer.ts`: `#filesMentioningMember` reads each view
  file once per generation, transpiled so comments and types do not count,
  and follows its relative imports, skipping a part's own source. The files a
  render used (the template, its layouts, its blocks) give `memberFiles`, and
  a page is personal for a member only when there are any. `request.part`
  renders the part's module alone, inside the page's scope, with
  `inPart` so a part within it renders in place.
- `packages/render/src/context.ts`: the member's anti-forgery token, read by
  an action's form or `<AntiforgeryMeta />`, marks the page personal, as the
  member being signed in used to.
- `packages/server/src/server.ts`: `/crombolo/deferred` checks the
  HMAC-signed address (keyed from the form secret), finds the page, refuses
  one the visitor may not see, and renders the part `private, no-store`; a
  page with `memberFiles` carries `Vary: X-Crombolo-Member`, and development
  logs, once per page, which files make it the member's.
- **A difference from the decision:** a package's code is not counted as
  depending on the member. Every view imports `@crombolo/crombolo`, so
  counting packages would have made every page the member's; a package can
  only read the member through `usePage()` or a prop a view passes it, and the
  view passing it mentions it.
- Docs: "Deferred parts" and "Caching, inferred" in `rendering.md`; "Members
  and a shared cache" in `operations.md`, replacing 258's rule to skip the
  cache for the member cookie.
- Tests: `tests/deferred-parts.test.ts`; `tests/page-logic.test.tsx` updated
  for a member no longer making every page personal.
