# 234 — A Settings landing page of cards

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 021, 235

## Story

As an administrator opening Settings, I want a page of cards, each naming one
thing I can do there and what it is for, so that I find the tool I came for
without scanning a row of tabs and a tree that has nothing to do with most of them.

## Context

Found 2026-10-31. Settings is Umbraco's layout: a tree beside a main area.

- **Ten tabs, which overflow:** Welcome, Search indexes, Published status,
  Models Builder, Health check, Search & sharing, Page addresses, Changes, Audit
  log and Background jobs.
- **A tree in three groups:**
  - Structure: content, media and member types, data types, languages.
  - Templating: components, stylesheets, scripts.
  - Advanced: relations, log viewer, extensions, webhooks.

The tree shows beside every tab, though no tab uses it, and the Advanced group
holds tools like the tabs rather than structure.

Telemetry showed on a site installed from npm because that site ran the
vendored client from 14 October, which npm kept until 0.42.0 put
`@crombolo/backoffice-dist` on crombolo's version. Changes and Page addresses
failed there with `provideContext is not a function`. They, Audit log and
Background jobs were plain `LitElement`s, which a section cannot give a context.
Fixed in 0.42.0, and `tests/dashboard.test.ts` now holds dashboards to it too.

## Decisions (2026-10-31)

1. **A landing page of cards, in groups.** Settings opens on cards, each with a
   title and a line on what it is for:

   | Group | Cards |
   | --- | --- |
   | Build | Structure, Code, Types for code (Umbraco's Models Builder), Workflows |
   | Site | Search & sharing, Page addresses, Webhooks, Logs, Search indexes, Background jobs, Extensions |
   | Health | Health check, Published status, Relations |
   | History | Changes, Audit log |
   | Other | a Settings dashboard a bundle adds, by its own label |

   It replaces the Welcome tab (`Crombolo.Dashboard.Settings`).
2. **The tree is split, and shown only where it is used.**
   - **Structure** opens the content, media and member types, data types and
     languages.
   - **Code** opens components, stylesheets and scripts.
   - Each opens as the tree and editor of today. The Advanced group's items
     (log viewer, extensions, relations, webhooks) become cards, so the tree
     holds only what is edited as a tree.
   - Not chosen: one Structure card keeping the whole tree, which keeps tools
     in a tree that is not about them.
3. **Only what is implemented has a card; there are no disabled cards.** Every
   tool listed above works today: the fallback list of empty Settings trees is
   empty. Telemetry and Profiling were removed from the vendored client on
   purpose. A feature that is not built gets a card when its story lands.
4. **Every card has an address**, so the back button and bookmarks work.
   - Every tool has a way back to the landing page.
   - The header's Settings button opens the landing page.
   - Inside Structure or Code, the tree keeps its place as it does today.
5. **A card shows only to someone who can open it**, by the same conditions the
   dashboard or tree item has today.
6. **Settings keeps its alias and gets Crombolo's layout from a manifest the
   fork looks up** (revised 2026-11-01, replacing "at runtime from an entry
   point"; see Paused below).
   - A fork commit in `backoffice-main.element.ts`: building a section's route,
     it takes the element of a `sectionLayout` manifest whose `forSection`
     names that section, and `umb-section-default` when there is none.
   - The plugin declares `Crombolo.SectionLayout.Settings` in
     `umbraco-package.json`. Umbraco registers a package's manifests before it
     draws a section (`app.element.ts`, `#loadedGuard`), so a page opened
     straight at Settings gets the layout first time.
   - Every dashboard, menu and condition naming `Umb.Section.Settings` still
     matches it, and the layout's code stays in the plugin.
   - Not chosen:
     - The layout in the fork, named by the Settings manifest: it puts
       Crombolo's cards, words and API calls in Umbraco's tree, against `235`'s
       split.
     - A fork commit rebuilding a section's route when its manifest is
       registered again, keeping the entry point: a page opened straight at
       Settings draws Umbraco's layout and then swaps it.
     - A new section overwriting Settings: everything matching
       `Umb.Section.Settings` would leave it.

## Plan

0. **The fork** (commits on `umbraco/crombolo`, then `bun run fork:pin`):
   - the `sectionLayout` lookup of decision 6;
   - Umbraco's Settings Welcome dashboard (`Umb.Dashboard.SettingsWelcome`)
     deleted, as telemetry and news were.
1. **The layout** (`plugin/settings-section.js`, named by the
   `Crombolo.SectionLayout.Settings` manifest): Crombolo's element for `Umb.Section.Settings`, built on Umbraco's section
   pieces (`umb-split-panel`, `umb-section-sidebar`, `umb-section-main`, the
   `sectionRoute` extensions). Its routes:
   - `''`: the landing page.
   - `dashboard/<pathname>`: that dashboard alone, without the tab bar, given
     the view context Umbraco's `umb-section-main-views` gives it. These are
     the addresses dashboards have today.
   - `structure` and `code`: the tree beside a short "choose something to
     edit" panel.
   - `workspace/…`: Umbraco's editors, as now. The tree shows only for an item
     edited from Structure or Code, chosen by its entity type (document, media
     and member types, data types and languages and their folders → Structure;
     components, stylesheets and scripts → Code), so a link straight to an item
     shows the right tree. The Advanced tools' editors show without one.
2. **The cards** (`plugin/settings-cards.js`, pure, so unit tests read it):
   - **What they come from:** the permitted dashboards, from the registry with
     their own conditions, and the Advanced menu items.
   - **Words:** each card's group, title and line are ours, keyed by alias.
   - **Unknown dashboards:** one we have no words for goes under Other with its
     own label.
   - **Structure and Code:** each shows when its menu has an item the user may
     open.
3. **The trees:** the Structure and Templating sidebar menus are shown by the
   layout, one at a time. The Advanced menu is not shown; its items are cards.
4. **The way back:** a "Settings" link heading every tool and tree; the header's
   Settings button keeps `section/settings`, which is now the landing page.
5. **Tests:**
   - Unit: the cards an administrator sees and those a group without the log
     viewer sees; the entity type to tree mapping; an unknown dashboard under
     Other.
   - The fork: `tests/vendor.test.ts` finds the `sectionLayout` lookup in the
     served `backoffice-main` and no welcome dashboard, as it checks the
     fork's other changes; the browser test opened straight at Settings is
     the lookup working.
   - `tests/plugin-boundary.test.ts` still passes: nothing is patched.
   - Browser: the landing page opened straight at `section/settings`, a
     dashboard card and its way back, Structure's tree with a content type
     open, an address from before, and the header button.
6. **Docs:** `docs/backoffice-hosting.md` (the Settings section, and the fork's
   commits), the release notes.
7. **From `wip/234-settings`:** `settings-cards.js`, `settings-section.js` and
   their tests carry over. `settings-section-entry.js`, its entry-point
   manifest, `Crombolo.Dashboard.Settings` and `settings-dashboard.js` go.

## Acceptance criteria

- [x] Settings opens on the landing page, grouped as above, with no tree and no
      tabs; the header's Settings button opens it.
- [x] Structure and Code each open their own tree with the editors of today;
      no other tool shows a tree.
- [x] Every tool from the tabs and the Advanced tree is a card with its own
      address and a way back, and links to the old addresses still open.
- [x] Only implemented tools have cards; there are no disabled cards.
- [x] A card shows only to someone who may open it.
- [x] A bundle's Settings dashboard shows as a card under Other.
- [x] Tests and docs as in the plan.

## Implementation (2026-11-01)

- **Fork commits** on `umbraco/crombolo`, pinned at `d1122128`:
  - `Crombolo: a package's sectionLayout draws a section`: the
    `ManifestSectionLayout` type (`core/section/extensions`) and `#layoutOf` in
    `backoffice-main.element.ts`, which reads the registry when a section's
    route is drawn.
  - `Crombolo: no Settings welcome dashboard`: `settings/welcome` deleted.
- **Plugin:**
  - `settings-section.js` and `settings-cards.js` came over from the paused
    `wip/234-settings`.
  - `Crombolo.SectionLayout.Settings` in `umbraco-package.json` replaces
    `Crombolo.Dashboard.Settings`.
  - `settings-dashboard.js` is deleted. The entry point the paused work used
    was never brought over.
  - With the welcome gone from the fork, `settings-cards.js` no longer filters
    it out.
- **Tests:**
  - `tests/settings-cards.test.ts`;
  - `tests/vendor.test.ts` ("the fork's changes are in what is served");
  - `tests/dashboard.test.ts` (the plugin's manifest list);
  - `tests/browser/settings-landing.browser.ts`;
  - `tests/browser/settings-header.browser.ts`, where the gear now opens the
    cards;
  - `tests/browser/settings.browser.ts`, where the Code tree is at `code`.
- **Docs:** `docs/backoffice-hosting.md` ("Settings", and the fork's changes),
  `docs/release-notes.md`.
- **Approvals only when it is in use (2026-11-01):** the section and a page's
  Workflow tab carry `Crombolo.Condition.ApprovalsActive`
  (`plugin/approvals-active.js`). It asks `approvals/active`, which is true
  while a workflow exists or any request is open, so nothing under way is
  stranded. The designer calls `approvalsChanged()` after a save or delete,
  so the first workflow brings them in without a reload. If the check fails,
  Approvals stays.
- **Deleting a workflow (2026-11-01):** deleting stays allowed, since a deploy
  removing the file deletes it anyway. `syncWorkflows` now withdraws a removed
  workflow's waiting requests whatever `on-change` says. `DELETE
  workflows/<alias>/preview` names them, and the designer's confirm lists the
  pages.
- **Tests for those:**
  - `tests/approvals.test.ts`: deleting under `keep`, covering the preview,
    the withdrawal, its history and `active`;
  - `tests/dashboard.test.ts`: the condition's manifest;
  - `tests/browser/workflow-section.browser.ts`: Approvals is absent with no
    workflow, comes with one and goes when the designer deletes it.
- **A breadcrumb (2026-11-01):** every Settings page but the landing page is
  headed by the same trail, `crombolo-breadcrumb` (`plugin/breadcrumb.js`). It
  is UUI's breadcrumbs: Settings, then the tool (Health Check), the tree
  (Structure) or the Advanced tool an editor belongs to (Logs). It replaces the
  "← Settings" link, which sat in the sidebar beside a tree and beside a title
  over a tool, and named no tree. `crumbsFor` and `advancedToolTitle`
  (`settings-cards.js`) are unit-tested.
- **A card component (2026-11-01):** each landing-page card is
  `crombolo-settings-card` (`plugin/settings-card.js`), its title on a dark
  band in white: cocoa in light mode and a deep brown in dark, through
  `--crombolo-card-header-*`, with both pairs in `tests/theme.test.ts`.
- **A group per bundle (2026-11-01):** a bundle's cards sit under its name,
  after the built-in groups, with its manifest's `meta.description`. The
  header links to the bundle in Bundles → Installed, which opens on the bundle
  named in `?bundle=`. The server stamps each served extension with
  `cromboloBundle: { name, packageName }` (`backoffice-host/src/extensions.ts`). "Other" is left for
  anything from neither. Tested in `tests/settings-cards.test.ts` and
  `tests/extensions.test.ts`.
- **The trees stay in the page (2026-11-01):** both trees are always attached
  to the sidebar, and the one not in use is hidden, as Umbraco's own Settings
  keeps its menus. A tree taken out of the page and put back threw "Cannot
  read properties of undefined (reading 'forEach')", and then "Tree context is
  not set". The trees share the section's expansion state, and a detached one
  still answers it. The sidebar is now a fixed 300px rather than a resizable
  split panel. `settings-landing.browser.ts` goes from a tree to Settings and
  back.
- **The e-mail notice is a banner** above the cards, not a box of its own.
