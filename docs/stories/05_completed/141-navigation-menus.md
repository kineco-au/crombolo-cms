# 141 — Navigation menus

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an editor, I want to build the site's menus — header, footer, any other —
by picking and ordering pages and links, so that changing navigation does not
need a developer.

## Context

Today navigation is whatever a component derives from the tree, with
`umbracoNaviHide` to leave a page out ([`seo.md`](../../seo.md)). WordPress
editors expect a menu editor, and story `073` needs somewhere to put the menus
it imports. A multi-URL picker property on a settings node is the usual
Umbraco answer; a first-class menu is easier for editors and for importers.

## Acceptance criteria

- [x] Menus are named, per culture, made of pages, external links and labels,
      nested to any depth, edited by drag and drop in the backoffice.
- [x] A menu item that names a page follows it when it is renamed or moved, and
      drops out while it is unpublished or trashed.
- [x] Components read a menu by name (`menu('header')`), cached with the
      published content; the Delivery API serves them.
- [x] Menus travel in bundles and content transfer.
- [x] A starter template uses one for its header.

## Decisions (2026-10-22)

- **Menus are Library elements**, not a new kind of thing: a shipped `menu`
  element type offered in the Library and a `menuItem` element type, nested as
  blocks. Publishing, per-culture versions, bundles, content transfer and the
  published cache are what elements already have, so nothing was built twice.
- **Templates name a menu by an Alias field**, the usual Umbraco pattern for
  content: filled from the name when empty, kept on rename, unique.

## What was built

- **Types and data types**, ensured at boot: `menu` (`alias`, `items`) and
  `menuItem` (`link`, `label`, `children`) in `SYSTEM_CONTENT_TYPES`, which now
  carry `isElement` and `allowedInLibrary`; the `menuItems` block list and the
  `menuLink` multi-URL picker in `CROMBOLO_DATA_TYPES`. The schema validator lets a
  site's file for a shipped element type stay an element type.
- **The alias**: `withMenuAlias` in `packages/server/src/adapters/elements.ts`
  fills it with `safeAlias(name)` (new in core) and refuses a duplicate, on create,
  update and both publish paths.
- **The builder**, `buildMenu` in `packages/render/src/menus.ts`, reads the stored
  blocks itself: a block's properties are not converted, and the stored link is
  what tells an item that never had one (a heading) from one whose page is gone.
  `PublishedCache.menu(alias, culture)`, `menuItemsIn` for the renderer, and
  `PageProps.menu`.
- **The Delivery API**: `GET v2/menus/{alias}`, with members-only pages left out,
  CORS and caching as the other content endpoints; `menu()` in the client.
- **Transfer**: an export no longer lists a shipped content or media type as
  something the destination must have.
- **The starter** ships a "Main navigation" menu (alias `main`) and its header
  reads it, falling back to the tree.
- **Tests**: `tests/menus.test.ts` (labels, nesting, an address, a heading; a
  rename followed and an unpublish dropped; the alias filled, kept and refused;
  the Delivery API with a members-only page; the types; a bundle round trip). The
  type listings in `content-types`, `settings`, `media-types`, `elements` and
  `templates` tests now leave out the shipped types (`tests/support/shipped.ts`),
  so the next one shipped does not rewrite them.
