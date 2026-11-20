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
in that time are counted on it from the pages' own history, not listed.

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
