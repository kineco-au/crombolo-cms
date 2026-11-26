# 437 — The site's own side panels, and modules from its packages

**Epic:** O — Building a site · **Priority:** must · **Size:** M
**Depends on:** 182, 431

## Story

As a developer of a site, I want back-office code of the site's own that is there in every
section, and to bring it, and its screens, from a package the site depends on, so that a
drawer an extension used to give moves to the site when extensions no longer ship code.

## Context

Asked for by a host on 2026-11-26, before 0.81.0. 431 retires extensions' own back-office
code, and gives the site sections of its own. A host whose extension gave a drawer opened
from the header in every section has nowhere to put it: a section is one place. Its site's
config is composed in a wrapper package, whose modules are in `node_modules`, and 431 takes
only paths inside the site.

## Decisions (2026-11-26, the maintainer's)

1. **Side panels** (story 182): `backoffice.panels` in `crombolo.config.ts`, each an alias,
   a label, an icon and a module, drawn in a side panel with its header toggle, in every
   section. Each is a grant of its own, `Site.Panel.<alias>`, offered in Access, shown only
   to those who hold it. A panel may have routes, as a section does, behind its grant.
2. **A module may be a package specifier,** `@acme/host/backoffice/drawer.ts`, resolved
   from the site as its imports are, so only a package the site depends on provides one.
   It is the site's own code. An absolute path, or a path climbing out of the site, stays
   refused. Sections' screens take the same.
3. **Both in 0.81.0.**

## Acceptance criteria

- [x] A panel declared in the config is a side panel with its toggle, for those who hold its
      grant, drawing the site's element; Access offers the grant.
- [x] A panel's routes answer only those who hold its grant, with `site()` as them.
- [x] A screen's or panel's module may be a package specifier, resolved from the site, built
      and served as one in the site is; one that does not resolve refuses the boot, naming it.
- [x] A panel's alias that a section has, or another panel, refuses the boot.
- [x] `docs/rendering.md` ("Staff screens") and the release notes. Tests on SQLite, and the
      browser test for a panel.

## What was built

- `site-backoffice.ts`: `SitePanel`, `backoffice.panels`, `resolveModule` (a path in the site
  or a package specifier, resolved from the site), panels checked with sections, routes
  matched for either with the grant that opens them (`Site.Section.*`, `Site.Panel.*`).
- `site-backoffice-build.ts`: modules resolved to their files and built from the folder they
  share (`plannedModules`), so a package's module is served at its place under it; each panel
  a `sidePanel` with its toggle, held to its grant by `Umb.Condition.SectionUserPermission`.
- The group editor offers each panel's grant (`panelAreas`).
- Tests: `site-backoffice.test.ts` (checks, a panel from a package, its route's grant); the
  browser suite's Help panel (`side-panel.browser.ts`).
- Docs: `rendering.md`, the release notes.
