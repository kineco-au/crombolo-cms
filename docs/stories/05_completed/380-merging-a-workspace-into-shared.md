# 380 — Merging a workspace into Shared

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 375

## Story

As someone who has finished a piece of work, I want to merge my workspace into Shared in
one step, seeing exactly what will change and anything that conflicts, so that the work
arrives whole or not at all.

## Context

Applying a bundle already records a run, each page it touched and what was there before
(`content_transfer_run`, `content_transfer_change`), finds conflicts per property
(`102`) and resolves them in the back office (`103`). A merge is the same act with a
workspace as its source, and should use that machinery, not a second one.

## The design

- **A merge is all of a workspace or none of it,** in one transaction for what the
  database holds, with its files put in place as the last step.
- **Before it runs, it says what it will do:** every item, added, changed or removed,
  each with its class (`382`), and what takes effect only now (`377`).
- **A conflict** is an item Shared changed since the workspace took its base.
  - Pages merge per property, language and segment: different properties changed on each
    side is no conflict.
  - Types merge per property.
  - Files merge as text, three ways.
  - What is left is resolved in the workspace, keeping one side or the other per item or
    property (`103`), and never by the merge choosing.
- **The checks run on what Shared would become:** the schema's own rules, and the
  component check on the workspace's files over Shared's as they are now. A change in
  Shared can break a workspace without touching the same item, and this is where that is
  found.
- **An approval workflow runs at merge.** Everything merges at once; a page a workflow
  covers arrives as a Shared draft, and its publish or unpublish becomes an approval
  request on the merged version, going live when approved.
- **A merged change is replayed through Shared's own save and publish,** as new rows
  with new ids, never by clearing `workspace_id`: Shared's reads go by the newest id, and
  a workspace's ids interleave with Shared's. The run records each page before and after.
- **What waited (`379`) happens now:** webhooks, search, the published cache, schedules.
- **The workspace closes** and becomes a change (`381`).
- **Merging needs a permission of its own,** apart from editing.
- **Several workspaces can be merged as one:** all of them or none. A conflict between
  two of them is found and named before anything is merged, and settled in one of them.
- **A person's own unnamed workspace** (`375`) merges page by page. Publish there is
  the merge of that page alone, at once, where the change is of pages and media only
  and the person may publish the page. Anything else in it waits for a merge.
- **A merge can be left to the host.** Where no group holds the permission, workspaces
  are merged only through the Management API by a caller the site trusts to.

## Decisions (settled 2026-11-20)

- **All or nothing,** with a change dropped from the workspace first where it should not
  go; a person's own unnamed workspace merges page by page.
- **Replayed as new Shared events** (above).
- **Approvals at merge:** the page merges as a draft and is published on approval (above).
- **Merging needs `Crombolo.Workspace.Merge`, and each change's own** verbs, languages and
  start nodes at its place, so a merge never does what the person could not do directly.
- **Per field, three ways:** a page's base, the workspace's and Shared's current, by
  property, language and segment; names, template and published state likewise. Blocks
  conflict as a whole property (`375`). Conflicts are resolved in the workspace, keeping
  mine or theirs per field.
- **A merged publish that would take Shared's unpublished drafts live** with it is a
  finding the person accepts by name.
- **`workspaces.required` covers pages** until media, types and files can be in a
  workspace (`376`, `377`).
- **A host can merge** through a minimal remote-protocol route.
- **Merging types and files** joins through per-kind handlers: those criteria move to
  `376` and `377`.
- **A Shared delete of a page a workspace changed** leaves a marker the merge must answer,
  as `376` does for types an administrator forces through.
- **A migration** (the next free number) keeps what `375` did not: the published state each
  page started from, where a moved page was, and the delete marker.

## Taken from `375`

- **A site can require a workspace for every edit** (`workspaces.required`). Shared then
  takes no direct edit of pages, media, schema or files, and changes only by a merge or
  an applied change (`383`). Someone who edits without choosing a workspace works in one
  of their own, opened for them, unnamed and theirs alone; publishing there goes to
  Shared as a one-page merge.
- **Ids interleave** between a workspace's rows and Shared's, so a merged change takes a
  new event id rather than only clearing `workspace_id`.

## Found in 375's code (2026-11-20)

- **The base published state is overwritten.** `#touch` copies Shared's published flags,
  then a workspace publish or unpublish replaces them, so a merge can't tell the
  workspace's change from Shared's. Keep the base state in columns of its own.
- **Pending rows lack their base:** where the page was (parent, order, event), so a
  merge can't tell whether Shared moved or edited it since. Several rows of one kind can
  gather for a page; the latest wins.
- **A Shared delete of a page a workspace changed** removes the workspace's rows with it.
  Leave a marker the merge must answer.
- **An upgrade never converts a workspace's values,** which are never current.
- **Merged changes take new ids** through Shared's own write path, rather than clearing
  `workspace_id`: Shared's reads and the draft cache's marker go by the newest id.

## Revised (2026-11-20, the maintainer's)

- **Files and types merge as files.** A workspace's schema TOML, components, stylesheets and
  scripts are merged three ways (the copy taken at open, the workspace's, Shared's now), then
  Shared's ordinary schema sync and checks run, and the files are written atomically. Pages
  still merge field by field.
- **"Update from Shared":** the same merge in the other direction, bringing Shared's changes to
  files and types into a workspace whose copy is frozen at open, with conflicts resolved there.

## Acceptance criteria

- [x] **With a workspace required,** a direct edit of Shared is refused through the API,
      and an edit in the back office lands in the person's own workspace.
- [x] **A merge lists what it will change** before changing anything. Each item's class
      comes with `382`.
- [x] **A workspace of pages** merges whole; a failure part-way leaves Shared as it was.
      Types and files join with `376` and `377`.
- [x] **Different properties of one page** changed in the workspace and in Shared merge
      without a conflict.
- [x] **The same property changed on both sides** is refused, named, and resolved in the
      workspace.
- [ ] **A component that no longer type-checks against Shared** refuses the merge and
      says where. Moved to `377`, with the files it checks.
- [x] **Pages under an approval workflow** merge as drafts and go live when approved.
- [x] **Webhooks, search and the published cache** follow the merge, once.
- [x] **Someone without the permission** is refused.
- [x] **Several workspaces merged as one** arrive together or not at all, and a conflict
      between them is named first.
- [x] **Publish in a person's own unnamed workspace** merges that page alone.
- [x] **Tests** on both dialects.

## Built (2026-11-20)

- **Migration 084 `AddWorkspaceMerge`** (`packages/data/src/schema/workspace-merge.ts`):
  the workspace's `state`, `merged_at`, `merged_by` and `personal`; the published state a
  page began from (`base_published` on `workspace_document` and
  `workspace_document_culture`); and on `workspace_pending`, where the page stood
  (`base_parent_id`, `base_sort_order`, `base_event_id`) and its `name`. `#touch` copies
  the base state once; `#recordPending` keeps one row per page and kind, the latest;
  `deleteNodeRows` leaves a `gone` row for each workspace that had changed a Shared page
  it deletes.
- **The repository reads a page three ways** (`DocumentRepository.workspaceMergePages`):
  every value by `alias|culture|segment`, `@name`, `@name:<iso>` and `@template`, as
  begun, in the workspace and in Shared now, with the published state per language,
  whether the workspace published its own version (`here`) and whether Shared has
  unpublished changes. `rebaseWorkspacePage` answers conflicts; `adoptWorkspacePage`
  makes a page made in a workspace Shared's; `WorkspaceRepository.pending`,
  `dropPending`, `dropPage`, `closeMerged` and `ownOf` go with them.
- **`threeWay` and `sameValue` moved to `@crombolo/core`** (`three-way.ts`), so an import
  and a merge share one rule. In it `mine` is what is there (Shared) and `theirs` what
  comes in (the workspace); transfer re-exports `threeWay`.
- **The plan is pure** (`packages/content/src/workspace-merge.ts`): `planWorkspaceMerge`
  takes, publishes, unpublishes, checks pending changes against where Shared has the
  page, and names findings (`publishes-shared-draft:<key>`, `unpublished-since:<key>`,
  `gone:<id>`); `mergeBlockers` and `fieldWords` say it in words.
- **The run** (`workspace-merge-run.ts`): `runWorkspaceMerge` takes one workspace or
  several, plans each against Shared as the ones before it left it, names a field two
  change differently first, and writes through Shared's own `update` (every value, as a
  save clears what it is not sent), `publish`, `unpublish`, `move`, `sort`,
  `moveToRecycleBin` and `delete`, recording each event through the Shared sink, in
  one `atomically`. `only` merges one page of a person's own and leaves it open;
  `rehearse` runs it all and rolls back.
- **The server** (`NodeOperations.merge` in `node-operations.ts`): approval-covered
  pages go through `approvals.send` after commit, and the published cache is
  invalidated. Routes in `workspaces.ts`: `GET|POST /{key}/merge`, `POST /merge`,
  `POST /{key}/conflicts`, `DELETE /{key}/pending/{id}`, `GET /mine`; `mergeRefusals`
  checks each change's verbs, start nodes and languages (`mayDocumentAt` in
  `authorization.ts`); `Crombolo.Workspace.Merge` (`WorkspacePermissions`) is group-wide,
  an administrator holds it. A merged workspace refuses the header with 409.
- **Required workspaces:** `CROMBOLO_WORKSPACES_REQUIRED` (`workspacesRequired`), refused
  at start without `CROMBOLO_WORKSPACES`. The scope refuses a page write naming no
  workspace; `Crombolo-Workspace: mine` resolves to the person's own, opened at their
  first write, and sends what a workspace cannot hold yet to Shared; a publish there
  merges that page alone or answers 409 saying why. The back office's
  `own-workspace.js` entry point sends `mine` on every Management API request when
  `GET /mine` says it is required.
- **The host:** the remote protocol's `workspaces/{key}/merge`, capability
  `workspace-merge` (`remote-workspaces.ts`), answered by the same routes.
- **Tests:** `tests/workspace-merge.test.ts` (the engine), `workspace-merge-api.test.ts`
  (routes, permissions, conflicts, pending, several, required, the remote),
  `workspace-merge-plan.test.ts` (pure) and `own-workspace-plugin.test.ts`.

## Left for later

- **Types and files merge** with `376` and `377`; the component check on the merged
  files with `377`; each item's class with `382`.
- **The back office has no merge screen** until its switch (`384`); a merge is made
  through the routes.
- **A merge is not yet recorded as a change** (`381`) or a transfer run: the audit log
  holds it, and each page's events hold before and after.
