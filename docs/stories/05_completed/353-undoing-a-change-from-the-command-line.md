# 353 — Undoing a change from the command line

**Epic:** P — The command line · **Priority:** should · **Size:** M
**Depends on:** 349, 352

## Story

As an editor or operator, I want to see a page's history, roll it back, and
restore what was deleted, from the CLI, so that recovering from a mistake on a
live site doesn't wait for someone to open the back office.

## Context

Story 349, G1 and G2. A page's Info view lists its history and rolls it back
(`page-history.js`), and a version can be kept from cleanup. The recycle bin
restores pages and media to where they were. The CLI can only empty the bin
(`recycle-bin empty`), and has no history at all.

Each command here takes `--profile` (story 352) to act on another site, through the remote protocol, as the person signed in to it. A hosted site needs a new capability for these routes, checked by `packages/remote-conformance`. A CI identity is refused, since these act for a person (story 349, D2).

## What is there to build on

- **Every change goes through the content operations** (`packages/content/src/operations.ts`):
  - `rollback(actor, versionId)` makes a version the page's draft;
  - `restore(actor, key, targetKey)` restores a page and what was below it.
    It answers `notFound` when the page isn't in the bin, and `invalid` when the
    place it would go is gone or itself in the bin;
  - the media operations (`media-operations.ts`) have a `restore` of their own,
    queued as a job for a large branch.

  The back office's handlers (`api-management/src/handlers/document.ts`) call
  these, so the permission checks, audit and events are already right for any
  actor. The CLI's `commandActor()` (story 350) gives the signed-in person, or
  the command line.
- **Versions** are `DocumentRepository.versions(key)`, `atVersion(versionId)`
  and `setPreventCleanup(versionId, prevent)` (`packages/data/src/repositories/documents.ts`).
  A version records its date, its user's key, whether it is the current draft
  or the published version, and whether it is kept from cleanup.
- **Rollback isn't per culture.** A version is a whole version of the page. The
  handler takes no culture, unlike Umbraco's, so `--culture` is dropped from
  `content rollback` and `content history` (below).
- **Where a trashed item came from** is the "parent on delete" relation
  (`packages/data/src/relations.ts`), which `restore` with no target already uses.
- **The remote protocol** (`packages/server/src/remote.ts`):
  - lists capabilities in its discovery document;
  - answers routes under `environments/{id}/…`, as the signed-in person;
  - `content/query` (story 183, capability `content-query`) is the pattern to
    follow: check the section, then answer as the back office would;
  - `packages/remote-conformance` checks a host against the protocol.
- **Showing a page.** `content show` (`support/pages.ts`) already turns a
  page's values and blocks into what people read and `-o json` gives, so a
  version is shown the same way.

## Decisions

- **D1: how `--profile` reaches a hosted site.**
  - (a) new remote protocol routes, with a capability of their own, for example
    `content-history` and `recycle-bin`, checked by the conformance suite. They
    call the same content operations the back office's handlers do, and refuse
    a CI identity explicitly. *Recommended:* it is how `content find` reached a
    hosted site (story 183). An older site that lacks the routes is told apart
    by its discovery document, so the CLI can say the site needs upgrading. A
    host other than crombolo implements one documented protocol.
  - (b) the CLI calls the site's Management API directly
    (`document-version`, `recycle-bin`, `…/restore`) with the remote sign-in.
    Less server code, but the CLI comes to depend on Umbraco's API shapes, an
    older site answers only 404, and a CI identity is refused only because it
    happens to lack the sections.

  **Decided 2026-11-15: (a).**

## Plan

1. **A shared core**, `packages/server/src/undo.ts`, used by the CLI locally and
   by the remote routes:
   - `pageHistory(db, key)`: the versions, newest first, each with its date,
     who (the user's name looked up from the key, or "the command line" or a
     job), saved or published, and kept or not;
   - `pageVersion(db, versionId)`: that version's values, through the same
     formatter as `content show`, and a diff against the current draft that
     lists the properties added, removed or changed, with the old and new value;
   - `binItems(db, { content, media, olderThan })`: name, kind, when trashed, by
     whom, and the path it came from, or that the place is gone.
2. **Local commands**, each through `commandActor()` and the content or media
   operations, so permissions, approvals and audit are the back office's:
   - `content history <page>` and `content history show <page> <version> [--diff]`,
     with `access: 'site'` and the Content section;
   - `content rollback <page> <version> [--publish] [--skip-approval]`. With
     `--publish` it then publishes as `content publish` does, approvals and
     `--skip-approval` included;
   - `content history keep <page> <version> [--off]`;
   - `recycle-bin list [--content|--media] [--older-than <days>]`, with the
     Content or Media section;
   - `recycle-bin restore <item> [--to <parent>]`:
     - a page or media item named by path or key, as `recycle-bin empty` names them;
     - a media branch large enough to be queued is followed until it finishes;
     - when the place it came from is gone, it is refused unless `--to` is given,
       saying where it was and naming `--to`.
   - A version is named by its key, or `latest-published` and `previous`, the
     common cases. `content history` prints keys short enough to type.
3. **Remote routes** (with D1 (a)), under `environments/{id}/`:
   - `GET content/{key}/history`, `GET content/versions/{id}[?diff=true]`;
   - `POST content/versions/{id}/rollback` and `PUT content/versions/{id}/keep`;
   - `GET recycle-bin`, and `POST recycle-bin/{key}/restore` with an optional target.

   They answer as the signed-in person through `userActor`, check the section as
   `content/query` does, and refuse a CI identity with "Undoing a change needs a
   person". Discovery lists `content-history` and `recycle-bin`.
   `packages/remote-conformance` gains checks for both, and
   `docs/remote-protocol.md` documents them.
4. **`--profile`** on each command, through `hostedOrHere` and `connectSite`
   (story 352). A hosted site whose discovery lacks the capability is refused
   with "This site needs a newer crombolo to …".
5. **Words.** Output is plain for people: "Saved by Ana, 3 hours ago",
   "Published", "Kept". `-o json` gives full dates and keys.
6. **Docs.**
   - `docs/operations.md`, "Undoing a change": history, rollback, keeping, the bin;
   - `docs/remote-protocol.md`;
   - `bun run cli:spec`;
   - the release notes under Unreleased.
7. **Tests.**
   - `tests/undo.test.ts`, for the core:
     - history order and who;
     - a diff;
     - the bin's list with where each came from, and a place that is gone.
   - `tests/undo-cli.test.ts`, for the commands, locally and against a test server
     with `--profile`:
     - rollback with and without `--publish`, `--publish` under a workflow refused
       without `--skip-approval`;
     - keep and `--off`;
     - restore to its place, to `--to`, and refused when its place is gone;
     - a media branch restored;
     - at `sign-in`, a person without the Content section refused;
     - a CI identity refused on each route;
     - an old site's missing capability.
   - `packages/remote-conformance`'s new checks run in its own test.
   - SQLite only: the data layer gains no table or column, only reads through
     existing repositories.

## Acceptance criteria

- [x] `crombolo content history <page>` lists its versions, newest
      first: when, who, saved or published, and whether it is kept from cleanup
- [x] `content history show <page> <version>` shows that version's values and blocks
      as `content show` does. `--diff` shows only what differs from the current draft
- [x] `content rollback <page> <version> [--publish]` makes the
      version the page's draft, as the back office's rollback does. With `--publish`,
      it publishes as `content publish` would, approvals included
- [x] `content history keep <page> <version> [--off]` keeps a version from cleanup, or
      stops keeping it
- [x] `crombolo recycle-bin list [--content|--media] [--older-than <days>]` lists what
      is in the bin: name, when, by whom, and where it came from
- [x] `recycle-bin restore <item> [--to <parent>]` restores a page or media item, and
      what was below it, to where it came from. When that place is gone, the command
      is refused unless `--to` gives another
- [x] Each takes `--profile`; `-o json`; changes are audited as the back office's are
- [x] Tests for each command locally and through a test server, a restore whose parent
      is gone, and a CI identity refused
- [x] The CLI reference regenerated, and `docs/operations.md` gains "Undoing a change"

## Built

Built 2026-11-15, with D1 (a):
- the core is `packages/server/src/undo.ts`: `pageHistory`, `pageVersion` (with
  `diffValues`), `binItems`, `binMatches` and `placeGone`, and `pageReader` and
  `namedPath`, which `content show` now shares (`support/pages.ts`, `sayValues`);
- the remote routes are `packages/server/src/remote-undo.ts`, mounted by `createRemote`
  when the server hands it its operations (`RemoteOptions.operations`); discovery lists
  `content-history` and `recycle-bin` then;
- the commands are `content history`, `content history show|keep`, `content rollback`
  and `recycle-bin list|restore`, over `packages/cli/src/support/undo.ts`, whose
  `withUndo` gives each the same few calls here or on a hosted site;
- the conformance suite checks both capabilities, read-only: an unknown page, version
  and rollback answer 404, the bin's items have their fields, and restoring what is not
  in the bin answers 404;
- tests: `tests/undo.test.ts` and `tests/undo-cli.test.ts`.

Where it differs from the plan:
- **"By whom" in the bin is the audit log's `Trash` entry,** as no table records who
  trashed an item. Retention can remove it, and `by` is then null.
- **"Who" for a version no person made is "the command line or the site".** A version
  records only a user's key, so a command at `open`, a schedule and a job look the same.
- **A restore's place being gone is checked here, not only by the operation.** The
  operation restores to the top level when the original parent has been deleted for
  good (`originalParent` answers null), so the core reads `original_parent_id` itself, and
  both the command and the route refuse (`place-gone`) unless a target is given.
- **Writes over the remote need the `content` access level** (403 `access-level`), as
  a bundle of content does; reads need only the protocol on.
- **A large media restore on a hosted site** answers 202 with a job, followed through
  `recycle-bin/jobs/{id}`. Here, the command line's media operations have no background,
  so it always restores inline. The queued path is not covered by a test: the branch
  size is not configurable on a server.
- **Keeping a version is not audited,** as the back office's prevent-cleanup is not.
- **`recycle-bin restore` takes `--content` or `--media`** to narrow the name it looks
  for, and names an item by key, the path it was at, or its name alone.
- **On a hosted site a page, and `--to`, are named by uuid,** as `content find --under`
  is there.
- **`--publish` after a rollback that is then refused** (an approval, say) leaves the
  rollback as a draft, and the error says so; approvals are not checked before.
