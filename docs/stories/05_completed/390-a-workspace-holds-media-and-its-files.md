# 390 — A workspace holds media and its files

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 375, 385

## Story

As someone working in a workspace, I want to upload an image, replace a file or tidy a
folder there, and use it on the workspace's pages, so that the media a piece of work
needs arrives with it and nobody sees it before then.

## Context

A workspace holds pages (`375`), and will hold schema (`376`) and code files (`377`).
Media and Library items are refused inside one, "until a later story" (`375`). The
stories after it already count on media being there: a merge "of pages and media only"
(`380`), a site whose Shared takes no direct edit of media (`380`, `381`), and a change
that carries the media it added or replaced to another site (`383`). `385` puts media
under Content, so the back office's switch can cover it.

Without this, a site that requires a workspace for every edit (`workspaces.required`)
has no way to add an image.

## The design

- **A media item in a workspace is versioned as a page is** (`375`): its name, its
  folder, its properties and its type. Making, changing, moving and deleting one are
  the workspace's until it is merged, with moves and deletes of Shared's items held as
  pending.
- **Folders** are media items and behave the same.
- **Library items** are taken in the same way.
- **The file is the workspace's too.** An upload, or a file replaced on an existing
  item, is stored where no other version's file is, and the workspace's version of the
  item points at it. Shared's version keeps pointing at the file it had.
- **Nothing is copied at merge.** The merged version already points at its file, so the
  merge is of the item alone, and the file is in place before it.
- **Discarding** removes the workspace's versions, and then each file that no version
  still points at.
- **Serving:**
  - at the workspace's address (`379`), a media address answers with the workspace's
    file, crops and resized versions included;
  - at Shared's address, a file that only an open workspace points at is refused, as a
    missing file is;
  - cached crops and sizes are keyed by the file, so a workspace's never answer for
    Shared's.
- **Access rules** on media (`203`–`205`) apply in a workspace as they do in Shared, on
  the workspace's version of the item.
- **Pickers in a workspace** offer Shared's media and the workspace's. A page there may
  use an item made there. Merging the page without the item is refused, with the item
  named (`380`).
- **Shared's derived data** (search, the media-usage table) holds nothing from an open
  workspace, as for pages.
- **Conflicts** follow `380`: two versions of an item's properties merge by property;
  a file replaced on both sides is a conflict to choose between, never merged.
- **A change that moves to another site** (`383`) carries the files of the media it
  added or replaced.
- **`workspaces.required` covers media** from this story on.
- **The setting that says which kinds a workspace may hold** (`375`) gains media.

## Decisions (settled 2026-11-20)

- **The site's one media store.** An upload or a replaced file is placed as today
  (`MediaFileStore.place`: a new random folder, never reused), and the workspace's
  version of the item points at it. Shared's `content.file_url` and `node_file` are
  untouched until the merge, whose Shared save points them at the file; it goes live
  when the merge commits. No bytes move, so the store can't fail a merge, and a rolled
  back merge leaves the file the workspace's.
- **Refused at Shared's address.** The workspace's rows stay out of the ownership index
  `serveMedia` reads, so an unmerged file is 404 as a missing one is, at no extra cost.
  This is complete for stores crombolo serves or signs addresses for; on a store read
  publicly and directly (a public bucket or CDN), the random path is the only
  protection, and the docs say so.
- **A discard's files go right after it:** its transaction removes the rows, then a
  background job deletes each file no version still points at, so a slow store never
  holds the transaction open. A file replaced on both sides and not chosen at merge is
  deleted the same way.
- **No cap** on a workspace's uploads beyond the existing per-upload limit.
- **Serving at the workspace's address is `379`'s,** as for `377`: this story keeps the
  workspace's file on its version and reads it in the workspace; `379` serves it, with
  its crops and sizes, at the workspace's address.

## Acceptance criteria

- [x] **An upload in a workspace** is on that workspace's pages, and is not in Shared's
      media, search or usage.
- [x] **A file replaced in a workspace** leaves Shared serving the earlier file until
      the merge, and the new one after.
- [x] **Crops and resized versions** are keyed by the file, so a workspace's never answer
      for Shared's; at the workspace's address they follow its file (`379`).
- [x] **A file only an open workspace points at** is refused at Shared's address.
- [x] **Moving, renaming and deleting** a Shared media item or folder in a workspace
      changes nothing in Shared until the merge.
- [x] **Merging** puts the items in Shared with their files, and a page that uses an
      item made in the workspace cannot be merged without it.
- [x] **A file replaced on both sides** is a conflict, settled by choosing one.
- [x] **Discarding** removes the workspace's items and every file nothing else points
      at, and leaves Shared's files alone.
- [x] **Library items** are made and changed in a workspace as media is.
- [x] **Media access rules** hold in a workspace: the media operations check them as in
      Shared.
- [x] **A site that requires a workspace** refuses a direct media edit, and takes one in
      a workspace.
- [x] **Tests** on both dialects; `docs/workspaces.md` moves media and Library items out
      of "Not yet".

## Built (2026-11-20)

- **Kinds in a workspace:** `KINDS[kind].workspaceObjectType` (`WorkspaceMedia`,
  `WorkspaceElement` in `@crombolo/core`); `DocumentRepository.sees`, `create` and the
  merge's pages by kind; `NodeRepository.children` lists a workspace's own of each kind;
  `ofKind` gives a repository of another kind on the same handle.
- **Operations and ports:** `mediaIn` and `elementsIn` in `node-operations.ts`
  (`workspaceAuditSink`, `workspaceElementEventSink`); the media and element ports take
  `workspace`; `inWorkspaces` in `ports.ts`. The media and Library operations moved from
  `WORKSPACE_REFUSALS` to `WORKSPACE_OPERATIONS`; their bins, the Library's folders, copy
  and rollback refused.
- **The merge** (`workspace-merge-run.ts`): `KINDS` in order (Library, media, pages), each
  page and pending change written through its kind, the media tree's lock taken; a page
  merged alone refused while it uses a workspace-only item.
- **Files:** `serveMedia` serves a file the workspace's values name on its site
  (`heldByWorkspace`); a discard's files (`filesNamedBy`) are removed after it unless named
  elsewhere (`removeUnnamedFiles`).
- **Tests:** `tests/workspace-media.test.ts`.

## Left for later

- **Tested on the file system store;** the other stores place files the same way, through
  `MediaFileStore`.

