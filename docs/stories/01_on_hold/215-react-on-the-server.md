# 215 — React on the server

**Epic:** O — Building a site · **Priority:** could · **Size:** XL
**Depends on:** 206, 209, 212

## Story

As a developer who wants to use React component libraries in a page (a design
system, a charting package, a headless UI kit), I want a site to render its
templates with React itself. Then anything that runs in a Next.js server
component runs here.

## Context

Crombolo's templates use its own JSX runtime (`packages/render`), which renders
React-shaped TSX to HTML. `docs/rendering.md` says context and `useId` work,
but there are no other hooks, no `Suspense` and no error boundaries, and React
component libraries do not run, since they need React itself. Islands (209)
let React run in the browser, and 208 is a full Next.js front end. What
neither gives is React libraries inside a page Crombolo renders.

Rendering with React (`react-dom/server`'s `renderToReadableStream`, or React
Server Components) would close the last gap with a Next.js server component.
It changes the core render path, though:
- every view, block and layout would render through React;
- `usePage()`'s scope would become React context;
- the runtime's own rules (attribute handling, `dangerously`, `<select>`)
  would give way to React's;
- streaming (212) would come from React instead of being built.

## Why on hold

This is the one item where closing the gap means depending on React for every
site, including those with no React in them. 208 serves sites that want React
throughout, and 209 serves those that want it in parts. Revisit once both
ship, if sites still ask for React libraries rendered on the server.

## Decisions to take when it is picked up

- **Per site or always.** A site setting, `render: 'react'`, choosing React's
  runtime for that site's templates, or React for everyone.
- **Plain SSR or Server Components.** `renderToReadableStream` is simpler.
  Islands (209) already use `'use client'` as the boundary, so either way the
  same client files should render on the server unchanged, replacing their
  fallback with real HTML.
- **Compatibility.** What a template written for Crombolo's runtime must
  change, and whether `crombolo components check` can say so.

## Acceptance criteria

To be written when the decisions above are taken.
