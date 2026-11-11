# 322 — Settings is one grant again

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 296

## Story

As the maintainer, I want Structure, Code and Workflow set-up to follow the Settings
section again, rather than being three grants a group can hold on their own, so that
there is one lower-level gate in the back office and one fewer change in the fork to carry
through each Umbraco upgrade.

## Context

Story 296 made `structure`, `components` and `workflowSetup` sections a group can hold
without the rest of Settings. The one thing that bought is a site-builder role that is not
an administrator: someone who edits content types and components but cannot reach users,
extensions or sign-in providers. The role is rare, and holding it needed the client to be
told more than the user holds (`clientSections`, `Crombolo.Section.AllSettings`) and a fork
commit that opens `section/settings` for a partial holder, which the story called its
riskiest part.

The extension security model (stories 323 to 331) gates installing on Settings access and
on being an administrator. With the three grants gone those are the only two levels to
explain.

## Decisions (2026-11-11)

- **The three grants go** (the maintainer's choice). Structure and Code need Settings, as
  they did before 296. Workflow set-up needs Settings too, not an administrator as before
  296, so it sits with the rest of what a site builder does.
- **Forms stays.** `forms` predates 296, and editors read submissions through it.
- **No migration.** A stored `structure`, `components` or `workflowSetup` alias has no
  section to render, so `toSectionAliases` drops it, and a group's next save writes the
  list without it. A group file that names one loads, with the alias dropped, as
  `packages` does from story 238.
- **The fork keeps its no-tab list for now.** `backoffice-header-sections.element.ts` still
  names the three aliases beside Forms and Approvals; nothing sends them, so the entries
  are inert. They come out on the next Umbraco rebase, which rebuilds the client anyway.
- **The menu under Content stays** (story 289). Structure and Code show for Settings,
  Structure for Forms alone, and the row is unchanged for everyone who holds Settings.

## Acceptance criteria

- [x] Opening, creating and changing content types, data types, media and member types,
      languages, blueprints, templates, components, stylesheets and scripts needs the
      Settings section, through the API and the trees.
- [x] Setting up workflows needs Settings, and Approvals is unchanged.
- [x] The group editor's Sections picker no longer offers Structure, Components or Workflow
      set-up, and its help text says what Settings changes.
- [x] A group file naming one of the three loads, without it.
- [x] The current-user API tells the client exactly the sections held.
- [x] The menu under Content offers Structure and Code to Settings, Structure to Forms, and
      nothing to Pages alone.
- [x] Covering tests; `docs/backoffice-hosting.md`, story 296 and the release notes say what
      changed.

## What was built (2026-11-11)

- **Core:** `structure`, `components` and `workflowSetup` leave `SECTION_ALIASES` and
  `SECTION_NAMES`; `clientSections` and `ALL_SETTINGS` go. `RETIRED_SECTIONS` names them
  with `packages`, and the group file loader drops any of them (`packages/schema/src/user-groups.ts`).
- **Server:** `authorization.ts` asks for `settings` where it asked for a part of it, with the
  component areas folded into `SETTINGS_AREAS`; workflows set-up
  (`approvals-api.ts`) and making a component a template (`component-templates-api.ts`) need
  Settings; the current-user port sends `principal.allowedSections` as they are.
- **Plugin:** the menu under Content reads Settings; `settings-section.js` no longer redirects
  a partial holder to a tree or hides the cards; the template picker and the Settings header
  app ask for Settings; the Workflows menu item and the Forms section's Workflows view ask for
  Settings; the three section manifests are gone; the group editor's help text names Settings.
- **Fork:** untouched. `backoffice-header-sections.element.ts` still lists the three aliases
  among the sections with no tab; nothing sends them. They come out on the next Umbraco rebase.
- **Tests:** `tests/section-grants.test.ts` rewritten; `content-strip`, `authorization`,
  `dashboard` and `api-handlers` updated; the browser test for a group given Structure alone
  removed from `content-menu.browser.ts`. The browser suite was not run locally; CI runs it on
  release.
- **Docs:** `backoffice-hosting.md`, story 296's supersession note, the release notes.
