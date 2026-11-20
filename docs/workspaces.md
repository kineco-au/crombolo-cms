# Workspaces

A workspace is a place to change pages apart from what everyone else sees. Shared is
what the site holds and serves; a workspace is a named overlay on it, for one piece of
work, owned by the person who opened it and shared with the people they choose. Story
`375` built pages in a workspace, `380` merging one into Shared, `376` its types and data
types, and `377` its components, stylesheets and scripts. The stories after them
(`378`–`390`) add a process of its own, a workspace's own address, media and the back
office's switch.

Workspaces are off unless `CROMBOLO_WORKSPACES=true` (`workspaces: true` in
`crombolo.config.ts`). Off, every workspace route answers 404 and a request naming a
workspace is refused with 400, so nothing is silently written to Shared.

## What a workspace holds

- **Pages, changed and made.** A save, a publish and an unpublish in a workspace change
  only the workspace's copy. A page made in one is found in it and nowhere else.
- **Moves, reorders and deletes of Shared pages** are recorded as pending and done at
  merge. The workspace's tree does not show them yet. A page made in the workspace moves
  and goes for real.
- **Types and data types,** content, media and member types alike (`376`): a frozen copy
  of the site's schema files, and the workspace's own rows built from it (below).
- **Components, stylesheets and scripts** (`377`): a frozen copy of the site's, its
  changes rendered with its own views (below). Files the site reads only as it starts
  are carried to the merge.
- **Not yet:** media and Library items, copying a page, bringing back an earlier
  version, the recycle bin, publishing a whole branch, hostnames, who may see a page and
  notifications. Each is refused in a workspace with a reason, and done in Shared.
- **Never:** users, groups, members and settings. They are the site's.

## How it is stored

The model is in [data-model](data-model.md#values-are-append-only-and-versions-are-events):
values are append-only `property_value` rows, each the event (`content_version`) that
wrote it.

- **Opening one is a row** in `workspace`, with its owner; `workspace_member` holds who
  it is shared with. Nothing is copied.
- **A workspace's events and values sit in Shared's tables**, carrying `workspace_id`
  (null for Shared). Only the values a save changed are written, over the Shared event
  the page started from: its base, kept in `workspace_document` the first time the
  workspace writes the page, with where the page stands there.
- **A workspace's rows are never current.** `content_version.current` and
  `property_value.is_current` stay Shared's, so everything that reads the current draft —
  search, relations, references, tags, list views — cannot see a workspace.
- **Every Shared read of history** ("latest as of an event", "the newest by id") is
  filtered to `workspace_id IS NULL`: page reads, a page's revision (so a Shared editor's
  copy is never made stale by a workspace save), publishing, the published cache, site
  search, clean-up and schedules. `tests/workspaces.test.ts` holds each of these.
- **A page made in a workspace** has a node carrying it and an object type of its own
  (`ObjectTypes.WorkspaceDocument`), so Shared's node queries, which name their type,
  never return it.
- **Per-language state** is `workspace_document_culture`, a copy of the page's
  `document_culture_variation` rows taken when the workspace first writes it.
- **Pending moves, reorders and deletes** are `workspace_pending` rows, with where the
  page stood when each was recorded (`base_parent_id`, `base_sort_order`,
  `base_event_id`), so a merge can tell whether Shared moved or changed it since; the
  latest of a kind stands for the page. A Shared page deleted with a workspace's page
  beneath it leaves that page at the top of the tree, marked `orphaned` for the merge.
- **The published state a page began from** is kept apart from the workspace's own
  (`workspace_document.base_published`, `workspace_document_culture.base_published`), so
  a merge tells what the workspace published from what Shared did.
- **A Shared delete of a page a workspace changed** leaves a `gone` row, with the page's
  name, that the merge must answer (migration 084).
- **Clean-up** leaves a workspace's events alone, and keeps every Shared event an open
  workspace started from.
- **Discarding** removes, in one transaction under the content tree's lock, every row
  carrying the workspace and the pages made in it.

## Types and data types (story 376)

- **A copy of the schema files, frozen at open.** Opening a workspace lists Shared's
  schema files (the `schema/` folder, or, where a site has none, its definitions exported
  as files) in `workspace_file`, each by the SHA-256 of its text, the text kept once in
  `file_blob` however many workspaces hold it. The hash then is each file's merge base.
- **Rows of its own, built at its first schema save.** Until then a workspace reads
  Shared's types as they are now. Its first type or data-type save syncs its copy of the
  files into rows of its own (`syncSchema` with `workspace`: types and data types only,
  no schema state, languages, URL options, workflows, groups, folders, template rows or
  cache instruction), and from then on its types are its copy's, untouched by Shared's
  later changes until it is brought up to them.
- **A copy is a node and keys of its own.** Each copied type or data type has a node of
  its own object type (`WorkspaceDocumentType`, `WorkspaceMediaType`,
  `WorkspaceMemberType`, `WorkspaceDataType`), stored under a key derived from the
  workspace's and its own (`workspaceRowKey`), with `workspace_id` and the key it stands
  for (`origin_key`); its properties and groups likewise. Shared's alias index covers
  Shared's rows only. `ContentTypeRepository` and `DataTypeRepository` in a workspace
  (`inWorkspace`) read and write it under the keys it stands for, so the API, the files
  and a page's type key are the same as Shared's.
- **Pages read through it.** A page's type resolves to the workspace's copy where it has
  one, and a copied property reads and writes the Shared property's values while they
  are stored the same way, so Shared's values show through and a merge maps nothing. A
  property whose storage changed reads empty there, as its class says.
- **A save writes the copy of its file,** canonically, as Shared's back office writes
  Shared's, with the class of the change (`none`, `additive`, `data-requiring`,
  `breaking`). It is checked against the workspace's own definitions (story 344's
  check), and refused where the site's schema files are read-only.
- **With the header,** the type and data-type operations listed in `WORKSPACE_OPERATIONS`
  work in the workspace; copying, moving, importing, folders and making a template are
  refused (`WORKSPACE_REFUSALS`); the trees, item lookups, search and configuration are
  the site's (`WORKSPACE_SHARED_SCHEMA_READS`). A guard test holds every type and
  data-type operation to one of the three.
- **Merging** merges each changed file three ways (its text at open, the workspace's,
  Shared's now) by line (`node-diff3`). Changes that don't overlap merge; a file with an
  overlap is a conflict that refuses the merge, naming the file. The merged files are
  synced into Shared on the merge's own transaction, under the schema lock, the version
  moved by the greatest class, before the workspace's pages are written; then written
  into `schema/`, and put back if the merge is undone. A page made of a type made in the
  workspace moves onto Shared's type of that key.
- **Update from Shared** (`POST /{key}/update`) is the same merge the other way: each file
  Shared changed since the workspace's base is merged into the workspace's, which takes
  Shared's as its new base; where the two overlap, the workspace keeps its own and the
  file stays a conflict. A conflict is answered with `POST /{key}/files/resolve { path,
  side | text }`, which takes Shared's file as the base and the workspace's, Shared's
  or the given text as the workspace's.
- **A Shared delete of a type or data type an open workspace changed** is refused, 409,
  naming no workspace; an administrator may force it (`?force=true`), and the
  workspace's merge then finds the file changed on its side and removed on Shared's: a
  conflict to answer.
- **Discarding or merging** removes the workspace's copies, its file list, and every
  kept text no list names.

## Components, stylesheets and scripts (story 377)

- **A full copy, frozen at open,** in the same file list as the definitions:
  `components/…`, `stylesheets/…`, `scripts/…`, each text kept once by hash, so
  opening a workspace on a site of thousands of files lists them and copies no text
  another workspace already holds. A file of more than a megabyte is not copied, and is
  refused on save.
- **With the header,** the partial-view, stylesheet and script operations read and write
  the workspace's copy (`createWorkspaceFilePort`); folders are made and removed in
  Shared, and the id-addressed template writes are refused, as a workspace changes a
  template through its file. A component that does not compile is refused on save,
  saying the line. Where the site keeps these files read-only (story 337), a workspace
  may not change them either.
- **Its own views.** A workspace that changed a component renders with a tree of its
  own (`workspace-views.ts`): its whole copy of the components written into a folder
  under `<componentsCacheDir>-workspaces/<key>/`, with a snapshot over it, so an
  unchanged template importing a changed component renders the changed one, and each
  save is read fresh at a new path with nothing restarted. One that changed none renders
  with Shared's, and opening one builds nothing. A process keeps at most
  `CROMBOLO_WORKSPACE_VIEWS_LIMIT` trees (50), dropping the least recently used, until
  story `378` gives each workspace a process of its own.
- **`GET /{key}/render?path=/`** renders one page with the workspace's views on Shared's
  published content, for its members, until the workspace has an address of its own
  (`379`), which also serves its stylesheets and scripts.
- **Files the site reads only as it starts** (its `package.json` and lockfile,
  `crombolo.config.ts`, routes, jobs and middleware) are carried by an administrator with
  `PUT /{key}/site-files { path, text }` and listed as taking effect at merge.
- **Merging** merges each file three ways as for definitions, then compiles and imports
  Shared's components with the merged ones laid over them, refusing where one would
  break and saying where; then writes every file where it lives, put back if the merge is
  undone, and tells every node to take a new generation of the views. Merging
  templates, stylesheets or scripts needs Code; a file the site reads at start, an
  administrator.

## Over HTTP

The routes are crombolo's own, at `<backoffice>/crombolo/api/workspaces`
(`packages/server/src/workspaces.ts`), for people with the Content section:

| | |
| --- | --- |
| `GET /` | yours: those you own or are a member of; `?all=true` every one, for an administrator |
| `POST /` `{ name }` | opens one |
| `GET /{key}` · `PATCH /{key}` `{ name }` · `DELETE /{key}` | reads, renames (its owner), discards (its owner, or an administrator) |
| `POST /{key}/members` `{ userKey }` · `DELETE /{key}/members/{userKey}` | shares it, and stops (its owner) |
| `GET /{key}/changes` | each page it changed or made, and each pending move, reorder or delete |
| `GET /{key}/merge` | what a merge would do: each page and the fields it takes, what it publishes, what waits, conflicts, findings, and what the caller may not do |
| `POST /{key}/merge` `{ accept?, rehearse? }` | merges it (see below); `rehearse` runs it all and undoes it |
| `POST /merge` `{ workspaces, accept? }` | merges several as one |
| `POST /{key}/conflicts` `{ page, answers }` | answers a page's conflicts in the workspace, `mine` or `theirs` per field |
| `DELETE /{key}/pending/{id}` | drops a pending move, reorder or delete, or a `gone` marker, so it does not go |
| `GET /mine` | whether the site requires a workspace, and the caller's own |
| `GET /{key}/files` | each definition file it changed, with its class, and what conflicts with Shared |
| `POST /{key}/update` | brings Shared's later changes to the definitions in (story 376) |
| `POST /{key}/files/resolve` `{ path, side \| text }` | answers a file's conflict |
| `PUT /{key}/site-files` `{ path, text }` | carries a file the site reads only as it starts to the merge (an administrator) |
| `GET /{key}/render?path=/` | one page as the workspace's views render it |

Someone else's workspace answers 404, as one that is not there. An administrator may
list and discard any, to clear one left behind, and reads none.

**The Management API takes the workspace as a header:** `Crombolo-Workspace: <key>`.
The router asks once the request is authorised:

- on a page read or write (`WORKSPACE_OPERATIONS` in
  `packages/api-management/src/document-writes.ts`) the handler runs with the workspace
  held for the request;
- on what a workspace cannot hold yet (`WORKSPACE_REFUSALS`) it answers 409 with the
  reason;
- on anything else, which is the site's, the header changes nothing.

The workspace reaches the data layer explicitly. Only the server's document port and
operations read the one held for the request (`inWorkspaces`), and they hand it to
`DocumentRepository.inWorkspace` and `createWorkspaceOperations`; nothing in
`@crombolo/data` or `@crombolo/content` reads request-wide state.

**A workspace's change is audited, naming the workspace, and announced nowhere else:**
no webhook, outbox event, notification, live back-office event, redirect, cache
instruction or approval gate. Its work reaches anyone else only by its merge (`380`),
which is where an approval applies.

## Merging

A merge (`packages/content/src/workspace-merge.ts` plans it, `workspace-merge-run.ts`
runs it) is all of a workspace or none of it, in one transaction under the content
tree's lock:

- **Per field, three ways.** Each value (by property, language and segment), each name
  and the template are compared as the page began (`base_event_id`), as the workspace
  has it, and as Shared has it now, by the rule a content import uses (`threeWay` in
  `@crombolo/core`). A field only one side changed comes from that side; one both
  changed differently is a conflict, and the merge is refused naming it.
- **A conflict is answered in the workspace:** `POST /{key}/conflicts` takes `mine` or
  `theirs` per field, and the page begins again from Shared's latest, keeping the
  workspace's value or taking Shared's, so the next merge finds nothing to ask.
- **Replayed through Shared's own writes,** as new events with new ids: a save sending
  every value, then publish or unpublish per language as the workspace left them, then
  each pending move, reorder and delete. A page made in the workspace becomes Shared's,
  parents first. Anything refused, a page's validation included, undoes all of it.
- **Findings are accepted by name or kind** (`accept`): publishing a page whose Shared
  changes were not published, publishing a page Shared took down since, a page Shared
  deleted, and (story 382) each page the workspace deletes (`page-deleted`) and each
  change to its files that loses data, removes or renames, listed in the preview's
  `files.items` with its class and the pages a lossy one touches
  ([schema-as-code](schema-as-code.md)). A pending change Shared moved past (a move of a page moved since, a delete
  of one changed since, a page left `orphaned`) cannot go as it is; move it again in
  the workspace or drop it.
- **It needs `Crombolo.Workspace.Merge`,** which an administrator holds, and each
  change's own verbs at its place: Update or Create, Publish, Unpublish, Move (and
  Create where it goes), Sort or Delete, with the person's start nodes and languages,
  so a merge never does what they could not do directly.
- **A page a workflow covers** is saved in Shared as a draft, and its publish or
  unpublish is sent for approval once the merge commits.
- **What follows a Shared write follows the merge, once:** each page's event goes
  through Shared's event sink (webhooks, search, the outbox) and the published cache is
  rebuilt.
- **The workspace closes:** every row carrying it goes, and it stays listed as
  `merged`, with when and by whom. It takes no more edits.
- **Several at once** (`POST /merge`) are all merged or none: a field two of them
  change differently is named before anything is written, and each is planned against
  Shared as the ones before it left it.
- **A host** merges through the remote protocol's `workspaces/{key}/merge`
  ([remote-protocol](remote-protocol.md#workspaces-workspace-merge-optional)).

## Requiring a workspace

With `CROMBOLO_WORKSPACES_REQUIRED=true` (and workspaces on), Shared takes no direct
change to a page: a page write naming no workspace is refused with 409. The header's
`mine` names the person's own workspace, unnamed and theirs alone, opened at their first
change; the back office sends it on every request (`own-workspace.js`), so an editor's
change lands there. Publishing a page there merges that page alone, at once, where the
person may make each of its changes; otherwise it stays published there and the answer
says why. Media, schema and files are not held by a workspace yet (`390`, `376`, `377`),
so they are still changed directly.

## Known gaps

- The back office cannot send the header until its switch (`384`), so today a named
  workspace is worked in through the API; only a person's own is used by the back office.
- The item classes a merge lists come with `382`.
- A template made in a workspace has no template row until it is merged, so a type
  there cannot allow it yet.
- Back-office search, the list view and a page's version history read Shared's.
- A workspace is not served or previewed yet (`379`).
