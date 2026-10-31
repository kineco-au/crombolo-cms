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
   | Build | Structure, Code, Types for code (Umbraco's Models Builder) |
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
6. **Settings keeps its alias and gets Crombolo's layout at runtime.** An entry
   point re-registers `Umb.Section.Settings` with Crombolo's section element in
   place of `umb-section-default`. Every dashboard, menu and condition that
   names the section still matches it. If the element fails to load, Umbraco's
   layout remains. Not chosen:
   - Patching the section in `vendor:backoffice`, which each Umbraco upgrade
     has to re-check.
   - A new section overwriting Settings: everything matching
     `Umb.Section.Settings` would leave it.

## Plan

1. **The layout** (`plugin/settings-section.js`, registered by an entry point):
   Crombolo's element for `Umb.Section.Settings`, built on Umbraco's section
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
   - Browser: the landing page, a dashboard card and its way back, Structure's
     tree with a content type open, an address from before, and the header
     button.
6. **Docs:** `docs/backoffice-hosting.md` (the Settings section), the release
   notes.

## Acceptance criteria

- [ ] Settings opens on the landing page, grouped as above, with no tree and no
      tabs; the header's Settings button opens it.
- [ ] Structure and Code each open their own tree with the editors of today;
      no other tool shows a tree.
- [ ] Every tool from the tabs and the Advanced tree is a card with its own
      address and a way back, and links to the old addresses still open.
- [ ] Only implemented tools have cards; there are no disabled cards.
- [ ] A card shows only to someone who may open it.
- [ ] A bundle's Settings dashboard shows as a card under Other.
- [ ] Tests and docs as in the plan.

## Paused (2026-10-31), waiting for `235`

Built so far, uncommitted:
- `plugin/settings-cards.js`, with `tests/settings-cards.test.ts` (passing);
- `plugin/settings-section.js`, the layout;
- `plugin/settings-section-entry.js`, which tried to give the section that
  layout at runtime;
- the Welcome dashboard (`settings-dashboard.js`) removed;
- `tests/browser/settings-landing.browser.ts`.

Decision 6 is replaced. Giving the section an element from an entry point fails
for a page opened straight at Settings: the section is drawn before the entry
point runs, and the route is not rebuilt for a manifest re-registered under the
same alias. The only fix found was to unregister the section for a tick. With
`235`, the section's element is set in the fork's own manifest, and the entry
point goes. The cards, the layout and their tests carry over.
