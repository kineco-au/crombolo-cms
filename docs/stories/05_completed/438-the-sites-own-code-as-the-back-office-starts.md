# 438 — The site's own code as the back office starts, and panels for everyone

**Epic:** O — Building a site · **Priority:** must · **Size:** S
**Depends on:** 431, 437

## Story

As a developer of a site, I want modules of the site's own run as the back office starts,
and a panel there for everyone, so that what an extension's back-office code registered,
a context watching the open workspace or a card in the user's profile, has a home in the
site, and a panel meant for everyone needs no grant on every group.

## Context

Asked for by a host on 2026-11-26, before 0.81.0. A panel's module loads only when the
panel opens, so code that must be there from the start, registering a workspace context
or a user profile app, has nowhere to run.

## Decisions (2026-11-26, the maintainer's)

- **`backoffice.entryPoints`:** modules of the site's own, resolved and built as 437's are,
  each a `backofficeEntryPoint` loaded for everyone signed in to the back office; its
  `onInit(host, extensionRegistry)` registers what it needs. It is the site's own code,
  held to the same refusal of the browser's dialogs.
- **`everyone: true` on a panel:** no grant and no condition: every signed-in user has it,
  and its routes answer anyone signed in to the back office.
- **Both in 0.81.0.**

## Acceptance criteria

- [x] Each entry point is built, served and loaded as the back office starts; one that does
      not resolve refuses the boot, naming it.
- [x] A panel with `everyone: true` shows for every user, is not offered in Access, and its
      routes answer anyone signed in to the back office.
- [x] `docs/rendering.md` and the release notes. Tests on SQLite, and in the browser.

## What was built

- `site-backoffice.ts`: `backoffice.entryPoints`, each module checked with `resolveModule`;
  `SitePanel.everyone`, whose routes match with no grant. `site-backoffice-build.ts`: each
  entry point a `backofficeEntryPoint` manifest; a panel for everyone with no condition and
  no grant. `server.ts` checks a grant only where there is one.
- Found on the way: the side panel layout restored the remembered panel only among the first
  panels to arrive (`side-panel/context.js`); it waits for the remembered one now.
- Tests: `site-backoffice.test.ts`; the browser suite's entry point
  (`site-section.browser.ts`).
- Docs: `rendering.md`, the release notes.
