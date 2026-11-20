# 385 — Every place under Content has its own permission and address

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** XL
**Depends on:** 289, 322

## Story

As an administrator, I want each place under Content (Pages, Media, Approvals, Structure,
Code and Forms) to be a permission of its own and to live at an address under Content, so
that I give each group exactly the places it works in, and everything a site is made of is
in one place.

## Context

Types, components, forms and workflows moved under Content as a row of places (`289`), but
Structure and Code still live in Settings and follow the Settings grant (`322`), Media is a
header section of its own, and Approvals and Forms are sections with no tab. Story `385`
began as Media alone; the maintainer widened it to every place (2026-11-20), which brings
back per-group grants for Structure and Code that `322` withdrew, now without letting a
partial holder into Settings: each place is a section of its own, under Content's address.

## Decisions (2026-11-20, the maintainer's)

- **Every place is a grant of its own,** shown under Content: Pages (`pages`, new), Media
  (`media`), Approvals (`workflow`), Structure (`structure`), Code (`components`) and
  Forms (`forms`). `structure` and `components` leave `RETIRED_SECTIONS`; `workflowSetup`
  stays retired, as workflows are set up in Structure.
- **Settings no longer gives Structure or Code.** Settings keeps redirects, logs, health,
  extensions and the rest of its tools.
- **Pages is a grant,** apart from the page permission levels: without it a group has no
  Pages place, and browsing and editing pages is refused; picking a page elsewhere is not.
- **Every place needs Content,** refused everywhere: the Management API's group save,
  `crombolo users groups new|update`, group files (a problem `types check` reports) and
  bundles.
- **Each place has an address under Content:** `section/content` (Pages),
  `section/content/media`, `section/content/approvals`, `section/content/structure`,
  `section/content/code` and `section/content/forms`. Old addresses redirect, the item
  kept. The header has no Media tab.
- **Existing groups are migrated** (migration 083): a group holding Content gains Pages; a
  group holding Settings gains Structure and Code; a group holding a place without Content
  gains Content, with Pages off. A group kept in `schema/user-groups/*.toml` is not in the
  database: on the next deploy it has only what its file names, which the upgrade notes
  say, with the lines to add.

## Spike: a place at an address under Content (2026-11-20)

A section can live at an address under Content's. The fork commit is on the
`spike/nested-sections` branch (`a290eaeb`), and it held in the browser: Media's tree
and listing at `section/content/media`, an item's editor at
`section/content/media/workspace/media/edit/<key>`, `section/media/...` redirected
there, and Content unchanged. It took:

- **the section's pathname** set to `content/media`: its manifest and
  `UMB_MEDIA_SECTION_PATHNAME`, from which its paths are built (the path pattern does
  not encode a slash in it);
- **the two places that wrote `section/media` by hand**, the create dialog and search,
  using the constant;
- **the sections' routes matched longest first** in `backoffice-main.element.ts`, as the
  router matches by prefix and `section/content` would otherwise take
  `section/content/media/...`;
- **the old address** as a moved section in `moved-sections.ts`, as `section/packages` is.

Structure and Code are trees in Settings rather than sections, so each becomes a section
of its own at `content/structure` and `content/code`, and the editors of its types,
templates and files take that pathname where they take `UMB_SETTINGS_SECTION_PATHNAME`
today: 55 uses in 26 files, the same change as Media's done many times over.

## The design

1. **Fork,** one commit after the spike's pattern: Media's pathname `content/media`;
   section routes matched longest first; old addresses redirected in `moved-sections.ts`;
   Media on the no-tab list, beside the Structure and Components entries `322` left inert;
   constants for the Structure and Code pathnames, taken by the editors of content, media
   and member types, data types, blueprints, templates, partial views, stylesheets and
   scripts where they take `UMB_SETTINGS_SECTION_PATHNAME` today.
2. **Core:** `pages`, `structure` and `components` in `SECTION_ALIASES`; a rule for which
   places need Content, used by every save path.
3. **Server:** `authorization.ts` asks for Structure for types, data types and blueprints,
   Code for templates, partial views, scripts and stylesheets, and Pages for the content
   tree and page editing; the server's other Settings checks (22) each sorted into
   Structure, Code or Settings, such as workflow set-up (Structure) and component templates
   (Code).
4. **Plugin:** Structure and Code as sections of their own, their sidebars carrying the
   trees `settings-section.js` draws today, Forms and Workflows still nodes in Structure;
   Approvals and Forms' views at their new pathnames; the row's items and `activeItem` by
   the new grants and addresses; the template picker and the Settings header app by them.
5. **Group editor (`338`):** Content lists its places as switches, with the warning that
   Structure and Code change the whole site; a group stored with a place and without
   Content loads and is flagged.
6. **Migration 083** as decided, release `0.70.0`, undone in the test rewinds.
7. **The demo sites' groups** (the maintainer's choice, 2026-11-20): `plain-signal`'s
   group files (Editors, Sub-editors, Writers) gain `pages` in the same change as the
   core alias, since a file naming a section the loader does not know fails to load.
   None of them holds Settings, so none gains Structure or Code; the other demo sites
   keep their groups in the database, which the migration covers.

## Acceptance criteria

- [x] **Each place is a grant,** offered under Content in the group editor, and the row
      shows exactly the places a person holds.
- [x] **Each place opens at its address under Content,** and its old address redirects with
      the item kept; the header has no Media tab.
- [x] **Settings alone** opens none of Structure or Code; **Structure or Code alone** opens
      that place and nothing else of Settings, by address and through the API.
- [x] **Content without Pages** has no Pages place, and browsing and editing pages is
      refused; picking a page elsewhere still works.
- [x] **A place without Content** is refused by the API, the command line, group files and
      bundles, saying why; one stored that way before loads and is flagged.
- [x] **The migration** keeps what every stored group can open, on both dialects.
- [x] **Start folders, verbs and folder access** in Media behave as before; the media picker
      is unchanged.
- [x] **Browser tests** reach each place through the row; `docs/` and the notes on diverging
      from Umbraco say where each place is and what it needs; the upgrade notes give the lines
      a group file needs.

## Built

- **Fork** (two commits): Media's pathname `content/media`; `UMB_STRUCTURE_SECTION_PATHNAME`
  and `UMB_CODE_SECTION_PATHNAME`, taken by the editors of content, media and member types,
  data types, blueprints, languages, templates, partial views, stylesheets and scripts (20
  path files, 14 hand-written addresses); section routes matched longest first; `section/media`,
  `section/forms` and `section/workflow` redirected in `moved-sections.ts`; every place off the
  header's tabs; Content's page tree conditioned on `Crombolo.Section.Pages`. And Umbraco's race
  this exposed: a tree item whose tree went away before it opened no longer throws that its
  tree context is not set.
- **Core:** `pages`, `structure` and `components` in `SECTION_ALIASES` (the last two out of
  `RETIRED_SECTIONS`), `CONTENT_PLACES`, `placesRefusal`, their words in `SECTION_NAMES`.
- **Server:** `authorization.ts` asks for Structure, Code and Pages; workflow set-up, component
  templates and schema import ask for Structure; `PlacesNeedContent` from the group save.
- **Schema:** a group file with a place and without Content is a problem, which the command
  line's group commands and bundles meet too; those commands no longer name the group's file
  in a refusal (`commitDefinitionEditUnnamed`).
- **Migration 083 `AddContentPlaces`:** one insert-select per grant; the seeded groups carry the
  places; undone in the five rewinds.
- **Plugin:** Structure and Code sections with their sidebars on Umbraco's menus, drawn by the
  Settings layout in a mode of their own; Settings sends their old addresses there; Forms and
  Approvals at `content/forms` and `content/approvals`; the row and `activeItem` by grant and
  address; the template picker, page links and the Edit content type/template actions by the
  new grants; the group editor lists the places under Content and flags one without it.
- **Demo:** `plain-signal`'s three group files hold `pages`.
- **Tests:** `section-grants`, `content-strip`, `authorization`, `content-places` (083, both
  dialects), `permission-levels` (the group editor's places), `site-definitions-edit` (the
  command line's refusal), and the browser specs moved to the new addresses, with the menu
  spec reaching Media and checking the old addresses and the tab-less header. The affected
  browser specs were run locally: all pass; `forms.browser.ts`'s picker test is timing-
  sensitive under parallel load and passes alone.
- **Docs:** `backoffice-hosting.md`, `roadmap.md` (divergences), `schema-as-code.md`, release
  notes with the group-file upgrade step, story 322's note.
