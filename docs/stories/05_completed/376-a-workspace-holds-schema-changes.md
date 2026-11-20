# 376 — A workspace holds schema changes

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** XL
**Depends on:** 375

## Story

As someone building a site, I want to change a content type or a data type in a
workspace and see pages use it there, so that a type and the pages that depend on it are
finished together before anyone else is affected.

## Context

A saved type is live for everyone at once. The commonest piece of work on a site changes
a type and its template together, so a workspace that could hold pages and files but not
types would leave a gap in the middle of it.

`property_data` points at a `property_type` row, which is what makes a version per
workspace workable: a workspace's values can point at the workspace's own row.

## The design

- **A type changed in a workspace has a version of its own there:** content, media and
  member types, their properties and groups, data types, compositions, allowed children
  and allowed templates.
- **A new property** is a `property_type` row carrying the workspace. The workspace's
  page versions point at it.
- **A changed property** is a new row with the same alias. Shared's row and the values
  under it are untouched.
- **A read in a workspace** resolves each type to the workspace's version where it has
  one and Shared's otherwise. The schema cache for a workspace holds only what differs.
- **The base is recorded per item,** when the workspace first changes it, as for pages.
- **Each change is classed** safe or lossy (`382`) when it is saved, and the class is
  kept with it.
- **The schema files.** Where a site's schema is in its code, a workspace's versions are
  written out as files only when the workspace is merged (`380`) or pulled (`386`).

## Decisions (settled 2026-11-20)

- **`workspace_id` on every schema table** (the maintainer's choice): `content_type`,
  `property_type`, `property_type_group`, `data_type` and the composition, allowed-child
  and allowed-template tables, under the same node ids as Shared's. SQLite rebuilds the
  tables whose primary key or unique alias index has to take it; every Shared read of the
  schema filters `workspace_id IS NULL`, with leak tests as the guard, as for pages
  (`375`). Export and the boot sync of data types are the sharpest leaks: both read every
  `data_type` row today.
- **A changed property** is a row of the workspace's with the same alias. Pages' values
  are carried while its storage and language variation are unchanged; a storage change
  reads empty in the workspace, as its lossy class says, and `382` converts at merge.
- **Hidden outside the workspace.** An alias that clashes with Shared's is refused at
  save; a clash with another workspace is settled at merge (`380`).
- **Relation sets** (compositions, allowed children, templates) are owned whole once
  they differ, and follow Shared until then.
- **The base** is a snapshot of Shared's item when the workspace first changed it, with a
  hash, so `380` merges per property.
- **Shared deleting or purging** a type, data type or property an open workspace holds is
  refused, without naming the workspace; an administrator may force it, which leaves a
  marker the merge must answer (`380`).
- **The files' rules:** story `344`'s check runs on each workspace save against the
  workspace's view, and again at merge; where the schema is read-only, workspace saves are
  refused.
- **Media and member types** are included; schema follows `CROMBOLO_WORKSPACES`.
- **The header on type and data-type operations** is classified for every one, with a
  guard test: today it is ignored there, so a save with it changes Shared.
- **Saving a type in a workspace needs Structure** (`385`); the migration is 085.

## Revised (2026-11-20, the maintainer's)

- **A workspace holds a full copy of `schema/`, frozen when it opens,** in its own store in
  the database (with `377`'s files). The copy taken at open is the base for the merge.
  Untouched types no longer follow Shared; "update from Shared" (`380`) brings Shared's
  later changes in. This replaces "relation sets follow Shared until they differ" and "the
  base is a snapshot taken when first changed" above.
- **The TOML files are the workspace's source of types.** The back office and API edit a
  workspace's types by writing its copy of the files, and a sync writes the workspace's rows
  from them (still `workspace_id` on the schema tables, as pages' values point at rows). A
  workspace's rows hold every type as its files have it, each property carrying the Shared
  row it stands for, so Shared's values read through it.
- Pages still follow Shared (`375`): a workspace holds frozen types and code with live pages.

## Taken from `380` (2026-11-20)

- **Types join the merge:** `380`'s merge (`runWorkspaceMerge`, `planWorkspaceMerge`)
  plans and writes pages only, in one transaction; a workspace's schema files merge
  three ways and sync before its pages are written, all in the same all-or-nothing run.

## Planned with `377` (2026-11-20, the maintainer's)

- **The store is by hash,** built here: file texts kept once by SHA-256 in a blob table,
  and each workspace's list of path and hash. Opening a workspace copies the list of
  `schema/` (and, with `377`, the views, stylesheets and scripts); the hash at open is
  each file's merge base.
- **Built here for both:** the store, the three-way file merge (`node-diff3`, by line;
  an overlap is a conflict answered per file as mine, theirs or a resolved text) joined
  into `380`'s run before pages, and "update from Shared".

## Revised again (2026-11-20, the maintainer's, from the survey)

- **A workspace's copy of a type or data type has nodes and ids of its own,** replacing
  "under the same node ids as Shared's": the type tables are keyed on `node_id` alone, the
  foreign keys from `content`, groups and allowed children point at it, and eight queries
  join on it. Each copy is a node of its own object type (a workspace content type, a
  workspace data type), with its own property and group ids, each row naming the Shared
  item it stands for (`shared_node_id`, `shared_property_type_id`) and carrying
  `workspace_id`. No key is rebuilt and no foreign key changes; the alias indexes become
  partial, over Shared's rows. A value saved in the workspace uses Shared's property id
  where the copy's property stands for one, so a merge maps nothing.
- **Rows are built at the workspace's first schema save,** from its frozen files. A
  workspace that only edits pages builds none and reads Shared's types as they are now.
- **The migration is 085** (`380` took 084).
- **A workspace sync is its own mode of `syncSchema`:** types and data types only, into
  the workspace's rows, with no `schema_state` row, no cache instruction, and no
  languages, workflows, user groups or URL options.

## Acceptance criteria

- [x] **A property added in a workspace** can be filled in on a page there, and does not
      exist in Shared.
- [x] **A property changed in a workspace** reads changed there and unchanged in Shared,
      with Shared's values intact.
- [x] **A new type** can have pages made of it in the workspace, and is not offered
      outside it.
- [x] **Data types, compositions and allowed children** have workspace versions the same
      way.
- [x] **An untouched type follows Shared's changes,** revised: until the workspace's
      first schema save it reads Shared's types as they are; after it, its copy is frozen
      and "update from Shared" brings Shared's changes in.
- [x] **Each change carries its class,** with each file it changed (`none`, `additive`,
      `data-requiring`, `breaking`, story 382's four).
- [x] **Discarding the workspace** leaves Shared's schema as it was.
- [x] **Tests** on both dialects.

## Built (2026-11-20)

- **Migration 085 `AddWorkspaceSchema`** (`packages/data/src/schema/workspace-schema.ts`):
  `file_blob`, `workspace_file`, `workspace_id`/`origin_key` on `content_type` and
  `data_type`, `origin_key` on `property_type` and `property_type_group`,
  `workspace.schema_built`, and `ux_content_type_alias` partial over Shared's rows with
  `ux_content_type_workspace_alias` for a workspace's.
- **The store:** `WorkspaceFileRepository` (`snapshot`, `files`, `changes`, `write`,
  `rebase`, `changedInOpenWorkspace`, `discard`, `collect`); `dropWorkspaceSchema` on
  discard and merge.
- **Copies:** `ContentTypeRepository` and `DataTypeRepository` take `workspace` (and
  `inWorkspace`), store a copy under `workspaceRowKey(workspace, key)` with the workspace
  object types in `@crombolo/core`, and read it back under the keys it stands for;
  listings merge copies over Shared's rows in memory. `DocumentRepository` resolves a
  page's type to the copy (`#readTypeNodeId`) and hands a copied property the Shared
  property's id while storage and variation match.
- **The sync and the export** take `workspace`: `syncSchema` writes types and data
  types only, and retires a type its files dropped; `exportSchemaSet` exports the
  workspace's view. `schemaSetFiles` turns a set into files by path.
- **The server** (`packages/server/src/workspace-schema.ts`): `snapshot` at open (the
  routes and a person's own workspace), `ensureBuilt` before the first schema save,
  `plan`/`apply` for the merge (the runner's new `files` hook in `runWorkspaceMerge`,
  which takes the schema lock before the content tree's and restores the files when the
  merge is undone), `updateFromShared` and `resolve`. The type and data-type ports take
  a workspace (`createWorkspaceSchemaFileWriter`, `workspaceSchemaProblems`), wrapped by
  `inWorkspaces` in `ports.ts`. `node-diff3` 3.1.2 merges text.
- **Deletes:** a Shared delete of a type or data type an open workspace changed answers
  409 `InWorkspace`; `?force=true` by an administrator goes ahead.
- **Tests:** `tests/workspace-schema.test.ts` (data) and
  `tests/workspace-schema-api.test.ts` (HTTP, merge, conflicts, update, discard,
  read-only, deletes, the operation guard).

## Left for later

- **The back office** has no workspace switch until `384`, so a workspace's types are
  changed through the API.
- **The trees** list Shared's types in a workspace; a type made there is reached by its
  key.
