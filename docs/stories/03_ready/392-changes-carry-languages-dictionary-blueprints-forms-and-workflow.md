# 392 — Changes carry languages, the dictionary, blueprints, forms and workflow set-up

**Epic:** S — Workspaces and changes · **Priority:** could · **Size:** L
**Depends on:** 376, 377, 381, 383, 388, 390

## Story

As someone running a site in two places, I want languages, dictionary items, blueprints,
form definitions and workflow set-up to be changed in a workspace, recorded as changes
and carried by them, so that the serving copy can lock them as it locks pages and types.

## Context

Changes (`381`) record pages, media, Library items, types, data types and files, and
`383` moves those between sites. A site with `CROMBOLO_CONTENT=locked` (`388`) locks only
what a change carries, so these five stay writable there until this story (decided
2026-11-20).

They are stored in two ways today:

- **Schema files:** languages (`schema/languages.toml`, also rows the sync writes), form
  definitions (`schema/forms/*.toml`, `docs/forms.md`) and approval workflows
  (`schema/workflows/*.toml`, synced to `key_value` `crombolo:workflows`,
  `docs/workflows.md`).
- **Rows:** the dictionary, kept in the database so translators could work in
  production (`docs/content-transfer.md`), and blueprints, which are nodes
  (`DocumentBlueprint`).

## The design

- **The schema-file kinds join a workspace's schema copy** (`376`): its file store, by
  hash, holds the workspace's `languages.toml`, forms and workflows. Their editors (the
  languages API, the form designer, the workflow screens) write there with the header.
  A merge brings them three ways per line (`377`), and a change records each file's
  before and after, as a type's file is today (`typeFile`).
- **What a removal costs** is classed as types are (`382`): removing a language that
  holds values, a form field that holds entries, or a workflow with requests open is
  lossy, and is refused until accepted.
- **The dictionary gets rows of its own in a workspace,** as types did (`376`): a copy of
  an item under a derived key with its origin, and new items of the workspace's own. A
  merge goes three ways per item and language, and a translation changed on both sides
  is a conflict. A change carries each item's translations before and after, matched by
  name on the target (`168` keys a new item by its name).
- **Blueprints are made and changed in a workspace as pages are** (`390`'s per-kind
  object types: a `WorkspaceBlueprint`), merged through their kind's Shared writes, and
  carried as values per property, language and segment.
- **The workspace's site** (`379`) renders with its own languages and dictionary.
- **Recorded as direct edits too:** each kind's direct write in Shared is recorded, in
  `381`'s ten-minute window per person.
- **`388`'s lock covers all five,** so a locked site refuses each, translators included:
  they work on the site where content is made. An unlocked site translates anywhere, as
  now.
- **`383` carries them:** exported, applied with the base checked per item, and staged.

## Decisions (settled 2026-11-20)

- **The dictionary is carried and locked.** On a locked site translators work on the
  site where content is made; an unlocked site is unchanged.
- **All five are changed in workspaces too,** not only recorded as direct edits: each
  joins the workspace copy and the merge.
- **The schema-file kinds travel as their texts,** the dictionary and blueprints as
  values per item, as `383` carries types and pages.

## Acceptance criteria

- [ ] **In a workspace,** a language, a dictionary item, a blueprint, a form definition
      and a workflow are changed without Shared changing, and are merged into it.
- [ ] **A translation changed on both sides,** or a schema file changed in the same
      lines, is a conflict, settled by choosing one.
- [ ] **Removing a language with values, a form field with entries or a workflow with
      open requests** is lossy and needs accepting.
- [ ] **A direct edit** to each kind is recorded as a change.
- [ ] **An exported change** carries each kind and applies it on another site (`383`).
- [ ] **The workspace's site** shows its own languages and dictionary.
- [ ] **With `CROMBOLO_CONTENT=locked`,** each is read-only, the dictionary included.
- [ ] **Tests** on both dialects; `docs/workspaces.md`, `docs/changes.md` and
      `docs/content-transfer.md` (where translators work) updated.
