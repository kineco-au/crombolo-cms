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

- **Set per user group, in Users.** Pages is always on, with a choice for each of the others.
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

## Findings (2026-11-07)

- **Showing is the larger part.** Structure and Components need Settings, and the client
  hard-codes `section/settings/...` for them, so a group needs just enough of that section for
  those screens without the rest of Settings.
- **Forms changes for existing sites.** Editors hold `forms` today, for reading submissions, so
  a default of Pages alone would take that away on upgrade.
- **Groups can live in `schema/user-groups/*.toml`** (story 228), so the choice belongs there as
  well as in the group editor.

## Acceptance criteria

- [ ] A group editor offers Structure, Components, Forms and Workflows, in plain words.
- [ ] Forms is a node in Structure's tree, with its folders, forms and entries, and not in the row.
- [ ] Old Forms addresses still open, with Structure marked in the row.
- [ ] Someone with Forms alone sees Structure in the row, holding only that node.
- [ ] A new group has only Pages.
- [ ] The row under the header shows exactly what the group was given, and no row for Pages alone.
- [ ] A screen a group wasn't given answers with no access, by address and through the API.
- [ ] A screen a group was given works fully, with no other part of Settings opened to it.
- [ ] Someone in several groups gets everything those groups give.
- [ ] Administrators always have all of them.
- [ ] The choice is kept in `schema/user-groups/*.toml` for a group held there, and read-only sites
      say so, as they do for the rest of a group.
- [ ] Bundles carry it with the group.
- [ ] An upgrade keeps what each existing group can open, and the release notes say how to narrow it.
- [ ] Covering tests, including a browser test as an Editor given Structure alone.

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
6. **Forms in Structure:** a Forms node in Structure's tree, using the definition tree's folders,
   and `stripItems` and `activeItem` lose Forms. `activeItem` marks Structure for `section/forms`
   except Workflows. Workflows and Forms share a section, so Workflows keeps its own row item.
   Check first how a tree in Settings' menu can open screens in the Forms section: this is a
   move across sections, which 289 avoided, and it needs its own look before building.
7. **The group editor:** a "Content menu" group of choices in plain words, with Pages always on and
   a warning on Structure, Components and Workflows that they change the whole site.
8. **Tests:** a table of each grant against the API; a group file round trip; the row for each mix;
   a browser test as an Editor given Structure alone, who can use it, and can't open Users or
   the rest of Settings; and one given Forms alone, who sees only that node.
9. **Docs:** `docs/backoffice-hosting.md`, `docs/schema-as-code.md`, `docs/forms.md`, release notes.

No migration: a group's sections are already a list, and no existing group changes.

## Open decisions

- **Forms on an existing site:** proposed: keep what groups have now, and the new default applies to
  new groups and new sites only. With this plan that needs no code: an existing group keeps
  `forms`, and a new group simply doesn't have it.
- **Read or change:** proposed: one on/off, with a warning in the group editor, and view-only later
  if it's wanted.
