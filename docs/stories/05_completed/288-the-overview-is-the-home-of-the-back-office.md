# 288 — The overview is the home of the back office

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an editor, I want the overview to be where I land when I sign in and where the Crombolo
logo takes me, with the system's details on it, and the Content section to open on my
site's home page, so that the first page shows what is happening and going to Content
takes me straight to the content.

## Context

The Overview (story 236) is a dashboard in the Content section, overwriting Umbraco's news
(`Crombolo.Dashboard.Overview` in `packages/backoffice-host/plugin/umbraco-package.json`).
So Content opens on the overview rather than on any page, and an editor has to pick a page
in the tree before they can do anything with one.

The logo opens a popover with the version, a GitHub link and a button for the system
information dialog (`backoffice-header-logo.element.ts` in the fork).

## Decisions (2026-11-07)

- **Not a section** (the maintainer's choice, replacing the first version of this story).
  It is a view of its own at `home`, with no tab in the header and no section grant, so
  no migration.
- **It is called Home** (the maintainer's change), at the address `home`, and the logo
  still opens it. Internal names keep `overview`: the API path and the plugin's file.
- **Every trail in Settings starts at Home,** and the cards page gains one: Home, Settings.
  The Home crumb goes to the back office's root, so someone without Content reaches their
  first section rather than a page that is not there for them.
- **The logo opens it.** The popover goes.
- **System information moves onto the Overview.** The version and what the dialog shows
  become a section of the page, and the logo no longer opens anything else.
- **Everyone with Content gets it** (the maintainer's choice). Someone without Content has
  no Overview: they land on their first section as today, and the logo takes them there.
- **Home is the first root page the user can see** (the maintainer's choice): the top of
  their Content tree, which respects start nodes and needs no setting.
- **Selecting Content opens Home every time,** replacing history rather than adding to it,
  so the back button leaves the section instead of returning to a redirect.
- **With no page to open, Content says so** and offers New content if the user may create.
  The Overview's own New content opens the same choice.

## Findings (2026-11-07)

- **Landing is the first route.** `backoffice-main.element.ts` redirects `''` to the first
  allowed section, with no memory of the last one. So the fork's change is small: a
  `home` route ahead of the sections when the user has Content, and `''` going there.
- **The fork has no way to route to a plugin's element outside a section.** The route looks
  the view up in the registry, as `#layoutOf` does for a `sectionLayout`, so the element
  stays in `packages/backoffice-host/plugin`.
- **With no section active, the header highlights no tab,** which is right here, but
  `setActiveSectionAlias` needs clearing when the view opens.
- **A dashboard stays the way into Content.** `Crombolo.Dashboard.Overview` becomes a small
  dashboard, still overwriting the news, that opens Home or shows the fallback.
- **Someone without Content loses the version,** which the popover showed to everyone. The
  system information is not otherwise reachable for them.
- **Six browser test files** go through Content and expect the dashboard there, and two
  rely on the Overview listing a page beside the tree.
- **The overview's server route stays as it is,** since it already asks for Content.

## Acceptance criteria

- [x] Signing in lands on the Overview for a user with Content, and on their first section
      otherwise.
- [x] The logo opens the Overview from anywhere, and its popover is gone.
- [x] The Overview shows the version and the system information the dialog showed.
- [x] The header marks no section as active on the Overview.
- [x] Selecting Content opens the first root page the user can see, selected in the tree.
- [x] The back button from there leaves Content rather than bouncing back.
- [x] Content with no page to open shows a fallback, with New content if the user may create.
- [x] A user with no Content section never sees the Overview or an error for it.
- [x] The empty site's guide (story 236) is unchanged.
- [x] Covering browser tests; `docs/backoffice-hosting.md` and the release notes say what
      changed.

## Plan

1. **The fork,** on `umbraco/crombolo`, as `Crombolo:` commits:
   - `backoffice-main.element.ts`: a `home` route for users with Content, from a new
     `homeView` extension type read as `sectionLayout` is, and `''` redirecting there.
   - `backoffice-header-logo.element.ts`: a link to the root, which lands in the right place
     for anyone. The popover and its sysinfo button go.
   - `sysinfo.element.ts`: the gathering moves to something the Overview can call, or the
     element is split from its modal.
   - `bun run fork:pin` and `bun run vendor:backoffice`, and the branch pushed with the release.
2. **The plugin:**
   - `overview-dashboard.js` is registered as the `homeView`, with a system information box.
   - New `content-home-dashboard.js`, overwriting the news: reads the document tree's root,
     then replaces the address with the page's workspace, or shows the fallback.
   - The New content choice is shared by both.
3. **Docs:** `docs/backoffice-hosting.md`, the README's account of signing in if it has one,
   and the release notes.

### Tests

- `tests/browser/overview.browser.ts`: landing, the logo, system information, no active tab,
  a user with no Content, and the sign-in test from the bug below.
- New `tests/browser/content-home.browser.ts`: Home selected, back button, an empty site, and
  a user whose start node is one branch.
- The six files that go through Content, updated where they read the dashboard.

### Risks

- **The client has no view outside a section,** so anything that assumes one, such as the
  context for a sidebar or a section's breadcrumbs, may need care in the fork.
- **Merging Umbraco 19 (277)** carries two more fork commits on files it may change.
- **Content's redirect** runs on every open, so a slow tree shows the section empty for a
  moment first.

## Implementation (2026-11-07)

- The fork's `homeView` route is at `home`, ahead of the sections. `SPA_ROUTES` gained it, or a
  reload there answers 404.
- System information is a box on Home with the version and mode, and All details opens the
  client's dialog, so the troubleshooting details are one click away rather than on the page
  everyone lands on.
- Content's `content-home-dashboard.js` skips pages marked `noAccess`, which the tree shows
  above a user's start node, and looks inside them.
- Home loads through `getLatestToken`, waits out a 401 for the sign-in dialog, and reloads when
  `isAuthorized` comes back. The browser test fails without this.
- Settings' landing page has a trail, and every trail starts at Home. Crumbs are keyed on the
  trail's length, as UUI marks the last crumb and never unmarks it.
- Also shipped here: the e-mail notice expands, the header's theme button became
  `theme-sync.js` so a profile's choice follows the person, Forms opens on its list, and Types
  for code moved to Developers.
- About 20 other plugin screens call `fetch` as Home did, and were left.

## Out of scope

- Changing what the overview lists.
- A setting for which page is Home.
