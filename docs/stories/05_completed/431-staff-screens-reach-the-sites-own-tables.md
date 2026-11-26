# 431 — Staff screens reach the site's own tables

**Epic:** O — Building a site · **Priority:** must · **Size:** L
**Depends on:** 189, 211, 289, 320, 323, 324

## Story

As a developer of a site that is part application, I want the screens I add to
the back office to read and change the same tables my pages do, so that staff
can moderate, correct and export what members record.

## Context

A site's domain data lives in tables of its own (189). Its pages reach them
through named queries (`site().queries`), its routes and jobs too. Staff screens
cannot:

- **A back-office route or a described screen belongs to a bundle.** It is given
  `bundle`, `caller` and `principal`, and never `site()`
  (`packages/server/src/bundles.ts`).
- **A bundle's `database` is its own tables alone,** confined by a role of its
  own (Part 4 of `docs/bundles.md`). It cannot name the site's.
- **Turned round, it fails too.** Tables the bundle owns are out of reach of
  `site().queries`, so server-rendered pages could not show them.
- **A site's own routes** (211) are never back-office ones: they know the member,
  not the user, and a `web` node serves them.

So one set of tables cannot serve both. Today's ways round are a member route
that staff call as members, or keeping the data twice.

Raised by a site being rebuilt on Crombolo, whose staff filter, correct,
moderate and export the records its members make.

### What that site's back office needs (read 2026-11-26)

Its 22 screens: observations, filtered by a date range and by species group, species
and event chosen in turn, sorted, paged and exported as CSV; an observation's editor,
with its photos uploaded, shown and deleted; special observations in tabs by status,
approved or rejected from the row; import batches, a CSV or zip uploaded, validated
and queued, with each batch's file and error report downloaded; species, species
groups and events, listed and edited; and the members admin (207). Under one section
of its own, with a menu of those places.

Described screens (323) draw the lists, forms, tabs and row actions. They have no
date field, no choices that depend on another, no paging or sorting, no opening one
screen from another with a key, no file field, no download, no image and no dialog.
Nothing there needs a map or a chart. Too much is missing for described screens to
carry it, so the site's screens are back-office code of its own (decision 4).

## Decisions (2026-11-26, the maintainer's)

1. **The site's own back-office screens and routes** (option A). `crombolo.config.ts`
   lists them; they run in the server, as the site's routes do, given `site()` acting as
   the signed-in user. No extension reaches the site's tables, and pages read no
   extension's.
2. **A section of the site's own,** granted to user groups as an extension's section
   is, with **two levels**: a strip of places under the header, as Content has (289),
   each opening a menu of screens beside the editor. Extensions declare a section the
   same way.
3. **`user()` in a query's caller,** beside `member()`: the user's key, name and groups,
   undefined for a member or a visitor, as `member()` is for a user. One query serves
   both and refuses either.
4. **The site's screens are its own back-office code, never described.** It is packed in
   its site package as its components are, and trusted as its pages are: no grant, no
   panel. Described screens (323) stay what an extension from npm draws its screens with,
   and the only way it has any (decision 5); a site does not describe screens.
5. **Extensions lose back-office code,** in this story. `backoffice.code` (320) and the
   Unrestricted level (324) are retired: an extension describes its screens, or has none.
   Neither of ours ships any.

## Acceptance criteria

**Reach**
- [x] A site lists back-office routes in `crombolo.config.ts`; each handler gets `site()`
      acting as the signed-in user, `principal` and `signal`, and `site().queries` and
      `site().members` work there.
- [x] A query's caller has `user()`; a page's call has none, a screen's has no `member()`.
- [x] A change through a query is in the audit log where the site records it, naming the
      user.
- [x] A write from another site is refused, as the back office's own are.

**The section**
- [x] The config names a section of the site's own: its label, its places, and each
      place's menu of screens. User groups are given it as any other section.
- [x] It is in the header for those who hold it, with its strip of places, each opening
      its menu beside the editor, and every screen at an address that reloads.
- [x] An extension declares a section, places and menus the same way, with described
      screens.
- [x] A user without the section, and a member, are refused every screen and route
      before any site code runs; a `web` node serves none of it.
- [x] A clash of section, path or id with an extension's refuses the boot, by name.

**Screens**
- [x] The site's back-office code, from a folder of its own, is built at boot and served
      only from that build, and each of its screens opens in a menu.
- [x] `crombolo site build` packs it and an install of the site package lands it; an
      extension's package carrying it is refused, as `components/` is.
- [x] A back-office route that throws answers a problem with a reference, and logs it
      under that reference.
- [x] It asks with the back office's own dialogs: `confirm`, `alert` and `prompt` are
      refused by the check that holds extensions to it today.

**Extensions without back-office code**
- [x] A manifest asking for `backoffice.code`, or with `src/backoffice/`, is refused by
      `crombolo extension check` and at every install, saying screens are described now.
- [x] One installed and granted it before is left off at boot with that reason, in
      Installed and the health check; the rest of the site starts.
- [x] The install panel has two levels, Limited and Acts as you;
      `CROMBOLO_UNRESTRICTED_EXTENSIONS` is retired, a boot with it set saying so once.
- [x] `crombolo extension migrate` says what to do with an extension that had it.

**Docs and tests**
- [x] `docs/rendering.md`, `docs/bundles.md`, `docs/extensions.md`,
      `docs/extension-threat-model.md` and the release notes describe it, with one
      example read by a page and changed by a screen of the site's back-office code, and
      the upgrade note for an
      extension that shipped back-office code.
- [x] Tests on SQLite and Postgres; one browser test of a site section, a place and a
      screen of the site's back-office code, and an extension's section with a described
      screen.

## Plan

### Findings

- **Routes:** a back-office bundle route is answered by `ServerBundles.handle`
  (`bundles.ts`), which checks the section before dispatch and builds a `BundleCaller`.
  The site's routes reuse that gate with a caller of their own and `site()` from
  `site-services.ts`, acting as the principal, as `site-content.ts` and `site-members.ts`
  already can (`siteWriteScope`).
- **A section** from an extension is a manifest alias `Vendor.Section.Name`
  (`isExtensionSectionAlias`); the site's is a manifest the server writes into the back
  office's, as `extensionOf` (`backoffice-host/src/extensions.ts`) does for an extension.
- **The strip** is Content's own: `content-strip.js` and `content-strip-items.js`, with
  its places hard-coded. It becomes one element given its places, used by Content and
  by any declared section.
- **Back-office code:** an extension's is built from `src/backoffice/` to
  `.crombolo/extensions/<id>/backoffice/` and served from there (320). The site's takes
  the same build, from its own folder, into `.crombolo/site/backoffice/`.
- **Retiring `backoffice.code`** touches `bundle-permissions.ts` (`levelOf`,
  `LEVEL_WORDS`), `bundle-package.ts`, `bundle-grants.ts`, `core.ts`, `remote.ts`, the
  migrate command, and about a dozen test files. `actAs`'s retirement (325) is the
  pattern: refused by name, with the reason.

### Slices

1. **Reach:** config shape, the site's back-office routes behind the section gate,
   `site()` as the user, `user()` in `QueryCaller`, the audit.
2. **The section:** config and extension manifest shape, the manifest the server writes,
   the strip made general, places and menus, addresses and reloads.
3. **The site's back-office code:** folder, build, serve, register in its menus, pack and
   install, the dialog check.
4. **Retire `backoffice.code`:** refusal, boot, panel, setting, migrate, tests.
5. **Docs, the example, the browser test.**

Slice 4 can be cut separately once 3 lands, if the story runs long.

### Decided in building (2026-11-26, the maintainer's)

- **The site declares its sections in Crombolo's own shape,** `backoffice.sections` in
  `crombolo.config.ts`, and the server writes the back office's manifests from it; not
  Umbraco's manifests by hand.

## What was built

- **Config and routes:** `packages/server/src/site-backoffice.ts` (`SiteSection`,
  `siteBackOfficeProblems`, `sectionClashes`, `matchSiteBackOfficeRoute`), checked at boot
  (`core.ts`, `server.ts`). Routes answer below `<back office>/crombolo/api/site/<section>/`
  in `server.ts`, behind the back office's sign-in and the section, through the site
  routes' `invoke` with `site()` acting as the user (`RouteInvokeOptions.site`) and written
  under `back-office route <method> <path>`.
- **`site()` as a user:** `createSiteServices(...).asUser(principal)`
  (`site-services.ts`): queries with `QueryCaller.user()` (`render/src/site.ts`,
  `site-queries.ts`), members as the user, content acting as them
  (`createSiteContent({ as })`), jobs queued by them.
- **The site's code:** `site-backoffice-build.ts` builds each screen's module with
  `Bun.build` into `.crombolo/site/backoffice/`, refusing the browser's dialogs; served at
  `<plugin>/site/` (`static.ts`), its manifest added to the manifest endpoint (`ports.ts`,
  `collectManifests`'s `more`).
- **Sections in the back office:** `backoffice-host/src/sections.ts` writes a section and
  its `sectionLayout`, the places in its `meta`. The plugin's `site-section.js` lays one
  out (menu and screen, kept per screen), `content-strip.js` draws its places, and the
  group editor offers it in Access (`declaredAreas`). Pure helpers in
  `site-section-model.js`.
- **Extensions' sections:** `crombolo.sections` (`sectionProblems`, `extensionOf`), each
  screen a described one.
- **Extensions' back-office code retired:** refused in `validateBundlePackage` and
  `readPermissions`; `extension-backoffice.ts` and serving `/bundles/` removed; the
  Unrestricted level, `CROMBOLO_UNRESTRICTED_EXTENSIONS` and the install panel's config
  snippet gone; the back office's `connect-src` the site and the host only; the
  Marketplace removes one that lands with back-office code; `extension migrate` refuses
  one, saying what to change. The browser suite's side panel is a described screen.
- **Tests:** `tests/site-backoffice.test.ts`, `tests/browser/site-section.browser.ts`, and
  the extension, level, migrate, Marketplace and content-security tests rewritten.
- **Docs:** `rendering.md` ("Staff screens"), `extensions.md`, `bundles.md`,
  `extension-threat-model.md`, `configuration.md`, the release notes.
