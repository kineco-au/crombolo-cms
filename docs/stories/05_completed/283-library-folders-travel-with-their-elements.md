# 283 — Library folders travel with their elements

**Epic:** K — Moving content · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone moving content between sites, I want the folders in the Library to travel
with the elements in them, so that the destination has the structure I built and an
element picker that starts at a folder still works.

## Context

A bundle carries documents, media, elements and blueprints. A Library folder is none
of those: it is an `ElementContainer` node, and `export.ts` asks only for the other
kinds. An element in a folder therefore arrives at the Library root with its parent
lost, and a data type whose `startNodeId` names the folder points at nothing.

Media folders do not have this problem, because a media folder is a media node.

## Acceptance criteria

- [x] A bundle can carry a Library folder as a node, with its key, name, parent and
      sort order, and `check` validates it as it does any other node.
- [x] Exporting an element brings the folders above it; a folder chosen as a root
      brings what is inside it.
- [x] Importing makes the folders before their elements, keeps their keys, and is
      safe to repeat, so an element picker's `startNodeId` resolves on the destination.
- [x] A bundle written before this still loads and imports unchanged, and revert
      removes the folders an import made, unless something else now sits in them.
- [x] Exported through `@crombolo/crombolo/transfer`, so a tool writing a bundle can
      name the new kind. Documented, with covering tests on both dialects.

## Findings (2026-11-06)

- **What happens today differs from the Context, and is worse in one case.** The
  exporter lists an element's folder as an expected dependency. So:
  - with the folder missing, `check` refuses the import (`missing-parent`) unless
    `--under` is given;
  - with the folder present under the same key, the check passes, and `applyBundle`
    places the element at the Library root, as its parent is not in the run. This
    is the case the Context describes.
- **A whole-site export loses elements in folders altogether.** `exportSite` takes
  its roots from `nodes.roots()` per tree, and `SITE_TREES` has `Element` but not
  `ElementContainer`, so a folder is never a root and nothing walks into it.
- **A folder cannot be named as a root.** `CONTENT_OBJECT_TYPES` in
  `bundle-install.ts` leaves it out, so `resolveNodeRef` refuses it. `selected()`
  would otherwise drop the folder and keep what is below it.
- **`startNodeId` needs nothing from the server.** Only the vendored picker reads
  it. It is a key in a data type's config, so keeping the folder's key is enough.
  The same picker has a `folderOnly` mode, so a value can name a folder: that
  reference already travels as an expected dependency, or as carried once the
  folder is in the bundle.
- **The bundle editor's picker picks elements only,** so there a folder arrives as
  the ancestor of what was picked. It needs no change.
- **A folder has no document row.** There is no type, value, version or event, so
  `eventMarkers`, `rollback`, `publish` and `content_applied` do not apply, and
  `checkBundle` and `applyBundle` must keep folders away from them.
- **No migration:** `transfer_change.kind` is `varchar(16)`, and `element-folder`
  fits.
- **`transfer` is a published surface,** promised stable in `278`, so `BundleNode`
  keeps its shape.

## Decisions (2026-11-06)

- **Create only.** An import makes the folders that are missing and leaves existing
  ones alone: a rename or move at the source does not follow, and the site's own
  changes are never touched. Elements still go into the folder the bundle names.
  So a run records a folder only when it created it, and revert has nothing to
  restore. No `content_applied` row is kept for a folder.
- **Format 6, always.** `BUNDLE_FORMAT_VERSION` becomes 6 and
  `OLDEST_BUNDLE_FORMAT_VERSION` stays 5, so older bundles still load. A site on
  0.49 or earlier refuses a new bundle with "newer than this version understands",
  even one with no folders.
- **A folder keeps its key even where a same-named folder exists.** Folders have no
  URL to clash over, and adopting the other's key would break `startNodeId`. The
  two sit side by side, with an `auto` finding.

## Plan

### 1. The format (`packages/transfer/src/model.ts`, `load.ts`)

- `BundleKind` gains `'element-folder'`. A folder is a `BundleNode` with
  `contentType: ELEMENT_FOLDER_TYPE` (`{ key: '', alias: 'elementFolder' }`),
  `template: null`, `values: []`, and one variant holding its name, so writing,
  sealing, `withoutContent` and anonymising work unchanged.
- `load.ts` adds the kind to `KINDS`. It fills in `contentType` for that kind, so a
  tool need not write it, and refuses a folder that carries values.
- `BUNDLE_FORMAT_VERSION = 6`, with a line in the header comment saying so.
- `ELEMENT_FOLDER_TYPE` exports from `@crombolo/crombolo/transfer`.

### 2. Export (`export.ts`, `bundle-install.ts`, `site-file.ts`)

- `KINDS` gains the folder: `ElementContainer`, read through `element`. That makes
  a folder root work in `selected()`, and `wanted` gains the type, so its
  subfolders and elements come with it. `--only` brings the folder alone.
- `selected()` adds the `ElementContainer` ancestors of every chosen element and
  folder (`nodes.ancestors`), which sort before their children by `level`.
- `exportBundle`'s loop writes a folder from its `NodeRow`, before any aggregate
  read. `parentKey` works as it does for any node, and a folder adds nothing to
  `dependencies.schema`.
- `ElementContainer` joins `CONTENT_OBJECT_TYPES` in `bundle-install.ts` and
  `SITE_TREES` in `site-file.ts`, which fixes the whole-site loss above.

### 3. Check (`check.ts`)

A branch at the top of the node loop, before any type or editor read, plans a folder
as `create` or `unchanged`:

- **Key held by something else:** `folder-key-taken`, blocking.
- **Parent:** must be a folder in the bundle, or the manifest's expected
  dependency, which the existing check answers. A parent in the bundle that is not
  a folder is `folder-parent-invalid`, blocking.
- **`--under`** must name a Library folder when the bundle has folders at its top;
  otherwise `folder-under-invalid`, blocking.
- **Same name, other key:** `folder-beside-namesake`, auto.
- **In the recycle bin here:** `unchanged` is not true of it, so it plans as `create`
  with `folder-restored`, auto. It comes out of the bin rather than asking, because
  it holds nothing but a name. Elements in it still raise `local-trashed`.

### 4. Import (`import.ts`)

- `applyBundle` splits folders from `ordered` and handles them first, parents first
  and by `sortOrder` within a parent, so they are appended in the source's order.
  The bundle's `sortOrder` is not replayed beyond that, as for elements.
- A missing folder is made with `FolderRepository.create({ key, name, parentKey })`.
  A folder in the bin is restored.
- **Elements keep their parent:** the keys of the bundle's folders, made or already
  here, join the set that decides `parentKey`, so an element lands in its folder.
  Without that it would go to the Library root.
- Only created folders are recorded (`runs.record`, action `create`, null events).
  They stay out of pass two, publishing and `content_applied`.
- A second import creates nothing, so `plan` shows them `unchanged`.

### 5. Revert (`revert.ts`, `packages/data/src/repositories/folders.ts`)

- `folderToRecycleBin`'s logic moves from `adapters/elements.ts` into
  `FolderRepository.toRecycleBin(key, bin)`, with a matching `restore(key, parentKey)`,
  and the adapter calls it.
- **`checkRevert`:** a folder with anything under it besides the run's own nodes plans
  as a new `keep` action, with a `folder-kept` auto finding and no `children-added`
  question. Otherwise it plans as `recycle`.
- **`revertRun`:** folders leave the shallowest-first recycling, which would take a
  branch whole. They go after the elements, deepest first, and each is recycled
  only if empty at that moment, so a parent of a kept folder stays too. They are
  recorded as `recycle`, like any node.
- **Reverting the revert** brings them back with `FolderRepository.restore`,
  shallowest first, and they skip the rollback and publish steps.
- `repoFor` maps the kind to `element`.

### 6. Tests (`tests/library-folders-transfer.test.ts`, both dialects)

- **Export:** an element brings its chain of folders; a folder root brings its
  subfolders and elements; `--only`; a whole-site export carries elements in folders.
- **Format:** a folder round-trips through write and load, sealed and with content
  omitted; `load` refuses a folder with values; a format 5 bundle still loads and
  imports as it did, with an element's folder as a dependency.
- **Import:**
  - folders first, keys kept, element in place, a data type's `startNodeId` naming
    a folder that exists;
  - a second import creates nothing;
  - a folder renamed or moved here stays as it is, and an element still lands in it;
  - a same-named folder sits beside it;
  - each refusal, and a folder coming out of the bin.
- **Revert:** folders removed; a folder holding something else kept, with its
  parents; revert of the revert; a folder that existed before the run untouched.
- `bundle deploy` to a second server in `tests/integration/remote-deploy.integration.ts`,
  carrying a folder.

### 7. Docs

- `docs/bundles.md`: the kind, what it carries, create only, revert, and format 6 in
  place of "Every bundle says `formatVersion: 5`".
- `docs/api.md` and `bun run api:snapshot` for `ELEMENT_FOLDER_TYPE`.
- `docs/release-notes.md`: the fix to whole-site exports, and an upgrade note that a
  site on 0.49 or earlier cannot read a bundle from this release.

## Implementation (2026-11-06)

Built as planned. What differs, or was found on the way:

- **A recycled folder's parent:** a folder has no `document` row, so nothing keeps
  where it was. The revert notes it in `content_applied` under its own run, and a
  revert of that revert reads it back. Imports never read a folder's row.
- **Order in a revert of a revert:** folders come back in the reverse of the order
  the revert recorded them, which is parents first.
- **`folder-parent-invalid`, `folder-key-taken`, `folder-under-invalid`** are the
  blocking findings, `folder-beside-namesake`, `folder-restored` and `folder-kept`
  the automatic ones.
- **No test through `bundle deploy`,** as the plan had it: a site's files cannot name
  a Library folder yet, so `remote-deploy.integration.ts` has nothing to send.
  The tests apply a bundle between two sites instead, written and loaded from disk.
- **Found, not fixed:** restoring a recycled Library folder from the back office looks
  broken. `PutRecycleBinElementFolderByIdRestore` calls `DocumentRepository.restore`,
  which answers `notFound` for anything but an element, and
  `GetRecycleBinElementFolderByIdOriginalParent` reads a `document` row a folder does
  not have. This is from reading the code. `FolderRepository.restore` is there for a
  fix, which still needs a story.
- **Tests:** `tests/library-folders-transfer.test.ts`, on both dialects.

## Out of scope

- Who may read a folder: Library permissions are unchanged.
