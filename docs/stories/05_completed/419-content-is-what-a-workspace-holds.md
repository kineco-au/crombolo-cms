# 419 — Content is what a workspace holds

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 385, 392

## Story

As someone working in a workspace, I want the menu to show me what the workspace
covers, so that I can tell which of my changes wait in it and which go straight to
the site.

## Context

Raised by the maintainer on 2026-11-24.

A workspace holds the pages, media, Library items, languages and dictionary (`392`),
types, data types, form and workflow definitions (Structure) and code files that are
changed in it. The same set is what a change carries, and what a locked site
(`CROMBOLO_CONTENT=locked`, `388`) refuses. The menu draws a different set:

- **The Content strip** (`289`, `385`; `content-strip.js`) holds Pages, Media,
  Approvals, Structure and Code, with the workspace switch at its head
  (`workspace-switch.js`).
- **Library and Translation** are tabs of their own in the header, with grants that
  need nothing else (`library`, `translation`), though a workspace holds them.
- **Languages** are opened from Structure, though they belong with the dictionary.
- **Approvals** is in the strip, though it is not in a workspace: a request is made
  against Shared.

So the menu cannot answer "what does this workspace hold?", and Approvals in the strip
suggests a request waits in the workspace when it does not.

## The design

- **The header:** Content, Approvals, Members, then Users and Settings as today.
- **The Content strip:** the workspace switch, then Pages, Media, Library, Translation,
  Structure and Code, editing first and building after. Each is shown to whoever
  holds it, as today.
- **The strip is exactly a workspace's scope.** While a workspace is open, the strip
  takes its colour (the switch's `colourOf`). Outside the strip, nothing shows a
  workspace, so leaving it visibly leaves the workspace.
- **Library and Translation are places under Content,** at `section/content/library`
  and `section/content/translation`, each needing Content as well, as every place does
  (`placesRefusal`, `packages/core/src/sections.ts`).
- **Languages are under Translation,** with the dictionary, opened and changed by the
  Translation grant; Structure no longer opens them.
- **Approvals is a tab of its own** at `section/approvals`, its grant (`workflow`) no
  longer needing Content.
- **Old addresses redirect:** `section/library`, `section/translation`,
  `section/content/approvals` and a language's address under Structure, as `385`'s
  moved sections do (`moved-sections.ts`, Settings' layout).
- **A group keeps what it could do** (a migration):
  - one holding Library or Translation without Content is given Content, which opens
    nothing by itself;
  - one holding Structure without Translation is given Translation, so it can still
    change languages (it gains the dictionary too).
- **The words in the back office** say where each thing is: the group editor's list of
  places, the overview's cards, and the guide's pages that name a menu.

## Decisions (2026-11-24, the maintainer's)

1. **Library and Translation follow every place's rule:** they need Content, and a
   migration gives Content to each group that holds either without it.
2. **Languages move to Translation,** changed by its grant; a migration gives
   Translation to each group that holds Structure without it.
3. **The strip's order:** the switch, then Pages, Media, Library, Translation,
   Structure, Code.
4. **The strip takes the workspace's colour** while one is open.
5. **Approvals is a top-level tab.**
6. **Written as a story, not a proposal:** the maintainer accepted it directly.

## Build plan (2026-11-24)

Found by reading the code; nothing in it needs a decision of its own.

- **Places** (`packages/core/src/sections.ts`): `CONTENT_PLACES` gains `library` and
  `translation` and loses `workflow`; `PLACE_NAMES` follows. `placesRefusal` and every
  caller of it (the group save, the command line's group commands, group files) take
  the new list unchanged.
- **The migration:** each stored group with `library` or `translation` and no
  `content` gains `content`; each with `structure` and no `translation` gains
  `translation`. Its undo in every test rewind (the five named in the maintainer's
  notes), and `upgrade-from-release`'s expected list.
- **Languages** (`api-management/src/authorization.ts`): a language write needs
  `translation`, where it needed `structure`. The Languages menu item leaves Umbraco's
  structure settings menu (`Umb.Menu.StructureSettings`) for Translation's sidebar menu;
  the Structure tree's words stop naming languages (`settings-section.js`).
- **Addresses, in the fork** (`vendor/umbraco-client`, a `Crombolo: …` commit each, as
  Media's `content/media` was): Library's pathname `content/library`
  (`packages/library`), Translation's `content/translation`
  (`packages/translation/section/manifests.ts`); `moved-sections.ts` forwards
  `section/library`, `section/translation` and `section/content/approvals`, with its test.
  Then `bun run vendor:backoffice`.
- **Approvals** (the plugin's `Crombolo.Section.Workflow`): pathname `approvals`, a
  header tab, no longer `meta.noTab`.
- **The strip** (`content-strip.js`): Pages, Media, Library, Translation, Structure,
  Code, after the switch; Approvals out. The strip takes the open workspace's colour
  (`workspace-switch.js`'s `colourOf`), and a section outside it shows no workspace.
- **Library and Translation lose their header tabs** (`meta.noTab`), as every place has.
- **Words:** the group editor's areas (`group-editor-words.js`: Library and Translation
  `under` Content, Approvals not), the overview's cards, and the guide's pages that name
  a menu (`sites/crombolo/content/...`, rebuilt with `build:template`).
- **Tests:** `sections` unit tests for the new places; the migration; the language
  write's grant; the fork's redirect test; browser tests for the strip and its colour,
  the header, and Library, Translation and Approvals at their addresses.

## Acceptance criteria

- [x] **The header** shows Content, Approvals, Members, Users and Settings, each to
      whoever holds it.
- [x] **The strip** shows the switch, then Pages, Media, Library, Translation, Structure
      and Code, each to whoever holds it, and nothing else.
- [x] **In a workspace,** the strip is in its colour, and no screen outside the strip
      shows a workspace.
- [x] **Library and Translation** open at their addresses under Content; their old
      addresses redirect there.
- [x] **Languages** are listed and changed under Translation, by the Translation grant,
      and no longer under Structure; their old address redirects.
- [x] **Approvals** opens at `section/approvals` for a group holding it without Content;
      `section/content/approvals` redirects.
- [x] **The migration** gives Content to a group with Library or Translation and not
      Content, and Translation to a group with Structure and not Translation; nobody
      loses anything they could open.
- [x] **Saving a group** with Library or Translation and not Content is refused, from the
      back office, the Management API, the command line and a group file, as for any
      place.
- [x] **The group editor, the overview and the guide** name each place where it now is.
- [x] **Tests:** unit tests for the grants, the migration and the redirects (both
      dialects); browser tests for the strip, its colour, the header and a moved address.
      `docs/backoffice-hosting.md`, `docs/workspaces.md`, the guide pages and the
      release notes updated.

## Implementation

- **Places** (`packages/core/src/sections.ts`): `CONTENT_PLACES` gains `library` and
  `translation` and loses `workflow`; `SECTION_NAMES` and the group editor's areas
  (`group-editor-words.js`) follow. Seeded Translators hold Content too.
- **Migration 098** (`AddWorkspacePlaces`, `schema/workspace-places.ts`): Content for each
  group holding Library or Translation without it, Translation for each holding Structure
  without it. Undone in each test rewind.
- **Languages:** a language write needs `translation` (`authorization.ts`); in the fork,
  Translation gains a Languages sidebar (`Umb.SidebarMenu.Translation.Languages`) and
  Structure's menu loses the item.
- **The fork** (one `Crombolo:` commit, pinned and rebuilt with `vendor:backoffice`):
  Library at `content/library`, Translation at `content/translation`; Library and
  Translation in `CROMBOLO_NO_TAB`, Approvals out of it; `moved-sections.ts` forwards
  `section/library`, `section/translation`, `section/workflow` and
  `section/content/approvals`, the last routed ahead of Content's.
- **Approvals** (`Crombolo.Section.Workflow`): pathname `approvals`, weight 950, so its tab
  follows Content's.
- **The strip** (`content-strip.js`, `content-strip-items.js`): the switch first, then Pages,
  Media, Library, Translation, Structure, Code; Approvals out; `stripTint` colours it in the
  open workspace's `colourOf`.
- **Found on the way:** the command line opened pages with the Content grant
  (`needSection`); it asks for Pages, as the back office has since `385`.
- Tests: `tests/section-grants.test.ts`, `tests/content-places.test.ts` (098),
  `tests/content-strip.test.ts`, `tests/authorization.test.ts`,
  `tests/permission-levels.test.ts`; the fork's `moved-sections.test.ts` (run with Bun, the
  fork's browser runner having no browser here); browser: `content-menu`,
  `workflow-section`, `library`, `workspaces`.
