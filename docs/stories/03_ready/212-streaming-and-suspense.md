# 212 — Streaming and Suspense

**Epic:** O — Building a site · **Priority:** could · **Size:** L
**Depends on:** 206, 258

## Story

As a developer whose page has one slow part, such as a report or a map's data,
I want to wrap it in `<Suspense fallback>`, or give the page a `loading.tsx`.
Then the rest of the page reaches the visitor at once, and the slow part
streams in when ready, as in Next.js.

## Context

Crombolo renders a whole page to a string, then answers. `docs/rendering.md`
says there is no `Suspense`. A page is as slow as its slowest await. Lookups
are batched, but a slow query or an outside fetch still holds the page back.

Next.js streams: the shell and fallbacks are sent first, then each suspended
part arrives as HTML with a tiny inline script that swaps it into place. A
`loading.tsx` wraps the page in a boundary automatically.

Whole-page rendering is also what makes 206's thrown outcomes safe. Once the
first bytes are sent, the status cannot change. Next.js handles this by
answering 200 and turning a later `redirect()` into a meta refresh and a
client-side navigation, and a later `notFound()` into an injected
`noindex`.

## Decisions before implementation

- **Which pages stream. Decided (2026-11-04): every page**, through one code
  path. The first flush is the shell once it is complete; layouts wait for the
  page they wrap, so a page with no `<Suspense>` or `loading.tsx` has nothing
  to send early, flushes once, and keeps its outcomes' true status, as today.
  Only boundaries put a flush before the end. Streaming only pages with a
  boundary was the alternative; it would have meant two render paths.
- **Outcomes after the first byte. Decided (2026-11-04): as in Next.js.** A redirect
  becomes a meta refresh plus `location.replace`, and a not-found renders
  the not-found content in place with `noindex`. Both are logged as late, so a
  developer can move the check above the boundary.
- **Caching.** A streamed page is cached once complete, under the same rules
  as a whole one. CDNs that buffer get the whole page, and those that pass
  through get the stream.
- **Personal reads after the first flush. Decided (2026-11-04): the part shows
  its fallback.** Headers go out with the first flush, chosen from the page's
  configured lifetime and what is known by then. A boundary that reads the
  member, cookies or headers on a page already sent as shareable renders its
  fallback instead, and development mode says why. A late part is in the same
  response as the shell, so a CDN keeps it with the shell: this is what keeps
  one visitor's data out of a shared copy. With 263 built, such a boundary is
  already a personal part fetched on its own, and never streams. Treating
  every streamed page as private, or rendering whole whenever a lifetime is
  set, were turned down: either would stop streamed pages being cached.
- **The swap's markup. Decided (2026-11-04): Next.js's.** The fallback sits
  after an empty `<template id="B:n">`; the part arrives later as
  `<div hidden id="S:n">` and an inline `$RC("B:n","S:n")`, carrying the
  page's nonce, moves it into place. It works in every browser today. The HTML
  standard's `<?marker>` and `<template for>` were turned down for now: Chrome
  ships them, other browsers do not yet.
- **The ETag. Decided (2026-11-04): 258 comes first.** Today's ETag hashes the
  finished page, which a streamed page cannot know when its headers go out.
  258's validator is known before rendering, so with 258 built every streamed
  page has one from its first flush. Sending no ETag until then, or the hash as
  an HTTP trailer that browsers and most CDNs ignore, were turned down.

- **Outcomes other than a redirect or a not-found after the first flush**
  (400, 401, 403, 410, 422, an unexpected error) are still to decide: shown
  in place with `noindex` as Next.js does, or refused with the boundary's
  fallback. Settle it when the story is picked up.

## Acceptance criteria

- [ ] `<Suspense fallback>` from `@crombolo/crombolo` sends its fallback in the
      first flush and the content when ready, swapped into place by an inline
      script carrying the page's CSP nonce. Nested boundaries resolve
      independently.
- [ ] `loading.tsx` beside a page (206's folder form) wraps the page in a
      boundary automatically.
- [ ] A page with neither is sent in one flush, byte-for-byte as today, with
      its outcomes' true status.
- [ ] Outcomes thrown before the first flush keep their status. After it, a
      redirect becomes a meta refresh and script navigation, and a not-found
      renders the not-found content in place with `noindex`. Both are logged.
- [ ] The render's time limit applies per boundary. A boundary that times out
      renders its fallback with an error notice in development, and stays on
      its fallback in production.
- [ ] Search engines and visitors without JavaScript still receive the full
      content, in document order, once streaming completes.
- [ ] `docs/rendering.md` documents streaming and lifts "no `Suspense`". Unit
      tests cover flush order, nested boundaries, late outcomes, timeouts and
      caching.
