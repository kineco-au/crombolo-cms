# 296 — Admins choose what a group sees under Content

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As an administrator, I want to choose which of Structure, Components, Forms and Workflows each
user group can open, so that editors see only Pages by default, and get more when I decide.

## Context

The row under the header offers each item by what a user already holds: Structure and Components
need the Settings section, Forms needs `forms`, and Workflows needs an administrator. So what
Editors see is a side effect of other permissions, and it can't be changed one item at a time.
This replaces the idea of making Settings' permissions granular, which was on hold and was never
written up: these are the screens that idea was for.

## Decisions (2026-11-07)

- **Set per user group, in Users,** among its Sections, as Forms already was. Pages is Content.
  Administrators always see everything.
- **By default a group has only Pages.**
- **Each choice is a real permission, enforced on the server,** and the row follows it. Hiding an
  item alone would leave its address working, and showing one needs access the group doesn't have.

- **Forms rolls up into Structure** (the maintainer's choice), as a tree node like Content Types
  and Data Types, and leaves the row under the header, which becomes Pages, Structure, Components
  and Workflows. Its folders and forms sit under that node, and the node itself still lists every
  form's entries.
- **Forms stays its own choice for a group.** Someone given Forms alone sees Structure in the row
  with only the Forms node in it, so Editors keep their submissions without seeing content types.

- **Existing sites keep what they have** (the maintainer's choice). Groups keep `forms`, and the
  default of Pages alone applies to new groups and new sites. This needs no code.
- **One on/off for each item** (the maintainer's choice), with a warning in the group editor, as
  Structure, Components and Workflows change the whole site. View-only can come later.

## Findings (2026-11-07)

- **Showing is the larger part.** Structure and Components need Settings, and the client
  hard-codes `section/settings/...` for them, so a group needs just enough of that section for
  those screens without the rest of Settings.
- **Forms changes for existing sites.** Editors hold `forms` today, for reading submissions, so
  a default of Pages alone would take that away on upgrade.
- **Groups can live in `schema/user-groups/*.toml`** (story 228), so the choice belongs there as
  well as in the group editor.

## Acceptance criteria

- [x] A group editor offers Structure, Components, Forms and Workflows, in plain words.
- [x] Forms is a node in Structure's tree, with its folders, forms and entries, and not in the row.
- [x] Old Forms addresses still open, with Structure marked in the row.
- [x] Someone with Forms alone sees Structure in the row, holding only that node.
- [x] A new group has only Pages.
- [x] The row under the header shows exactly what the group was given, and no row for Pages alone.
- [x] A screen a group wasn't given answers with no access, by address and through the API.
- [x] A screen a group was given works fully, with no other part of Settings opened to it.
- [x] Someone in several groups gets everything those groups give.
- [x] Administrators always have all of them.
- [x] The choice is kept in `schema/user-groups/*.toml` for a group held there, and read-only sites
      say so, as they do for the rest of a group.
- [x] Bundles carry it with the group.
- [x] An upgrade keeps what each existing group can open, and the release notes say how to narrow it.
- [x] Covering tests, including a browser test as an Editor given Structure alone.

## Findings for the plan (2026-11-07)

- **`forms` shows the way.** It is a section grant with no header tab, so a group already holds it
  in `sections`, in the database and in `schema/user-groups/*.toml`. Structure, Components and
  Workflows can work the same way, with no new concept, column or file format.
- **The API is gated by tables of sections** in `api-management/src/authorization.ts`, such as
  `'document-type': SETTINGS`, which take any-of lists. `['settings', 'structure']` is a small
  change there, and whoever holds Settings keeps what they have.
- **Workflows check `principal.isAdmin`** in `approvals-api.ts`, not a section.
- **The client gates `section/settings` by `SectionUserPermission`,** so a group with Structure
  alone can't reach those screens until the fork lets it. This is the riskiest part.
- **`settings-section.js` draws both trees and the cards,** so it has to show only what a group
  holds, and the header's Settings tab must stay hidden from it.

## What was built (2026-11-07)

- **`structure`, `components` and `workflowSetup` are sections** a group holds, in the database and
  in `schema/user-groups/*.toml`, with no header tab.
- **The server's tables accept them** beside `settings`, in `authorization.ts`, and workflows go by
  `workflowSetup` or being an administrator.
- **`clientSections`** tells the client a little more than is held, so that Settings' screens open:
  Settings for a part of it, and `Crombolo.Section.AllSettings` for the whole. The gear and the
  cards ask for that. It can only widen what the client draws, never what the server allows.
- **The choices are in the group's Sections picker,** not a separate "Content menu" group, as that
  picker already offers Forms, and its help text carries the warning.
- **A note on a group with Pages alone:** it holds Content, so a new group needs that ticked.

## Plan

1. **Core:** `structure`, `components` and `workflows` join the section aliases, with `sectionKey`,
   `toSectionAliases` and the group file's checks.
2. **Server:** the tables accept them beside `settings`: content, media and member types, data
   types and languages for Structure; templates, components, stylesheets and scripts for
   Components. The plugin's schema and definition-folder routes follow, and workflows move from
   `isAdmin` to the grant. Anything else in Settings stays Settings.
3. **Fork:** `section/settings` opens for someone holding one of them, with the header's Settings
   tab shown only for `settings` itself.
4. **Plugin, the row:** `stripItems` reads the new grants, with `settings` counting for Structure and
   Components, and administrators getting everything.
5. **Plugin, Settings:** someone without `settings` gets only their tree, never the cards, and an
   address they can't open says so.
6. **Forms in Structure:** built on 2026-11-07. A group given Forms alone already sees Structure
   leading to the Forms section, so this story only needs it to follow the grant.
7. **The group editor:** a "Content menu" group of choices in plain words, with Pages always on and
   a warning on Structure, Components and Workflows that they change the whole site.
8. **Tests:** a table of each grant against the API; a group file round trip; the row for each mix;
   a browser test as an Editor given Structure alone, who can use it, and can't open Users or
   the rest of Settings; and one given Forms alone, who sees only that node.
9. **Docs:** `docs/backoffice-hosting.md`, `docs/schema-as-code.md`, `docs/forms.md`, release notes.

No migration: a group's sections are already a list, and no existing group changes.

## Superseded (2026-11-11)

Story 322 removed the three grants: Structure, Code and Workflow set-up follow the Settings
section again. The role they served, a site builder who is not an administrator, proved rare,
and holding it needed the client to be told more than the user holds and a fork commit that
opens Settings for a partial holder. Forms stays as it was before this story.
