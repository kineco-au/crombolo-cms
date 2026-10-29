# 212 — Streaming and Suspense

**Epic:** O — Building a site · **Priority:** could · **Size:** L
**Depends on:** 206

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

- **Opt-in.** Recommended: streaming only when a page uses `<Suspense>` or
  has a `loading.tsx`. Every other page renders whole, as today, so its
  outcomes keep their true status.
- **Outcomes after the first byte.** Recommended: as in Next.js. A redirect
  becomes a meta refresh plus `location.replace`, and a not-found renders
  the not-found content in place with `noindex`. Both are logged as late, so a
  developer can move the check above the boundary.
- **Caching.** A streamed page is cached once complete, under the same rules
  as a whole one. CDNs that buffer get the whole page, and those that pass
  through get the stream.

## Acceptance criteria

- [ ] `<Suspense fallback>` from `@crombolo/crombolo` sends its fallback in the
      first flush and the content when ready, swapped into place by an inline
      script carrying the page's CSP nonce. Nested boundaries resolve
      independently.
- [ ] `loading.tsx` beside a page (206's folder form) wraps the page in a
      boundary automatically.
- [ ] A page with neither renders whole, byte-for-byte as today.
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
