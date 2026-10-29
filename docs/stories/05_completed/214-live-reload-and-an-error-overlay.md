# 214 — Live reload and an error overlay

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer editing templates, I want the browser to show my change as
soon as I save, and a template error as an overlay naming the file and line
with the code around it. Then working on a Crombolo site feels like
`next dev`.

## Context

In development a change to `crombolo.config.ts`, or code it imports (routes,
211; middleware, 210), restarts the process (`bun --watch`). A template change
swaps in a new generation of views without a restart (`ViewSnapshots`), but
only when a render checks, so a save does nothing until the next request.
Islands (209) are `'use client'` files in `components/`, built with each
generation. The schema has a development watcher (`watchSchema`), and
publishing emits change events. The browser hears about none of it, so the
developer reloads by hand.

A template error in development already answers an HTML error page (206):
the message, the file and line under `components/`, and the stack
(`Renderer.describeError`), behind `errors.showDetails`. What it lacks is the
code around the line and the component stack.

Next.js's dev server pushes changes to the page and shows errors with the
source frame. Crombolo's pages are server-rendered with no client state to
keep, so a full reload on change is the honest equivalent. Islands can keep
their state later.

## Decisions

1. **The channel is Server-Sent Events** at a development-only path,
   `/crombolo/dev/events`, opened by a small script served as a file (so 209's
   strict `script-src 'self'` still holds). The first event on each connection
   is the process's boot id. A browser that reconnects after a restart sees a
   new id and reloads, which covers config, route and middleware changes.
2. **Every open page reloads** on any of these, collected over about 200ms:
   - a view generation swap (a save on disk, the back office's template
     editor, or an island);
   - a schema change;
   - a restart;
   - a publish, unpublish or delete of any content.

   In development a file watcher on `components/` triggers the swap rather
   than waiting for a render.
3. **The error page is 206's, with more in development:**
   - the code around the failing line, five lines either side, the line
     marked;
   - the component stack (`homePage › Layout › Card`), recorded by the JSX
     runtime in development only.

   It stays a full server-rendered page, and the live-reload script reloads it
   once the file is fixed. A site's `pages.error` page gets the same details
   through `usePage().outcome`.
4. **Type errors are checked in the background** after each swap: `components
   check` in a separate process, one at a time, a running check restarted by a
   newer save. Errors go to the terminal and to a dismissible banner on open
   pages, drawn by the live-reload script, until a clean run clears it. Type
   errors never block rendering.
5. **Next.js front ends (208)** get `<CromboloLiveReload />` from
   `@crombolo/next-integration`: a client component, inert outside
   development, that listens to the CMS's events through the app's
   `/api/crombolo/…` routes and calls `router.refresh()` on a content or
   schema change. The `next` template's layout includes it.

**Development** means `config.liveReload` (`CROMBOLO_LIVE_RELOAD`): on when
`NODE_ENV` is neither `production` nor `test`. Under `bun test` it is off
unless a test turns it on, or every test server would carry the script and
start a type check. Production pages carry no script, the endpoint answers
404, and the error page shows a reference only, as today. The back office's
preview frame is a page like any other and reloads too.

## Acceptance criteria

- [x] In development, pages carry the live-reload script and
      `/crombolo/dev/events` streams the boot id and change events. In
      production neither exists.
- [x] A save under `components/` (on disk or in the template editor), an
      island, a schema change, a restart, and a publish, unpublish or delete
      each reload open pages, a burst as one reload.
- [x] The development error page shows the code around the failing line and
      the component stack. Fixing the file reloads it. Production is
      unchanged.
- [x] A type error from the background check is printed in the terminal and
      shown in a banner on open pages until a clean check.
- [x] `<CromboloLiveReload />` refreshes a Next.js page on a content or schema
      change in development, renders nothing in production, and is in the
      `next` template.
- [x] `docs/writing-components.md` describes the loop, and
      `docs/delivery-api.md` ("A Next.js front end") the component. Unit tests cover the
      endpoint and boot id, the injection only in development, each trigger
      and the collecting, the code frame and component stack, the type-check
      banner's events, and the Next.js component.

## Implementation (2026-10-29)

- **`packages/render/src/live-reload.ts`:** the paths, the browser script
  and `withLiveReload`.
  - The script reloads on `reload`, or on a `hello` whose boot id differs
    from the one it first saw.
  - It draws the type banner with DOM calls and CSSOM styles, so a strict
    content security policy allows it.
- **`packages/server/src/live-reload.ts`:**
  - `createLiveReload` is the event stream. It sends `retry: 500`, then
    `hello` and the latest `types` on connect, collects changes into one
    `reload { reasons }`, and keeps quiet streams open with a heartbeat.
  - `createTypeWatch` runs the check one at a time: a newer change aborts a
    running one, and the same findings aren't sent twice.
  - `typesOf` summarises `tsc`'s lines, and `watchDirectory` watches a
    folder.
- **`server.ts`:**
  - **Triggers:** the published cache's `onInvalidate` (content), the schema
    watcher's applied report (schema), and `ViewSnapshots`' `onSwap` (views).
    A watcher on `components/` calls `snapshots.refresh()`, so a save swaps
    the views at once.
  - **Pages:** site responses that are HTML get the tag before `</body>`.
    The events path turns off Bun's idle timeout for its request.
- **`components.ts`:** `checkTypes` is exported, takes an abort signal, and
  kills `tsc` when a newer change makes its answer stale.
- **The component stack:** the JSX runtime calls a tracker installed on the
  global object (`COMPONENT_TRACKER`), so a view generation imported from
  another path finds it too.
  - `component-stack.ts` keeps the chain in `AsyncLocalStorage` and tags what
    is thrown, innermost first. The renderer runs the template and each
    layout under its alias.
  - It is installed where `errors.showDetails` is on.
- **The error page:** `describeError` adds `code` (five lines either side,
  read from `components/`, refusing a path outside it) and `components`, and
  `genericStatusPage` renders both.
- **`@crombolo/next-integration`:** `liveReloadHandler` passes on the CMS's
  stream in whole frames, and adds `revalidated` when `revalidateHandler`
  clears keys. The signal goes through the global object, since Next.js may
  bundle the module once per route. `<CromboloLiveReload />` refreshes on
  content, schema, a new boot id or `revalidated`.
- **The `next` template and `harbourstone-next`** gain
  `app/api/crombolo/live/route.ts` and the component in the root layout.
- **Tests:** `tests/live-reload.test.ts` covers:
  - the stream, the collecting, a page leaving, the type check and its
    summary, and the script and its injection;
  - the component stack, sync and async, and the error page with and without
    details;
  - a real site: the script and stream, a template error's code and
    components, a save, a schema change and a publish each reloading, and
    live reload off.

  `tests/next-integration.test.ts` covers the live route.

**Found while building:**
- **`bun test` sets `NODE_ENV=test`,** which counted as development, hence
  `liveReload`.
- **A schema change also invalidates the content,** so a `reload` carries
  every reason in its burst rather than the first. Otherwise the Next.js
  component could miss that the schema changed.
- **Bun names an async arrow function assigned to a `const` as nothing,** so
  the stack shows it as `Anonymous`. A component declared with `function`
  keeps its name.
