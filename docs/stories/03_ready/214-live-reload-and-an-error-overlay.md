# 214 — Live reload and an error overlay

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer editing templates, I want the browser to show my change as
soon as I save, and a template error as an overlay naming the file and line
with the code around it. Then working on a Crombolo site feels like
`next dev`.

## Context

In development Crombolo restarts on change (`bun --watch`, `start:local:watch`),
and the renderer swaps in a new generation of views. The browser does not
know, so the developer reloads by hand. A template error answers a plain-text
500 with the stack (`config.development`), not a page that points at the code.

Next.js's dev server pushes changes to the page (Fast Refresh, keeping client
state) and shows build and runtime errors in an overlay with the source frame.
Crombolo's pages are server-rendered with no client state to keep, so a full
reload on change is the honest equivalent. Islands (209) can keep their state
later.

## Decisions before implementation

- **The channel.** Recommended: Server-Sent Events from the development
  server, which every browser supports and which need no client library. A
  small script is injected into pages only in development.
- **What triggers a reload.** Recommended: any change to `components/`,
  `client/` (209), `routes/` (211), `middleware.ts` (210) or `schema/`, and
  publishing content.

## Acceptance criteria

- [ ] In development only, pages carry a small script that listens on an SSE
      endpoint and reloads when the site's views, client code, routes,
      middleware or schema change, or when content is published. Production
      pages carry nothing.
- [ ] A save in the back office's template editor reloads open pages the same
      way.
- [ ] A template error in development renders an overlay page: the error, the
      file and line through the source paths `inSource` already maps, the
      code around it, and the component stack. Fixing the file reloads the
      page.
- [ ] A type error from `crombolo components check` while the server runs is
      shown in the overlay of the next page loaded, and in the terminal.
- [ ] Production keeps today's plain 500 and log line, with no source shown.
- [ ] `docs/writing-components.md` describes the loop. Unit tests cover the
      endpoint, the injection only in development, the triggers and the
      overlay's rendering.
