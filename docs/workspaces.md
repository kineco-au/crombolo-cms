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
- **Media and Library items** (`390`), made, changed, moved, sorted and deleted as pages
  are; a media item's file is its own until the merge (below).
- **Languages, the dictionary, blueprints, forms and workflow set-up** (`392`): the first
  four as files in its copy, blueprints as pages are (below).
- **Not yet:** copying a page, bringing back an earlier
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
  with Shared's, and opening one builds nothing. The tree lives in the workspace's own
  process (below).
- **A process of its own (story 378).** A workspace that changed a view renders in a Bun
  child process (`workspace-processes.ts`, `workspace-render-child.ts`), started at its
  first render. It opens its own connection to the site's database and builds the
  workspace's published cache and views; the node resolves each page and settles who may
  see it, then hands the process the page's key and the request's plain values over
  Bun's IPC. It writes nothing. A template that never finishes, crashes or grows only
  ends that process: the page answers with an error naming the workspace, and the next
  request starts it again, while Shared's pages are served throughout. Its limits, each a
  setting:

  | Setting | Default | |
  |---|---|---|
  | `CROMBOLO_WORKSPACE_PROCESSES` | 10 | processes on a node; past it the least recently used is stopped |
  | `CROMBOLO_WORKSPACE_PROCESS_IDLE_MINUTES` | 30 | stopped after this long unused |
  | `CROMBOLO_WORKSPACE_PROCESS_MEMORY_MB` | 1024 | stopped past this much memory, reported every two seconds |
  | `CROMBOLO_WORKSPACE_RENDER_SECONDS` | 30 | one page's time; past it the process is stopped |

  A merge or discard stops it too. A database in memory (`CROMBOLO_SQLITE_FILE=:memory:`,
  as the unit tests run) cannot be opened from another process, so there the workspace
  renders on the node as before. Site search works in the process; a page's actions and
  signed deferred parts are Shared's renderer's.
- **A process that keeps failing is reported (story 396).** Each node records in the
  database which workspaces' processes it runs, and each failure: a process that exits on
  its own, a render over its time, or one that never comes up ready. A template that
  throws on one page is that page's error, not a failure, and a process stopped for
  idling, its memory or another workspace needing its place is not one either. Failures
  older than an hour are pruned. Each failure logs `workspace.process.failed` with the
  workspace's key, the node and the reason. `GET <plugin>/api/workspaces/processes`, for
  anyone with the Settings section, by cookie or bearer, answers for the whole site from
  any node: each workspace with a process on a node seen in the last minute, and each
  with three or more failures in the hour, as
  `{ key, name, owner, nodes, running, failing, failures, lastError, since }`. `/health`
  counts the failing ones in `workspaces: { failing }`, naming none, and stays 200: a
  workspace failing is its owner's to fix, not a reason to drain a node.
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

## Media and the Library (story 390)

- **Made and changed as pages are,** through the media and Library operations with the
  header (`WORKSPACE_OPERATIONS`): an item made there is a node of the workspace's own
  (`WorkspaceMedia`, `WorkspaceElement`), and a change to a Shared item is a version of
  the workspace's, its moves and deletes waiting for the merge. Their recycle bins, the
  Library's folders, copying a Library item and rolling one back are Shared's.
- **A file is placed as any upload is,** at a path never reused in the site's one store,
  and named only by the workspace's version: Shared's ownership index
  (`content.file_url`, `node_file`) is untouched, so Shared answers 404 for it, as for a
  missing file. The workspace's site serves it, crops and sizes included, because the
  workspace's own values name it. Where the store is read directly (a public bucket or a
  CDN), its random path is all that keeps it unseen.
- **The merge moves no bytes:** media and Library items merge before pages, through their
  own kinds' Shared writes, under the media tree's lock too; the merged save points the
  ownership index at the file. A file replaced on both sides is a conflict on its
  `umbracoFile`, settled by choosing one. A page merged alone (a person's own workspace)
  is refused while it uses an item only the workspace has.
- **Discarding** removes the workspace's items, then, once committed, each file its values
  named that nothing else in the site names.
- **With `CROMBOLO_WORKSPACES_REQUIRED`,** a direct media or Library edit is refused too.

## Languages, the dictionary, blueprints, forms and workflows (story 392)

- **Languages** are the workspace's copy of `schema/languages.toml`, read and written
  there by the language operations with the header. The merge brings the file in with
  the other definitions, and the sync applies it.
- **The dictionary** is a file of the workspace's own, `content/dictionary.jsonl`: one
  item per line, with its key, parent and translations, in name order. Until the
  workspace first changes it, it reads Shared's rows. It merges three ways by item:
  items changed on one side each come through, and an item changed on both is a conflict,
  settled by choosing one (`files/resolve`). The merge writes the result into Shared's
  rows in its own transaction. Exporting and importing a dictionary file are done in
  Shared.
- **Blueprints** are held as pages are: one made there is a node of its own
  (`WorkspaceDocumentBlueprint`), and a change to Shared's is a version of the
  workspace's, its delete waiting for the merge. Their folders, moves and history are
  Shared's.
- **Forms and workflows** are set up through Crombolo's own routes, which read and write
  `schema/` as files. With the header (the back office sends it on these calls too), a
  request runs against a folder holding the workspace's copy (`inSchemaPlace`), and
  whatever the request changed there becomes the workspace's files. A workflow changed
  in a workspace is not in force until the merge.
- **What a removal costs is checked against the site.** A language that holds values, a
  form field that entries hold, and a workflow with requests waiting under it each become
  a change that loses something (`language-values-dropped`,
  `form-field-entries-orphaned`, `workflow-requests-withdrawn`), and each is accepted by
  name before the merge goes ahead. Without data at stake they merge as they are.
- **The workspace's site** renders with its own languages and dictionary.

## Looking at a workspace (story 379)

- **Its own host.** With `CROMBOLO_WORKSPACES_HOST` set, such as
  `{workspace}.preview.example.com`, a request on a workspace's host (its key's 32 hex
  digits for `{workspace}`, and `{host}` for one of the site's own hosts) is answered from
  that workspace's site. Unset, a cookie on the site's own host switches the view; the
  site's own host with no cookie is Shared.
- **Its site** (`workspace-sites.ts`) is a published cache of its own over
  `DocumentRepository.inWorkspace(…).loadPublished()`: Shared's published pages, with
  each page the workspace changed as it has it. One it published is its own published
  version; one it changed but did not publish is as Shared had it published when the
  workspace first changed it; one it took down is not there; one it made and published is
  added. It renders with the workspace's views where it changed any, and serves its
  stylesheets and scripts at `/css/` and `/scripts/`. A request reads the workspace's
  revision (its newest event, its newest waiting change, its changed files) and the
  cache starts again when it has moved; nothing goes on the cache instruction stream. A
  node keeps `CROMBOLO_WORKSPACE_SITES` (3), each dropped after
  `CROMBOLO_WORKSPACE_SITE_IDLE_MINUTES` (15) without a visit.
- **Rendering, the Delivery API** and everything else handed the site's cache and
  renderer answer from the workspace while a request is served for it: the server's
  `cache` and `renderer` follow the request's scope.
- **Who may look:** a member, who gets in by `POST /{key}/open { path }`: a link with a
  signed token used once within five minutes and swapped for a host-only cookie, checked
  again on every request (still a member, still enabled, the workspace still open); or
  whoever holds a link a member made (`POST /{key}/links { days }`, at most
  `CROMBOLO_WORKSPACE_LINK_MAX_DAYS`, 30; 0 turns links off), reusable until it lapses or
  is withdrawn (`DELETE /{key}/links/{id}`), and no use once its maker leaves the
  workspace. Its secret travels once in the address, then as a cookie, or in
  `Crombolo-Workspace-Link` on a Delivery API call. A link is kept by the SHA-256 of its
  secret (`workspace_link`, migration 087). A stranger on a workspace's host is answered
  404.
- **Every answer** is `private, no-store`, `X-Robots-Tag: noindex, nofollow`, with no ETag;
  `robots.txt` disallows everything and there is no sitemap. A workspace's publish fires
  no webhook, runs no schedule and changes nothing in Shared's search (story 375).
- **The preview link** (`368`) takes a workspace: `{ document, workspace }` answers the
  handoff to that page on the workspace's site.
- **The site's own code runs as on the site:** routes and server actions on a workspace's
  host write to Shared, a form's entry included.

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
| `GET /{key}/render?path=/` | one page as the workspace's site renders it |
| `POST /{key}/open` `{ path }` | a member's link to the workspace's site, used once (story 379) |
| `GET /{key}/links` · `POST /{key}/links` `{ days }` · `DELETE /{key}/links/{id}` | links for someone else to look |

Each workspace answers its key, name, owner and members, its privacy, its state, `mine`
(the caller owns it) and `personal` (story `398`): `true` for a person's own unnamed
workspace, `false` for one opened by name, so a host listing them can leave out the
editors' own changes. The remote protocol's workspace routes answer the same.

Someone else's workspace answers 404, as one that is not there. An administrator may
list and discard any, to clear one left behind, and reads one they are not in only when
they ask to (story `401`): with `includePrivate=true` (the command line's
`--include-private`) they read the workspace, a person's own included, and its
`changes`, `merge` preview, `conflicts`, `diff`, `errors`, `pages`, `files`, `members`,
`render` and `POST check`, and open its site, honoured while they remain an
administrator. Writes stay with its owner and members, and `member` stays false.

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
says why. The merge raises `Crombolo.ChangePublished`, as a publish in Shared does, with
`From: "own-workspace"` (story `397`, [`webhooks.md`](webhooks.md)). Media, schema and files are not held by a workspace yet (`390`, `376`, `377`),
so they are still changed directly.

## Its life as events (story 400)

A workspace raises a webhook event as it is opened, merged, discarded, or comes into
conflict with Shared ([`webhooks.md`](webhooks.md)), each written to the outbox in the
transaction that does it, so a host follows workspaces without polling the list.

- **Every workspace raises them,** a person's own included, carrying `Personal`.
  A dry run of a change, staged and set aside again, raises nothing.
- **A conflict is found as Shared is written.** A write of a page, media or Library item
  asks each open workspace holding it how its merge would go for that item now; a write
  of a definition or another of the site's files is checked once the request that wrote
  it ends, when the file is in place, and a merge's files once they land. A conflict not
  raised before raises `Crombolo.WorkspaceConflicted`, naming the item.
- **Once until settled:** the items raised are kept (`workspace_conflict_raised`,
  migration 093). Answering a page's conflict, resolving a file, updating from Shared, or
  a later write that merges cleanly lets it be raised again; merging or discarding the
  workspace drops them.
- **What it costs:** a write no open workspace holds costs a query; one a workspace holds
  costs that workspace's merge plan.
- **The command line** writing Shared directly raises no conflicts: it is checked at the
  next write through the server.

## Known gaps

- The item classes a merge lists come with `382`.
- A template made in a workspace has no template row until it is merged, so a type
  there cannot allow it yet.
- Back-office search, the list view and a page's version history read Shared's.
- Site search on a workspace's site reads Shared's index.

## From the command line (story 386)

The `workspace` commands work in a workspace on this folder's site, through the remote
protocol's own routes in the command's process, or with `--profile <site> --env <env>` on a
hosted site's environment: `open`, `list`, `status`, `discard`, `share`/`unshare` (by email),
`diff` (`--against shared|base|<env>`), `sync`, `conflicts`, `resolve`, `check` (`--all`),
`errors`, `pages`, `render`, `address`, `merge` (several names as one, `--dry-run`,
`--accept-lossy`), `push --to` and `pull --from`; with `workspaces`, `changes` and `revert`.

- **Every command says where it acts** first, `<site> › <env> › workspace <name>` or `… (shared)`,
  and its `-o json` carries it as `where`. Nothing asks: `--yes` does what a dry run shows.
- **Exit codes say why:** 22 conflicts present, 20 a check failed, 23 a lossy change not
  accepted, beside the CLI's usual ones.
- **A profile names a site;** `--env` names the environment, required where it has more than
  one. A profile that still names an environment is refused, saying to add it again.
- **Locally, with workspaces on,** a page changed outside a named workspace goes into the
  person's own (`Changes by …`), named when it is pushed or merged.
- **`push` never merges:** it stages the workspace's change on the other site, where it is
  looked at and merged. `pull` brings the changes merged there that this site lacks, in
  order, or with a name one of its workspaces, to work on here.
- **A plugin's verb** acts under an environment with `onSite` and `siteFlags` from
  `@crombolo/cli/plugin`.
- **The routes** are the remote protocol's `workspaces` (`workspaces`, `workspaces/{key}/…`,
  the back office's workspace routes for the person), `changes/{id}` and `changes/{id}/revert`,
  and `PUT changes?check=true`, which says what applying a change would do and changes nothing.

## In the back office (story 384)

- **The switch at the head of Content** (`workspace-switch.js`, in the strip of
  `content-strip.js`): where this tab is, Shared or a workspace in its colour (from its key,
  `colourOf`), and from there: switch (the open screen reloads in that workspace), New
  workspace, Changes, Merge into Shared (for who may merge, with the count), Share, Open at
  its address, and All workspaces, open and merged. The choice is kept per tab in
  `sessionStorage` and sent as `Crombolo-Workspace` with every Management API call
  (`workspaces.js`, which takes over `own-workspace.js`'s header). Outside Content nothing
  is in a workspace; with workspaces off, none of this shows.
- **A workspace's privacy, its owner's** (migration 090): who can see it, its members or
  everyone who may edit (listed, its changes readable, changed only by its members), and
  whether someone opening an item it changed is told "Also changed in a workspace by …",
  never what changed (`GET /touched/{page}`). Both are chosen as it opens and later, by
  `POST /` and `PATCH /{key}` `{ visibility, tellOthers }`.
- **In the trees,** an item the workspace changed carries the `Crombolo.Workspace.Changed`
  flag, drawn as a sign.
- **The Changes panel** lists each change with what differs from Shared, and drops one
  (`DELETE /{key}/changes/{page}`); a page's Info sets its fields against Shared's.
- **The merge screen:** what it brings, each conflict with Keep mine and Keep theirs, the
  lossy changes to accept, and the pages sent for approval where a workflow applies.
- **Save in a new workspace,** on a page's actions, saves an edit begun in Shared in a new
  workspace the tab then works in. Where a workspace is required, Shared opened from the
  switch is read only.

