# 289 — A second-level menu under Content

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 288

## Story

As someone building a site, I want content types, components, forms and workflows beside the
pages they shape, with folders to organise them, so that I can find them without going
through Settings, and can get from a page straight to what defines it.

## Context

Content types, data types and languages are behind the Structure card in Settings, and
components, stylesheets and scripts behind the Code card. Forms has its own header section
with a table of forms and an Entries view, and workflows are a Settings card. None of them
is near the pages they apply to, and none can be organised.

## Decisions (2026-11-07)

- **A strip at the top of Content's sidebar** (the maintainer's choice): Pages, Structure,
  Components, Forms, Workflows. Each swaps the tree beside the editor. It uses a
  `sectionLayout`, as Settings does, and no one gets a new section.
- **Links from a page** (the maintainer's choice): Edit content type and Edit template, in a
  page's Info view and in the tree's actions, for whoever may open them.
- **Settings loses its Build group** (the maintainer's choice). Structure, Code and Workflows
  go, along with anything in Settings for Forms, and all are reached from the strip. Types for
  code stays in Settings, moved to Developers. There are no links left behind, though old
  addresses redirect, as `section/packages` does.
- **The Forms section goes.** `section/forms` addresses redirect to the new place.
- **Forms and workflows become trees,** with folders to organise them.
- **Approvals stays a section.** It is where people decide, not where workflows are set up.

- **Moved after trying it (the maintainer's choice):** the strip was truncated in the sidebar,
  so it is a row of its own under the header, not at the top of Content's sidebar.

## Findings (2026-11-07)

- **Forms and workflows are files,** in `schema/forms/` and alongside it, found by `key` or
  alias, not by path. Library folders are database rows, so they are no pattern to copy.
- **The strip must follow access.** Today Structure and Code need Settings, and Editors have
  `forms` but not Settings. So each item shows for those who hold what it needs, and someone
  with only Pages sees no strip.
- **`forms` stays as a section grant** with no section behind it, so existing groups keep
  their access and no migration is needed. The group editor would need to keep offering it.
- **The read-only rule applies to folders too.** On a node that cannot write `schema/`, a new
  folder cannot be saved either, which should be clear before anyone tries.
- **A folder in a bundle:** `schema/forms/` subfolders have to travel, and `parseForm` and the
  schema loader have to read them.

## Acceptance criteria

- [x] A row under the header has the strip, with Pages first, showing only what the user may open.
- [x] Structure, Components, Forms and Workflows each open in the tree beside the editor.
- [x] A page offers Edit content type and Edit template, to those who may open them.
- [x] Settings has no Build group, and no cards for Structure, Code, Workflows or Forms. Their
      old addresses still open the screens, and `GROUPS` loses `Build`.
- [x] Forms and workflows list in a tree, and can be created, renamed and moved into folders.
- [x] The Forms section is gone, and its old addresses still open the screens.
- [x] A form picker, bundles, `push` and `pull` carry on working with forms in folders.
- [x] The Forms root node lists every form's submissions, and each form has an Entries tab.
- [x] Any feature disabled by server state says so in its view, in plain words, with why, and
      offers no action that cannot work.
- [x] Covering tests; `docs/backoffice-hosting.md`, `docs/forms.md` and the release notes say
      what changed.

## Plan

### Decisions made in planning (2026-11-07)

- **One story** (the maintainer's choice), not split.
- **A folder is a real subfolder** under `schema/forms/` or `schema/workflows/` (the
  maintainer's choice). An alias stays unique across folders.
- **Entries appear in two places** (the maintainer's choice): a Forms root node in the tree
  lists every form's submissions, and each form has an Entries tab of its own.
- **A feature that server state turns off says so where it is** (the maintainer's choice).
  Every view it touches states what is off and why, in plain words, before anyone tries.

### Findings in planning

- **`tomlFiles` in `packages/schema/src/load.ts` is flat,** so a form in a subfolder would be
  ignored without any error. It has to walk folders.
- **The path of a saved file comes from its alias** (`form-files.ts`, `formFileName`), so saving
  a form in a folder would leave it there and write a second copy at the top.
- **The plugin has no tree of its own yet.** Forms and workflows are the first, so they need
  tree endpoints, repositories, workspaces and folder actions.
- **`editable` for workflows is `writable && isAdmin`,** with one message for both, which is
  untrue for a non-admin on a writable site.

### Changed in building (2026-11-07)

- **Nothing moved section.** The client hard-codes `section/settings/...` for types and
  templates, so moving those trees would break links throughout it. The same menu shows in
  Content, in Settings beside a tree, and in Forms, and asks the header to keep Content's tab
  marked. On screen it is what was planned, and old addresses need no redirects.
- **The Forms section stays, with no tab.** The fork hides it from the header for anyone who has
  Content, and Workflows moved into it as a view. `section/forms` addresses keep working.
- **The tree is one small element,** `definition-tree.js`, not Umbraco's tree framework, which
  would be a repository, data source and workspace per kind for two short lists.
- **Umbraco's Info view already shows a page's type and template,** so page links needed only
  the two tree actions.
- A page with no template has nothing to open, so Edit template does nothing there.

### The work

1. **Reading and writing folders.** `tomlFiles` walks subfolders. `form-files.ts` and its
   workflow counterpart find a file by alias and write it where it lives. Moves and folder
   create, rename and delete go in the same module, refusing a non-empty delete. Bundles,
   `locate.ts`, `export.ts` and `push` and `pull` carry the relative path.
2. **Server.** Tree routes for forms and workflows under `crombolo/api`, returning folders and
   items, with the existing section checks. A `canWrite` answer with a reason that separates
   a read-only site from a user who may not.
3. **The strip.** A `sectionLayout` for Content, on the pieces Settings uses, keeping its trees
   mounted and hidden. Each item shows by access, and one item alone shows no strip.
4. **Structure and Components.** Settings' two trees move to the layout. Their addresses,
   `section/settings/structure` and `code`, redirect, and `moved-sections.ts` gains them.
5. **Forms and Workflows trees.** Repository, data source and folder actions for each, with
   `forms-overview.js`'s designer and `workflow-designer.js` becoming workspaces.
6. **Entries.** `forms-entries.js` serves the Forms root node, for all forms, and an Entries tab
   on a form's workspace, for one.
7. **Remove.** The Forms section and its views go, and `section/forms` addresses redirect. `forms`
   stays a group grant. `GROUPS` loses `Build`, and the Workflows, Structure and Code cards go.
8. **Page links.** A workspace info app and tree actions for Edit content type and Edit template,
   shown to those who may open them.
9. **Saying what is off.** A shared notice, used by forms, workflows, folders and the type
   editors, in place of today's save-time refusal and the two wordings. No "schema", "node" or
   "store" in what an editor reads. Save, New and New folder are absent when they cannot work.
   A sweep of other views for the same state: the e-mail notice, Approvals and Bundles installs.
10. **Docs.** `docs/backoffice-hosting.md`, `docs/forms.md`, `docs/workflows.md`,
    `docs/schema-as-code.md`, and the release notes.

### Tests

- Unit: subfolder loading, saving in place, moves, a clashing alias across folders, a non-empty
  folder delete, and bundles round-tripping folders.
- Server: tree routes by access, and the two reasons for read-only.
- Browser: the strip for an admin, an Editor and a Writer; each tree; page links; Entries in both
  places; old addresses; and a read-only site showing its notice with no way to save.

### Risks

- **Size.** This is several stories' worth, and the first custom trees will take longest.
- **Layout on Content.** Content is the most used section, and Settings' layout replaced a much
  simpler screen. Redirects to Home (288), tree selection and the sidebar's width all meet here.
- **Fork merges.** Most of this stays in the plugin, but moved addresses touch `moved-sections.ts`.
- **A file moved by hand** into a folder is fine, but two forms with one alias in different
  folders stop the site loading, so the error must name both files.

## Implementation (2026-11-07)

- `content-strip.js` and `content-strip-items.js`: the menu, and which item a page belongs to.
- `definition-tree.js` and `definition-tree-model.js`: the tree, and `readOnlyWords`, the one
  wording for what is off. `definition-folders.ts` holds the folder changes, and the schema
  loader walks subfolders for forms and workflows only.
- `document-links.js`: the two tree actions.
- Three fork commits in all with 288: `homeView` and the logo, the header's Forms tab and marked
  section, and `noTab`.
- Bundles carry folders as they are, since `wholeSchema` already walks the directory.
- Other views were checked for server state. Page addresses, Bundles installs, the Changes
  dashboard and the header's banner already say so, and the e-mail notice does. Structure did
  not: its editors refused only on saving, so it now says so beside its tree, from a new
  `site-files` route. Webhooks offer only where they can be kept, and say why.

## Out of scope

- Granular permissions for Settings, which are on hold.
