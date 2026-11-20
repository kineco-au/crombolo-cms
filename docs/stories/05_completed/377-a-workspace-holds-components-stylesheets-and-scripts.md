# 377 — A workspace holds components, stylesheets and scripts

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 375, 376

## Story

As someone building a site, I want to change a template, a block's component or a
stylesheet in a workspace, so that I can see the change on real pages without changing
what everyone else sees.

## Context

A component saved through the Management API is live at once, for everyone. There is one
copy of each file. Components import each other, so a changed file and the unchanged
files around it have to resolve against each other inside the workspace.

## The design

- **Only the changed files are stored,** with the workspace, in the site's store. That
  is the workspace's truth, and what every node of a site reads.
- **A node builds the workspace's tree when it first needs it:** hard links to its own
  files, with the workspace's files laid over them. No data is copied.
  - A changed file importing an unchanged one resolves, because the unchanged one is
    there as a link.
  - An unchanged file importing a changed one gets the changed one, because its copy in
    the workspace's tree is a module of its own.
- **Each save is a new tree,** at a new path, since a loaded module stays loaded at its
  path. So is a change to Shared's files under an open workspace.
- **A workspace that changes no file has no tree** and renders from the site's own.
- **Built assets** are built per tree and kept by the hash of what went in.
- **What a workspace cannot hold:** `package.json` and its lockfile, the site's
  configuration, and server routes, middleware and jobs. They are wired when the process
  starts. A change to one is recorded with the workspace and takes effect when it is
  merged.
- **The base is recorded per file,** as for pages.

## Findings needed before starting

- **How a component is reloaded today** after the Management API writes it, and what
  that leaves in memory.
- **That two hard-linked paths are two modules** in the runtime, on each platform the
  suite runs on.
- **What the tree costs** for a site with thousands of files, measured.

## Decisions (settled 2026-11-20)

- **The database holds a workspace's files:** a `workspace_file` table, so every node
  serves the same, discard is one transaction with pages and types, and both dialects are
  tested. A file is capped (about 1 MB).
- **Refused where the site's files are read-only** (content mode, story `343`), as `376`
  refuses read-only schema: a workspace there could never merge its files.
- **Shared deleting or changing a file a workspace holds** is refused, without naming the
  workspace, unless an administrator forces it, which leaves a marker the merge answers
  (`380`), as `376` decided for types. A deploy still changes files underneath, and the
  merge finds that by the file's base hash.
- **How a node hears of a change:** a revision on the workspace, read on each workspace
  render; nothing on the cache instruction stream.
- **The views tree** is linked from Shared's built snapshot, with only the workspace's files
  transformed, and copied where links cannot be made.
- **In-process trees have a budget of their own** (`CROMBOLO_WORKSPACE_VIEWS_LIMIT`, 50) until
  `378`.
- **Files no workspace route reaches** (`package.json`, the config, routes, jobs) are recorded
  as taking effect at merge, through a minimal administrator-only route.
- **Built alongside `376`:** a template made in a workspace can be allowed on a type once
  `376` lands.
- **A file that does not compile is refused** on save.
- **First, spikes:** hard-linked trees at 2,000, 5,000 and 10,000 files; two linked paths are
  two modules on macOS and in Docker; the snapshot's 2,000-file limit raised.
- **Fixes regardless:** a workspace file save is audited naming the workspace; the template
  alias index becomes Shared's only; a page save accepts only Shared's templates or its own
  workspace's.

## Revised (2026-11-20, the maintainer's)

- **A workspace holds a full copy of the components, stylesheets and scripts, frozen when it
  opens,** in `workspace_file` with `376`'s schema files. The copy taken at open is the base for
  the merge; untouched files no longer follow Shared, and "update from Shared" (`380`) brings
  later changes in.
- **Each node renders a workspace from a full copy** of its views, written from the store,
  not hard links: no module-identity or cross-device risk, and only changed files are written
  again after a save. The hard-link spike is dropped; the snapshot's file limit is still raised
  and measured.

## Taken from `380` (2026-11-20)

- **The merge's component check:** a merge refuses where the workspace's components no
  longer type-check against Shared's files as they are now, and says where. `380`'s
  merge (`runWorkspaceMerge`) plans and writes pages only; files join it here, merged
  three ways and written as its last step.

## Planned (2026-11-20, the maintainer's)

- **Stored by hash.** File texts are kept once each, by SHA-256, in a blob table; a
  workspace holds a list of path and hash (`376` builds it). Opening one copies the list
  only, identical files are shared between workspaces, and each file's hash at open is
  its merge base. This replaces "a `workspace_file` table" above; the 1 MB cap stays.
- **377 renders, 379 serves.** 377 builds a workspace's views tree, a snapshot written
  from its list as any generation is (`snapshots.ts`), under its own budget
  (`CROMBOLO_WORKSPACE_VIEWS_LIMIT`), and a render of a page in a workspace, tested
  directly. Serving it, its stylesheets and scripts included, at the workspace's address
  is `379`'s; that criterion moves there.
- **Text merges with `node-diff3`** (MIT, no dependencies of its own), by line, three
  ways. Changes that don't overlap merge; a file with an overlap is a conflict answered
  per file: mine, theirs, or a resolved text.
- **`376` builds what both share:** the store, the merge of files inside `380`'s run, and
  "update from Shared". 377 adds its file kinds (components, stylesheets, scripts, and
  the files that take effect only at merge), the views tree, the render and the component
  check at merge.
- **Depends on `376`** for the store.

## Acceptance criteria

- [x] **A component changed in a workspace** renders changed there and unchanged in
      Shared.
- [x] **An unchanged template that imports a changed component** renders the changed
      one in the workspace.
- [x] **A second change to the same file** renders, without restarting anything.
- [x] **A stylesheet or script changed in a workspace** is read changed in the workspace
      only; serving it at the workspace's address moved to `379`.
- [x] **Every node of a site** serves the same workspace files: they are the database's.
- [x] **A change to a file a workspace cannot hold** is recorded and marked as taking
      effect at merge.
- [x] **Opening a workspace** builds no tree.
- [x] **Tests,** including a site with several thousand files.
- [x] **The merge's component check** (from `380`): a merge whose components would no
      longer compile and import against Shared's is refused, saying where.

## Built (2026-11-20)

- **The file list** (376's store) holds `components/`, `stylesheets/` and `scripts/`
  beside `schema/`, copied as a workspace opens (`createWorkspaceSchema.snapshot`, files
  over 1 MB left out), and `site/` for files carried to the merge
  (`SITE_FILES`: the package and lockfile, the config, routes, jobs, middleware).
- **The ports:** `createWorkspaceFilePort` (`adapters/workspace-file-port.ts`) over the
  list, wrapped by `inWorkspaces` for the components, stylesheets and scripts in
  `ports.ts`; `DoesNotCompile` and `TooLarge` file statuses with a detail. The partial
  view, stylesheet and script operations are in `WORKSPACE_OPERATIONS`, their folders
  and the template writes in `WORKSPACE_REFUSALS`, the template reads and snippets in
  `WORKSPACE_SHARED_SCHEMA_READS`; the guard test covers them.
- **The views:** `createWorkspaceViews` (`workspace-views.ts`) writes a workspace's
  components into a folder of its own with a `ViewSnapshots` and a `Renderer` over it,
  rewriting only changed files and refreshing the snapshot, up to
  `CROMBOLO_WORKSPACE_VIEWS_LIMIT`, least recently used dropped; dropped too when the
  workspace is merged or discarded. `GET /{key}/render?path=/`.
- **The merge** (`workspace-schema.ts`, now every area): three ways per file;
  `checkComponents` over Shared's components with the merged ones laid over them, its
  problems refusing the merge as "A component would break: …"; the files written where
  they live with the definitions' restore; a `components` cache instruction after.
  `fileRefusals` asks Structure, Code, or an administrator, by what the files are.
  `update` and `files/resolve` take any area's file.
- **Tests:** `tests/workspace-views.test.ts`.

## Left for later

- **A full type check** (`tsc`) at merge needs the site's own `tsconfig` and compiler; the
  check compiles and imports each component, which finds a broken import or syntax.
- **A template made in a workspace** has no template row until merged, so a workspace
  type cannot allow it yet.
- **Serving** a workspace's stylesheets, scripts and pages at its address is `379`'s.
