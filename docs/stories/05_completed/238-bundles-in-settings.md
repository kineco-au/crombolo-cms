# 238 — Bundles in Settings

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 234

## Story

As an administrator, I want installing and building bundles to be a Settings
tool beside the others, not a section of its own in the header, so that
everything that configures the site is found in one place, with the same trail
back to Settings.

## Context

Found 2026-11-01. Bundles is Umbraco's Packages section (`Umb.Section.Packages`,
`section/packages`), its three views replaced by Crombolo's:

- **Marketplace** (`bundles-marketplace.js`), at `view/packages`;
- **Installed** (`bundles-installed.js`), at `view/installed`, which opens on
  the bundle named in `?bundle=`. A bundle's group on the Settings landing page
  links there (`bundlePath` in `settings-cards.js`);
- **Created** (`bundles-created.js`), at `view/created`, which routes the
  overview and the bundle editor (`bundle-editor.js`, which overwrites
  `Umb.Workspace.PackageBuilder`) at `package-builder/create` and
  `package-builder/edit/:unique`. `BUILDER_PATH` in
  `bundles-created-overview.js` and the editor's `back-path` name
  `section/packages/view/created`.

It is the only section left in the header that configures the site rather than
holding content. Settings (story 234) is now a landing page of cards with one
trail, and a tool there opens alone under that trail.

Option A was considered and turned down: hide the header tab and link a card to
the section as it is. That is a one-line change, but Bundles would sit outside
Settings' layout, with no trail and no current header tab.

## Decisions (2026-11-01)

1. **Bundles moves into Settings**, not just behind a card. Its views become
   Settings tools that open under the Settings trail. The bundle editor moves
   under Settings' address.
2. **The landing page's groups** become Build, Site, Health, History,
   Developers, Extensions, then each bundle's own group.
3. **Extensions** is a new group holding the Bundles card.
4. **Developers** is a new group after History. It holds Extension Insights,
   retitled "Extension insights" so it is not confused with the Extensions
   group. Its Unregister action is a developer's tool: it hides an extension
   in the current tab until a reload.
5. **One Bundles card** (planned 2026-11-02), not three. It opens a tool
   with Marketplace, Installed and Created tabs, as the section has today.
   Three cards were turned down: they split one job, and Extensions would be
   mostly Bundles.
6. **The Packages section goes, and Bundles follows Settings access.** Anyone
   whose groups grant Settings can open Bundles. That includes installing and
   uninstalling a bundle, which still asks for approval of what it may do
   (story 222). Keeping the section, hidden but registered, was turned down:
   the permission would sit in the user group editor for a section nobody
   sees.
   - **Who notices:** only Administrators were seeded with Packages, and they
     have Settings. A site's own group with Packages but not Settings loses
     Bundles. Its upgrade note says so, rather than a migration granting
     Settings, which would give that group far more.
   - **A group that does have Settings** gains Bundles.

## Plan

1. **The tool** (`bundles-tool.js`, a Settings `dashboard`, pathname
   `bundles`). It has a tab strip and its own router:
   - `marketplace`, `installed` and `created`, with `created`'s
     `package-builder/create` and `package-builder/edit/:unique` under it;
   - the existing elements (`bundles-marketplace.js`, `bundles-installed.js`,
     `bundles-created.js`), reused unchanged;
   - Installed's `?bundle=` kept.

   Its manifest is conditioned on the Settings section, like every Settings
   tool, so Settings access is the only gate.
2. **Paths:** `BUILDER_PATH`, the bundle editor's `back-path`, and
   `bundlePath` in `settings-cards.js` all move to
   `section/settings/dashboard/bundles/...`.
3. **The section goes:**
   - **The fork** stops registering `Umb.Section.Packages` and its views. The
     plugin's three `sectionView` manifests become routes of the tool.
   - **`packages`** leaves the seeded Administrators' sections and
     `SECTION_ALIASES`. A site's user-group file naming `packages` is still
     read: it is a retired name, warned about and ignored, not an error.
   - **Stored groups:** migration 060 deletes their `packages` section rows,
     so no group lists a section that no longer exists.
4. **Old addresses.** The fork's `backoffice-main` forwards
   `section/packages/view/<view>/...` to
   `section/settings/dashboard/bundles/<view>/...`, keeping the query. The
   view `packages` becomes `marketplace`. The mapping is a pure function with
   a test.
5. **Server.** The three `hasSection(principal, 'packages')` checks become
   `settings`: the marketplace, install and uninstall, and created bundles
   (`server.ts`). `tests/authorization.test.ts` follows.
6. **Cards.**
   - **Groups:** Developers and Extensions are added to `GROUPS`, after History.
   - **Extension insights:** moves to Developers, retitled.
   - **Bundles card:** added under Extensions.
   - **Bundle groups:** still last.
7. **Tests.**
   - **Unit:** the groups and titles, `bundlePath`, the old-address mapping,
     `BUILDER_PATH`, the manifests (`dashboard.test.ts`,
     `bundles-backoffice.test.ts`), the seed and user-group files, migration
     060 (undone in every rewind helper), and the server's checks.
   - **Browser:** `bundle-editor`; `sign-in-dialog`, whose tab list loses
     Bundles; `settings-landing`.
8. **Docs.** `docs/bundles.md` (where the screens are, and who may use them),
   `docs/backoffice-hosting.md` (the fork's changes, Settings), the release
   notes with the upgrade note, and the story.

## Acceptance criteria

- [x] The header has no Bundles tab.
- [x] The Settings landing page shows Developers (with Extension insights)
      after History, then Extensions (with Bundles), then each bundle's group.
- [x] Bundles opens under the Settings trail, with Marketplace, Installed and
      Created. Creating and editing a bundle work there, with the way back.
- [x] A bundle's group header links to that bundle in Installed, at its new
      address.
- [x] Every `section/packages/...` address still opens the same screen.
- [x] Someone without Settings sees no Bundles card and cannot open the tool
      or call its endpoints; someone with Settings can.
- [x] No user group lists a Packages section, and a site file naming it still
      loads (without it: the schema reader has no warnings, so it is dropped
      quietly, and the release notes say so).
- [x] Unit tests cover the groups and paths. The bundle-editor and
      Settings-landing browser tests pass at the new addresses.

## Implementation (2026-11-02)

- **Fork commit** on `umbraco/crombolo`, pinned at `975104ed`:
  - **The section:** `packages/packages/umbraco-package.ts` no longer
    registers the Packages section or its views.
  - **Old addresses:** `umb-backoffice-main` routes `section/packages` to
    `moved-sections.ts`. That maps the address (`umbMovedSectionPath`, with a
    test beside it) and replaces it with the one under Settings: the view
    `packages` is the `marketplace` tab, and the rest of the path and the
    query are kept.
- **Plugin:**
  - **The tool:** `bundles-tool.js` is a Settings dashboard
    (`Crombolo.Dashboard.Bundles`, pathname `bundles`) with Marketplace,
    Installed and Created tabs, each its own route, `marketplace` by default.
    The three section-view manifests are gone; the elements are unchanged.
  - **Paths:** `BUILDER_PATH`, the bundle editor's `back-path` and
    `bundlePath` point under `section/settings/dashboard/bundles`.
  - **Cards:** `GROUPS` gains Developers and Extensions after History.
    Extension insights moves to Developers, and Bundles is the Extensions card.
- **Access:**
  - **Core and seed:** `packages` leaves `SECTION_ALIASES` and the seeded
    Administrators.
  - **Management API:** its `package` operations need Settings.
  - **Plugin API:** the three bundle endpoints check `settings`.
  - **User-group files:** a file naming `packages` drops it.
  - **Migration 060** (`MoveBundlesIntoSettings`) deletes the stored
    `packages` rows. It is undone in every rewind helper.
- **Version:** migrations 059 and 060 ship in 0.44.0, so the packages are
  versioned 0.44.0 (`bun run release:version 0.44.0`), which
  `tests/migrations.test.ts` requires. Nothing has been tagged.
- **Tests:**
  - **Unit:** `settings-cards`, `bundles-backoffice`, `dashboard`
    (manifests), `vendor` (the fork's change is served), `authorization`,
    `user-groups-files`, and the four migration rewinds.
  - **Browser:** `bundle-editor` at the new address, plus an old address
    forwarding; `settings-landing` (the new groups and the Bundles tool);
    `sign-in-dialog`, whose tab list no longer has Bundles.
