# Changes

Every change to a site is recorded (story `381`): a merged workspace, a definition or a
file edited straight in Shared, an applied bundle, and a revert. One history holds them
all, as the runs an applied bundle has always written (`content_transfer_run`), so a
change's pages are recorded the way a bundle's are, and reverted the same way.

## What a change holds

- **Its name, its identity and who made it:** a merge is named after its workspace, made
  by the workspace's owner and applied by whoever merged it; a direct edit is its
  author's. Its identity (`change_key`) is the one it will carry to another site (`383`).
- **Each file it touched,** a type's or data type's file included, as a `change_item`
  with its text before and after, kept once by hash in `file_blob` with the workspaces'
  files. A file's versions are the changes that touched it, oldest first; nobody numbers
  anything.
- **Each page it touched,** as the run's `content_transfer_change` rows: the event the
  page was at before, the one it was serving, and the one the change wrote.

## Direct edits

A type, a data type, a component, a stylesheet or a script saved straight in Shared is
recorded as a change by its author, with the file's text before and after (a type as
the schema writes its file). So are a language (`schema/languages.toml`), a form or a
workflow (its file under `schema/`), and the dictionary, as the file a workspace holds
it in (`content/dictionary.jsonl`, one item per line); a blueprint is listed as a page
is (story 392). A person's edits gather in one change until ten minutes
pass with none (`EDIT_WINDOW_MS`); then it closes and the next opens. Their page edits
in that time are listed on it too (story 388): each page as it stood before their first
save there and as they left it.

With `CROMBOLO_WORKSPACES_REQUIRED`, Shared takes no direct edit of a page, a type, a
data type or a file: everyone works in a workspace, and what they may change there is
what their permissions allow.

## Over HTTP

At `<backoffice>/crombolo/api/changes`, for people with Content:

| | |
| --- | --- |
| `GET /` `?skip&take` | the changes, newest first: kind (`merge`, `edit`, `bundle`, `revert`), name, who, when, how many files and pages |
| `GET /{id}` | one: each file with its text before and after, each page and what it did, and a direct edit's page saves counted |
| `GET /versions?path=` | a file's versions: each change that touched it |
| `GET /{id}/compare?path=` | that change's version of the file against the file now |
| `POST /{id}/revert` `{ toWorkspace? }` | puts it back, as a change of its own (an administrator) |
| `POST /check` `{ since?, all? }` | checks what the site shares as a whole (below) |

### Shared checked since a change (story 406)

A workspace's check covers that workspace. Once work is merged, two workspaces that
each passed can break a page between them, so Shared has a check of its own:
`POST /check { since }` renders every page affected by the changes after `since`, a
change's id, as Shared serves it.

- **What is rendered:** each page those changes changed, and up to three pages of each
  type and each view whose file they changed, found as a workspace's affected pages
  are. With no `since`, or `all: true`, every published page. Only published pages are
  rendered, and no cache is read or written.
- **As it is now:** a merge tells every node of its views, and a check asked at once
  would render the ones before. The node answering first takes what it has been told
  and reads the views again.
- **"After" is by when a change was last added to,** not when it began: a person's
  direct edits share a change for ten minutes, so one begun before `since` can gain
  items after it. A change still open when it was taken as `since` is not itself
  checked again.
- **The answer** is a workspace check's shape, with what it covered:
  `{ ok, since, upTo, changes, pages, failures, notChecked }`. A failure is a page that
  did not render (`kind: "page"`) or a view that does not compile (`kind: "file"`),
  looked for when a change touched `components/`. `upTo` is the newest change covered.
- **No more than 500 pages** are rendered in one check; the rest are counted in
  `notChecked`, with any file under `site/` that takes effect only when the site next
  starts.
- **What a check makes of a page** (story `418`), the same in this check, a workspace's
  and the errors `render` notes: a page of a type with no template (as a headless site's
  are) is not checked and does not fail; a page of a type with templates and none chosen
  fails, "It has no template chosen."; a page only members may see is rendered as a member
  of the groups it allows would see it. Each failure says what went wrong in words.
- **`notChecked` is a list of `{ kind, item, why, says }`** (story `418`; a list of
  sentences before 0.78.0): `kind` is `page`, `file` or `site`; `why` is `no-template`,
  `not-published` or `over-the-limit` for a page, `at-merge` or `at-start` for the rest;
  `says` is a sentence to show.
- **A `since` the site does not hold** answers 404. A change applied from another site
  is known by the key it travelled with as well as its id here.

The remote protocol answers the same at `POST …/changes/check`, and the command line
asks it: `crombolo changes check --since <change>`, or `--all`, exiting 20 when a check
fails.

### Moving a change without the remote

A change moves between copies of a site through the Management API as well, with the
remote switched off (story `394`). These routes take a sign-in token in
`Authorization` only: a person's own, a command-line token, an API user's, or one
exchanged through a provider. A request carrying only the back office's cookie is
refused, so another page in someone's browser can't send one. They don't need the
Content section, only the remote's rights:

| | |
| --- | --- |
| `GET <backoffice>/crombolo/api/changes/{id}/bundle` | a recorded change, as the tarball the remote gives, with `Crombolo-Sha256`. Needs *Pull* |
| `GET <backoffice>/crombolo/api/workspaces/{key}/change` | an open workspace, as the change its merge will be. Needs *Pull* |
| `PUT <backoffice>/crombolo/api/changes` | a change, with `?check`, `?stage`, `&into`, `&editable` and `?accept` as on the remote. Needs *Apply changes*, and *Install code* when it carries templates or the site's own code |

- **The same limits:** `Crombolo-Sha256` is required and checked, and the body is
  streamed to disk up to `CROMBOLO_REMOTE_MAX_UPLOAD_GB`. The rights are checked before
  any of it is read.
- **The same answers,** in the Management API's shape: a refusal is
  `{ message, detail?, refusals? }`; a staged change is `{ workspace, skipped,
  conflicts }`, and an apply its outcome, as the remote answers them.
- **`CROMBOLO_REMOTE_ACCESS` governs the remote alone.** At `off` or `read`, these
  routes still take changes. What holds them is the rights, the setting below and the
  content lock.
- **Applying only by an exchange.** With `CROMBOLO_APPLY_CHANGES_BY=exchange`, *Apply
  changes* is honoured only for a sign-in exchanged through a provider's
  `remoteExchange.applyAudience` (story `364`), here and on the remote alike. A
  person's own sign-in, however their groups are set, can then not stage or apply a
  change, and the host's tool that exchanges for them decides when it happens.
- **The record** names the person, as the remote's import does, and a staged workspace
  is theirs.

## Reverting

A revert is a change of its own, and can itself be reverted. Its pages go back through
the revert a run has (`revertRun`), which refuses where a page was edited since; its
files go back to their text before the change, synced and written as a merge's are. It
is refused where a later change, still applied, touched the same file or page, naming
them; a later change since reverted no longer stands in the way. With `toWorkspace`, the
work is reopened as a workspace holding the change's files and pages as it left them,
to carry on with and merge again. An applied bundle is reverted with `crombolo content
revert`.

## Between sites

A change moves from one copy of a site to another (story `383`), over the remote
protocol's `changes` routes ([`remote-protocol.md`](remote-protocol.md)) or the
Management API's (above, "Moving a change without the remote").

- **A change bundle** is a private package like any site export: `package.json`, a
  `bundle.json` typed `change` with the one integrity hash over everything and the
  package's identity, `change.json`, and the media files it added or replaced under
  `media/` (`@crombolo/transfer`'s `writeChangeBundle`, `readChangeBundle`). It carries
  the change's identity, the changes it depends on, each file with its text before and
  after, and each page, media item or Library item with its values, names and
  publishing before and after, matched on another site by key. A page the change
  deleted is kept among its items as it stood, since a delete takes its history.
  Languages, forms, workflows and the dictionary travel as files, blueprints as pages
  (story 392); on the target the dictionary merges by item, against its rows.
- **Its dependencies are named per item:** each item says which change last touched it
  where the change was made, and the change lists those and the changes that made what
  its values refer to. A target missing one refuses only an item that is not as the
  change found it, naming the missing change.
- **Staged** (`?stage=true`), it is a workspace on the target, read-only, its owner
  whoever staged it: each file put in with the change's *before* as its base and its
  *after* as its text, so the merge goes three ways against the target's now; each page
  with only the fields the change altered. A field the target changed since, a page made
  separately at the same address, a delete of a page edited or still used there, or a
  move of a page moved there since, is a conflict. Its address serves it (`379`), and its
  merge applies it, recording the change under its own key with every change it holds
  in `applied_change` (migration 088), so a change is applied once. Several can be
  staged into one (`&into=`) and applied together. Each is staged over what the ones
  before it left (story `421`): a change staged there counts as held for a later one's
  `depends`, a page is looked for in the workspace before Shared, so one an earlier change
  made is changed or deleted there rather than made twice, and staging a change already
  staged there skips it. A page that cannot be staged is a conflict naming it.
- **Refused when it needs what the site lacks** (story `403`): a new page whose content
  type is neither here (by key or alias), in the workspace it goes into, nor carried by
  the change, or whose blocks name an element type this site has not got, is refused
  before anything is staged (409), each named ("needs the document type "event", which
  this site does not have"). Staging, applying and `check` alike. A page whose type is
  here under its alias but another key is staged with this site's.
- **Applied** (`PUT changes`), it is staged and merged at once. A conflict leaves the
  workspace open to edit, holding the change, and changes nothing in Shared; a finding
  (`382`) is counted against the target and refused until accepted there (`?accept=`).
- **An open workspace** exports as the change its merge will be, under the workspace's
  key, since a whole workspace's merge takes its key as its change's.
- **Page edits since a point** export as one change, each page as it stood then and now.
- **A whole site** applied into a site with no pages is its first change (`bundle`); over
  one holding pages, it is recorded as `replace`.

### A site bundle staged as a change (story 399)

A pipeline whose checkout has no database stages what it holds into a workspace on a
site, to be looked at and merged there like any other change, rather than replacing
the site. The site works out the change itself, measured from a base.

- **`PUT <backoffice>/crombolo/api/changes/from-site?source=&into=&base=&prune=&check=`**,
  and the remote protocol's `changes/from-site`, take a site bundle (`application/gzip`,
  `Crombolo-Sha256`, the upload limit), with the rights `PUT changes` needs: *Apply
  changes*, and *Install code* when it changes templates or the site's own code.
- **What travels:** its definitions, components, stylesheets and scripts, its dictionary
  (as the workspace keeps one, `content/dictionary.jsonl`, merged by item), and its
  pages, media items (with their files), Library items and blueprints. Its code,
  `public/` and Library folders are left out and listed (`leftOut`).
- **The dictionary is measured item by item** (story `402`): an item whose key the site
  has not got is matched to the site's item of the same name; a translation for a
  language the site lacks is dropped and listed (`dictionary: Greeting (fr-FR)`); and an
  item the base has and the bundle lacks is kept unless `prune`, when its removal is
  accepted at the merge (`dictionary-item-removed`).
- **The base is a source's last merge.** `source` names where it comes from. When a
  change staged from it merges, the site keeps the bundle's items as they were in it
  (`change_source`, migration 094), and the next staging from the source measures from
  them: a later edit in Shared to an item the bundle left alone is kept, and one to an
  item it changed is a conflict. A staging discarded, or staged again before it merged,
  leaves the base as it was.
- **The first staging from a source** names its base: `base=now`, the site as it is, or
  `base=<change key>`, the site as that change left it. Without one it is refused (409).
  Either may be given later too, in place of the source's.
- **Nothing is deleted unless asked:** with `prune`, an item the base had and the bundle
  lacks is deleted in the change, and the merge asks for each to be accepted.
- **`into`** names an open workspace, by key or name, or a name to open one with. Staging
  again from the same source replaces the workspace it staged before.
- **`check=true`** says what staging would do, as `PUT changes?check=true` does, and
  stages nothing.
- **From the command line:** `crombolo changes stage <path> --into --source [--base]
  [--prune] [--dry-run]`. The path is a site bundle's `.tgz`, its folder, or a site's
  checkout, which is built into a whole-site bundle of its files first: its schema,
  components, stylesheets and scripts, and its `dictionary.toml` when it keeps one (as
  `crombolo dictionary export --out dictionary.toml` writes it), with no pages and no
  database.

### Levelling a site first

A site whose Shared holds schema or content made before workspaces were on has no change
that carries it, so changes moved from it later can refer to what never travelled. Bring
the target level first with the whole site as one change: export it
(`crombolo site export --out site.tgz`) and stage it on the target with
`changes/from-site?source=baseline&into=Baseline&base=now`, then look at it and merge it.
Changes move as usual after that. A change that still needs what the target lacks is
refused, naming it (story `403`).

### Pending workspaces

An administrator sees every open workspace, staged changes included, with its owner, its
age and when it was last written in, at `GET <backoffice>/crombolo/api/workspaces/pending`,
and discards those idle longer than a number of days in one step with
`POST /pending/discard { olderThanDays }`. The back office (`384`) and the command line
(`386`) use these.

## A site made in one place and served from another

With `CROMBOLO_CONTENT=locked` (story `388`), a site takes its pages, media, Library
items, types, data types and code only by a change applied to it: the back office and
the Management API refuse every write of them (409, "This site takes its content by
change"), and opening a workspace is refused. Applying a change (`PUT changes`, Apply
changes) and merging a change staged there still write. Members and their groups, form
entries, what visitors upload, the redirects it records, its jobs and its logs are
written as before. Locked content locks the code too, as `CROMBOLO_CODE=locked` does.
Languages, the dictionary, blueprints, form definitions and workflow set-up stay
writable until changes carry them (story `392`).

In the back office each page, media item and Library item opens read-only, its Info tab
saying where it is edited, with a link to the same item there when
`CROMBOLO_CONTENT_EDITED_AT` names that site's back office address.

Every write a locked site refuses names that address too (story `412`): pages, media,
the Library, types, data types, code files, an environment's values and opening a
workspace each answer 409 saying "This site's content is edited at <address>. Changes
reach it from there.", with the address as `editedAt` beside the title and detail. In
the back office a notice beside the refused save says the same and links to the same
item there. Only an `http` or `https` address is made a link. With no address set,
each refusal keeps its old words. A site with only its code locked
(`CROMBOLO_CODE=locked`) keeps its own words, since the address names where content is
made.

On the site where content is made, a person's publish closes their change, so it holds
what they changed and is finished, and raises `Crombolo.ChangePublished` naming it
([`webhooks.md`](webhooks.md)): a host subscribed to it can take the change
(`changes/{id}/bundle`) and apply it to the serving copy at once. Their next edit starts
another change.

An unpublish, a move, a reorder and a delete close the change and are announced the same
way, with `Change.Kind` saying which (story `411`):

- **What the change holds:** each page's place before and after (`places/<key>`: its
  parent, whether it was published, whether it was in the recycle bin), and for a reorder
  the parent's children before and after (`orders/<key>`, `orders/root` for the top
  level). A page deleted keeps its last state (`pages/<key>`), as a merge's delete does.
- **In the bundle:** an unpublish is `before.published: true`, `after.published: false`; a
  move is `beforeParentKey`; a restore is `restored: true`; a delete is `action:
  'delete'`; a reorder is `orders: [{ parentKey, keys, before }]`.
- **Applied on the other site,** each does the same there: the page is unpublished where
  it is published, moved where it is still where the change found it, put back from the
  recycle bin (or made again, if deleted there for good), deleted once `page-deleted` is
  accepted; the parent's children it has are put in the change's order, the rest after.
  A parent reordered there since the change began is a conflict, as a moved page is.
- **A page keeps its place** (story `425`). A change that makes a page, or moves one to
  another parent, holds that parent's children in order then (`siblings/<key>`,
  `siblings/root`), and its bundle carries them on the page (`siblings`). Taken on another
  site, the page is put after the nearest one before it that the site has, else before
  the nearest after it; the others keep their order, and it is never a conflict. So pages
  that arrive in another order than they were made end in the order they were made in.
- **Where content is locked, a reorder is always applied** (story `425`): nobody reorders
  there, so another order is only pages having arrived in another. A site that is not
  locked still answers a conflict.
- **The recycle bin is the delete.** Emptying it announces nothing more; restoring from it
  is announced as a move.
- **In a person's own workspace,** done to a page Shared has, each merges that page at
  once (a reorder, the parent's children) and is announced with `From: own-workspace`;
  done to a page made there and never merged, it stays there and nothing is announced.


### What the served copy holds

A host that applies each published change to the serving copy tells the making copy
which ones it applied (story `395`), so editors there are offered only what is live:

- **`PUT <backoffice>/crombolo/api/changes/served { "key": "<change key>" }`** reports
  one change applied there, pages included, and `GET` answers
  `{ newest: { key, name, reportedAt } | null, waiting }`, `waiting` counting the
  changes to schema not yet reported. Both need the Apply changes right and a sign-in
  token in `Authorization`, as `PUT changes` does. Reports are a set, not a single
  mark, since a page goes out at once and a release later: schema is served when the
  change that last touched it is reported, or came before the oldest one reported.
- **From the first report, schema is built in a named workspace.** A change to a type,
  data type, template, component, stylesheet or script with no workspace, or in a
  person's own, is refused (409, "Build this in a workspace"). The command line and
  installed code are not refused.
- **Schema merged but not served** stays in the Settings tree. Outside a named
  workspace it is left out of the types offered for a new page or Library item
  (`allowed-at-root`, `allowed-children`, `allowed-in-library`), and, for a request
  that says it is making content (`Crombolo-Purpose: content`, which the back office
  sends outside Settings), of a type's templates and a block editor's blocks. Only
  what the served copy does not have at all is left out; a type changed since is
  offered as it is now. A named workspace is offered everything.
- **A page using anything not served** still saves and publishes, and its
  `Crombolo.ChangePublished` lists the changes it `Needs` and what for
  ([`webhooks.md`](webhooks.md)), so a host can hold it for the release.
- **Setting or clearing a schedule** closes the person's change and raises the event,
  as a publish does. The change carries the page's schedule, and applying it sets the
  same schedule there, which fires at its time.
- **An approval passes the editor's change on** (story `413`): the approval's publish,
  take-down or time closes the editor's change and raises the event, naming the approver
  (`ApprovedBy`) and the workflow ([`workflows.md`](workflows.md)).
- **A change that only schedules says so** (story `417`): `Change.Kind: "schedule"`, with
  the times as `Change.Schedule`. A publish that also sets or clears a time (live now,
  down on Friday) says no kind and carries `Change.Schedule` too. Clearing a time through
  the Management API's publish publishes the page now, so it is told as a publish with an
  empty `Schedule`.
- **A schedule set in a workspace goes with its change** (story `414`). A merge sets
  each page's schedule in Shared as the workspace has it, a cleared one cleared, and its
  change holds it as one set in Shared does. Set or cleared in a person's own workspace,
  it merges that page at once and raises the event with `From: "own-workspace"`, though
  nothing is published yet; a page made there arrives unpublished, with its schedule. A
  schedule Shared changed since the workspace set its own is a conflict, settled by
  accepting `schedule-changed`, which keeps the workspace's.
- **A staged change's schedule is set by the merge** (story `423`), however the workspace
  it was staged in is merged: `PUT changes` with no `stage`, `POST workspaces/{key}/merge`,
  the back office or the command line. It replaces what Shared had for the page, names
  the change that carried it when it fires, and is held by the change the merge makes,
  so a site taking it from here has it too. A rehearsal sets nothing.
- **A schedule never publishes a page a workflow covers** (story `423`). Where a merge
  brings a time for such a page, from a staged change or a workspace, the time is not set
  on the page: it goes with the approval request the merge sends, and takes effect once
  that is approved (at once, when the time has passed by then). Where the workflow takes
  no time, the request's comment says when it was to be.
- **Both sites fire a schedule,** each its own, at the same instant: times are kept and
  carried in UTC. As it fires, each raises the page's ordinary webhooks and
  `Crombolo.ChangePublished` naming the change that set it (`Kind: "unpublish"` for a
  page coming down). A host taking that change again finds it applied already.
- **A publish in a person's own workspace** (story `397`), which merges that page alone
  into Shared, raises the event for the merge's change, with `From: "own-workspace"`. A
  named workspace's merge raises none: it waits for a release.
- **The event says who made the change:** `By: "person"`, or `"tool"` for a sign-in
  exchanged with an actor (story `364`), named in `Tool`.
- **A host leaves the person a notice** of how it went with
  `POST <backoffice>/crombolo/api/notices { user, message, link?, kind }` (`kind` is
  `success` or `failure`; `link` a back office path or a web address), needing Apply
  changes. The back office shows it once, while open or the next time it opens; one
  not seen in 30 days is dropped.
