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
the schema writes its file). A person's edits gather in one change until ten minutes
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
protocol's `changes` routes ([`remote-protocol.md`](remote-protocol.md)).

- **A change bundle** is a private package like any site export: `package.json`, a
  `bundle.json` typed `change` with the one integrity hash over everything and the
  package's identity, `change.json`, and the media files it added or replaced under
  `media/` (`@crombolo/transfer`'s `writeChangeBundle`, `readChangeBundle`). It carries
  the change's identity, the changes it depends on, each file with its text before and
  after, and each page, media item or Library item with its values, names and
  publishing before and after, matched on another site by key. A page the change
  deleted is kept among its items as it stood, since a delete takes its history.
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
  staged into one (`&into=`) and applied together.
- **Applied** (`PUT changes`), it is staged and merged at once. A conflict leaves the
  workspace open to edit, holding the change, and changes nothing in Shared; a finding
  (`382`) is counted against the target and refused until accepted there (`?accept=`).
- **An open workspace** exports as the change its merge will be, under the workspace's
  key, since a whole workspace's merge takes its key as its change's.
- **Page edits since a point** export as one change, each page as it stood then and now.
- **A whole site** applied into a site with no pages is its first change (`bundle`); over
  one holding pages, it is recorded as `replace`.

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

On the site where content is made, a person's publish closes their change, so it holds
what they changed and is finished, and raises `Crombolo.ChangePublished` naming it
([`webhooks.md`](webhooks.md)): a host subscribed to it can take the change
(`changes/{id}/bundle`) and apply it to the serving copy at once. Their next edit starts
another change.

