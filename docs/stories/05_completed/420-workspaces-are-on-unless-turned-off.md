# 420 — Workspaces are on unless turned off

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 375, 380

## Story

As someone running a Crombolo site, I want workspaces to be there from the start, as
part of what the CMS is, so that my editors can work apart from what everyone sees
without my first finding and setting a switch; and I can still turn them off where a
site does not want them.

## Context

Raised by the maintainer on 2026-11-24, on finding the demo site shows no workspaces.

Workspaces (`375` onwards) are off unless `CROMBOLO_WORKSPACES=true`
(`packages/server/src/config.ts`, `settings.ts`). Off, every workspace route is refused
and the back office shows no switch. A locked site (`388`) turns them on for the
changes staged on it (`workspacesOn`). No demo site or template sets the switch, so
nobody trying Crombolo sees them, though workspaces, changes and their checks are now
much of what the CMS is for.

Twenty test files turn them on themselves; others rely on their being off.

## The design

- **`CROMBOLO_WORKSPACES` is `true` unless set:** `false` turns them off, as it does
  today; anything else than `true` or `false` stops the site starting with a sentence
  saying what it takes, as `CROMBOLO_CONTENT` and `CROMBOLO_CODE` do.
- **Off means what it means today:** every workspace route refused, no switch, nothing
  else changed. A locked site still turns them on.
- **`CROMBOLO_WORKSPACES_REQUIRED` is unchanged,** `false` unless set: editors still
  edit Shared directly unless the site asks otherwise.
- **The demo sites and templates** show workspaces with nothing set, and the guide
  introduces them as part of editing, not as a feature to turn on; a page says how to
  turn them off.
- **`crombolo status` and the overview** say whether workspaces are on.
- **The tests:** the harness has them on by default, as a site does; a test of a site
  without them turns them off by name.

## Decisions (2026-11-24, the maintainer's)

1. **The switch keeps its name,** `CROMBOLO_WORKSPACES`, now `true` unless set.
2. **A site upgraded from before gains workspaces;** the upgrade notes say to set
   `CROMBOLO_WORKSPACES=false` to keep them off.
3. **They are not required:** `CROMBOLO_WORKSPACES_REQUIRED` stays off unless set.
4. **"First class" here is the default, the demos and templates, the guide, and
   `crombolo status` and the overview;** where workspaces sit in the menu is `419`'s.
5. **The command line edits Shared unless a workspace is required** (decided while
   building). Story 386 sent a local change into the person's own workspace whenever
   workspaces were on, but only `content new` and `content update` worked there: every
   other content command looked in Shared. With workspaces on everywhere, that would have
   changed every site's command line on upgrade, so it follows the back office's rule.

## Acceptance criteria

- [x] **A site with nothing set** opens workspaces, and the back office shows the
      switch at the head of Content.
- [x] **`CROMBOLO_WORKSPACES=false`** refuses every workspace route and shows no
      switch, as today.
- [x] **A value other than `true` or `false`** stops the site starting, saying what it
      takes.
- [x] **A locked site** has them on, whatever the setting says.
- [x] **`CROMBOLO_WORKSPACES_REQUIRED`** is off unless set, as today.
- [x] **The demo sites and templates** show workspaces with nothing set.
- [x] **`crombolo status` and the overview** say whether workspaces are on.
- [x] **The tests** run with workspaces on unless a test turns them off.
- [x] **Tests** on both dialects; `docs/configuration.md` (regenerated),
      `docs/workspaces.md`, the guide pages and the release notes, with the upgrade
      note, updated.

## Implementation

- `workspacesSetting` (`packages/server/src/config.ts`): `true` unless set; `false` off;
  anything else stops the site starting. `settings.ts`'s default is `true`, and
  `docs/configuration.md` is regenerated from it.
- **The command line** (`support/pages.ts`): a local change goes into the person's own
  workspace only where workspaces are required (decision 5).
- **The request body limit** (`listeningBodyLimit`): raised for uploads only with remote
  access, so a default site keeps 32 MB on every route (decided while building: Bun's limit
  is every route's).
- **Status and the overview:** `crombolo status` prints `workspaces on`, `on, every edit in
  one` or `off`, and `siteStatus` answers `site.workspaces`; the overview's System
  information says the same (`workspacesSettingOf`).
- **The guide** (`from-the-command-line.md`, `deploying.md`) and `docs/workspaces.md` say
  workspaces are on from the start, and how to turn them off.
- **Tests:** `tests/workspaces-default.test.ts`; tests that meant someone without Content
  sign in as Sensitive data, the Translators now holding Content (`419`); the remote's
  discovery and `applyChanges` expect workspaces on.
