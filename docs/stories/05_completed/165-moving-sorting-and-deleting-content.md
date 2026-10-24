# 165 — Moving, sorting and deleting content

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** M
**Depends on:** —

## Story

As an operator scripting changes to a running site, I want to move, copy, sort
and delete pages and media from the command line, so that a restructure can be
scripted and rehearsed rather than done by hand.

## Context

`crombolo content publish` and `unpublish` exist; nothing else changes the
tree. The document and media ports already move, copy, sort and trash
(`createDocumentPort`, `createMediaPort`; the `document` and `media` areas of
the Management API). Seed files (story 163) declare starting content; these are
the day-two verbs that seeds deliberately do not have.

## Decisions (2026-10-24)

- **The "allowed under this type" rule moves into the shared operations.** A
  page whose type its new parent does not allow (or, at the top, a type not
  allowed at the root) is refused on create, move, copy and a restore to a
  chosen target, for users and operators alike. The backoffice API gets the
  rule too, which until now lived only in the backoffice's picker. The system
  actor is exempt, since it carries out what someone already decided
  (approvals, the scheduled job, form workflows). Media follows the same rule
  for media types.
- **Media gets its own operations module**, `createMediaOperations` in
  `@crombolo/content`, as pages did in story 170:
  - permissions;
  - one transaction holding the write, its audit entry and its event;
  - the backoffice's media port, and the command line, both call it.

  This is what takes the story from S to M.
- **Move and delete take several items.** `content move a b c --to x` and
  `content delete a b`. Every item is checked before anything is written, then
  all are written in one transaction, as `publishMany` does.

## Findings (2026-10-24)

- **What pages already have.** The document operations already move, copy,
  sort and trash (`content/src/operations.ts`), with permissions, redirect
  tracking (move and sort), the audit entry and the outbox event in the change's
  transaction. `siteDocumentOperations` wires them for the command line.
  `content publish` is the pattern to follow: resolve, act as the operator,
  report each refusal per page.
- **Nothing on the server checks allowed types.** Repository `create`, `move`
  and `copy` only check that the parent exists and is not in the bin. The
  backoffice's choices come from `allowedChildren`, `allowedAtRoot` and
  `allowedParents` on the content-type port.
- **Media writes are uneven** (`server/src/adapters/media.ts`):
  - Create, update and delete record a webhook event inside the change.
  - Move, sort, trash and restore record no event, and tell the cache after
    the commit rather than inside it.
  - Every media audit entry is written by the router (`MEDIA_RULES`,
    `api-management/src/audit.ts`), outside the change's transaction.
  - Media permissions exist only in the router: the section's fallback verbs
    plus the media start nodes. `ContentPrincipal` carries only document start
    nodes.
- **No way to name the root.** `resolveNodeRef` has no spelling for it, so
  `--to` needs one.
- **No document write has a dry run today**; `content publish` has no
  `--dry-run`.
- **Seeds and `content import` write through the repository**, not the
  operations, so the new type rule does not touch them.

## Plan

1. **Characterise.** Tests that pass today and must fail once this lands:
   moving, copying and creating a page under a type that does not allow it
   through the Management API, and the same for media.
2. **The placement rule.**
   - `ContentTypeRepository.placementRefusal(typeKey, parentKey | null)`
     answers the reason or nothing. It reads `content_type_allowed_child` and
     `allowed_as_root`, for document and media types.
   - The document operations apply it in `create`, `createAndPublish`, `move`,
     `copy` (the top page; its descendants keep the parents they already have)
     and `restore` with a target. Any actor but the system is checked.
   - A refusal is `invalid`, 400, naming the type and the parent, e.g. "A Blog
     post can't go under Contact."
3. **Media operations** (`content/src/media-operations.ts`).
   - `create`, `save`, `trash`, `delete`, `emptyBin`, `restore`, `move`,
     `sort` and `sortChildrenBy`, each through a `commit` like the documents'.
   - `MediaEvent` joins `DocumentEvent` as `ContentEvent`.
     - `auditFor` gives media events the entries the router writes today: the
       same category, entity type and actions, so the audit log reads the same.
     - `webhookFor` maps them to `Umbraco.MediaSave` and
       `Umbraco.MediaDelete`, as today.
     - `createContentEventSink` records both kinds.
   - The cache instruction moves inside the transaction for every media write.
   - **Permissions:** `ContentPrincipal` gains `startNodes.media`; a user
     needs the section's fallback verbs and media start-node access, as
     `MEDIA_RULES` checks now.
   - **Files:** `mediaFileOf` moves to `@crombolo/core`. Removing files is
     injected as `files.remove`, and happens after the commit, as it does now.
   - **Wiring:** the media port delegates its writes to the module. The router
     stops auditing media writes, alongside the document writes
     (`DOCUMENT_WRITE_OPERATIONS` becomes the set of operations that record
     their own entries). `siteMediaOperations(db, config)` sits beside
     `siteDocumentOperations`.
4. **Many at once, and dry runs.**
   - `moveMany(actor, keys, target, { dryRun })` and
     `trashMany(actor, keys, { dryRun })` on both modules.
   - They check every item first: it exists, the actor may, it is not being
     moved below itself, and its type is allowed at the target.
   - Then one `commit` writes them all, with one event per item. A move
     captures every page's addresses before and records redirects after.
   - An item already in the bin, or already at the target, is reported
     unchanged.
   - With `dryRun`, they return the plan after the checks and write nothing.
   - `copy` and `sort` take the same `dryRun`.
5. **Commands** (`packages/cli/src/commands/content`, `…/media`):
   - **`content move <ref>… --to <ref|/>` and `media move`:** `/` names the
     root.
   - **`content copy <ref> --to <ref|/> [--descendants]`:** answers the new
     key.
   - **`content sort <parent|/> <child>…`:** a child is named as a name under
     the parent, a path or a uuid. The named children come first, in the order
     given, and the rest follow in their current order. A child that is not
     under the parent, or is named twice, is a usage error.
   - **`content delete <ref>…` and `media delete`:** these move to the bin.
     The description points at `recycle-bin empty` for deleting for good.
   - **Common to all:**
     - `--dry-run`;
     - per-item refusals listed as `content publish` lists them;
     - `-o json` output fields;
     - spec `effects`: copy is `non_idempotent`, the rest `idempotent`;
     - errors `not_found`, `refused` and `usage`.

     The operations write the audit entries, as the operator, so the commands
     declare no `static audit`. A shared `support/tree.ts` holds reference
     resolution, the root spelling and refusal reporting.
6. **`crombolo schema`** regenerated, and its snapshot updated.
7. **Tests.**
   - **Operations:** the placement rule per actor, many-item writes are
     atomic (one refused item means nothing is written), a dry run writes
     nothing, and the redirect is recorded after a move.
   - **Media operations:**
     - audit entries and events commit with the change;
     - permissions (section and start node);
     - files go after the rows do;
     - the existing media API tests pass unchanged, with the same audit
       entries.
   - **Each command** on SQLite and Postgres (the data layer changes), plus
     the clispec snapshot.
8. **Docs.**
   - `architecture.md`: "Document writes" becomes "Content writes", with
     media added.
   - `audit-log.md`, `operations.md` (the new verbs) and `release-notes.md`.
   - The story index.

No migration: nothing in the schema changes.

## What was built (2026-10-24)

- **The placement rule:**
  - `ContentTypeRepository.placementRefusal(typeKey, parentKey)` reads
    `content_type_allowed_child` and `allow_at_root`. It answers "`"Post"
    isn't allowed under "Hello".`" or "`… isn't allowed at the top level.`".
  - The document operations apply it in `create`, `createAndPublish`, `move`,
    `copy` (the top page only) and `restore` with a target. They skip it for
    the system actor and for blueprints.
  - The media operations apply it in `create`, `move` and `restore`.
- **Media operations** (`packages/content/src/media-operations.ts`):
  - `create`, `save`, `trash`, `trashMany`, `delete`, `emptyBin`, `restore`,
    `move`, `moveMany`, `sort` and `sortChildrenBy`.
  - `MediaEvent`, with `mediaAuditFor`, `mediaWebhookFor` and
    `mediaAuditEntryFor`. `createMediaEventSink`
    (`server/src/content-events.ts`) writes the audit entry and the
    `mediaSaved` / `mediaDeleted` outbox event in the change's transaction.
  - The `{ media: true }` cache instruction joins that transaction.
  - **Permissions:** a user needs `Crombolo.Media.Update` within
    `startNodes.media`, which `ContentPrincipal` now carries (`mayChangeMedia`
    in `policy.ts`).
  - **Files:** `mediaFileOf` moved to `@crombolo/core`. Files are removed
    through the injected `files.remove`, after the commit.
  - **Wiring:**
    - The media port keeps only reads, and the media handlers call the
      operations as `userActor`.
    - `MEDIA_WRITE_OPERATIONS` keeps the router from writing a second audit
      entry; it still raises their live events.
    - `siteMediaOperations` serves the command line.
    - `mediaAdd` (the operations API) creates as the system actor.
    - `recycle-bin empty` deletes media through the operations.
- **Selections** (`moveMany` and `trashMany` on both modules):
  - Every item is checked first. Permission refusals come back as `forbidden`
    and structural ones as `invalid`, each with a `blocked` list of reasons
    per item.
  - All items are then written in one `commit`, with one event per item.
  - An item already in place is `unchanged`. An item below another one in the
    selection goes with it and gets no event of its own.
  - `dryRun` stops after the checks. `copy` and `sort` take `dryRun` too, and
    `copy` then answers `key: null`.
  - Single `move` and `trash` are now one-item selections, so moving a page to
    the parent it already has no longer sends it to the end.
- **Commands** (`packages/cli/src/commands/content/{move,copy,sort,delete}.ts`,
  `media/{move,delete}.ts`, shared `support/tree.ts`):
  - `/` names the top level.
  - A `content sort` child can be named by its name under the parent, a path
    or a uuid. A child that is not under the parent, or is named twice, is a
    usage error.
  - Refusals list each item, as `content publish` does. The operations write
    the audit entries.
- **A fix found on the way:** `siteDocumentOperations` never dropped its own
  published cache after a change. The redirect tracker therefore compared a
  page's new routes with stale ones, and recorded nothing for a move, or for a
  rename published from the command line. It now passes
  `onChange: () => cache.invalidate()`.
- **Tests:**
  - `tests/content-tree.test.ts` (both dialects): the placement rule per actor
    and through the API; selections that are refused whole, ordered, unchanged
    or covered; dry runs; redirects; media audit entries, permissions, start
    nodes and files; one audit entry through the API.
  - `tests/cli-content-tree.test.ts` (each command, through the CLI, on
    SQLite).
- **Test runs:** the full SQLite suite (2763 pass) after fixing three tests
  the rule rightly broke: two fixtures that put pages under types that do not
  allow them, and the product site's docs bundle, rebuilt for the new commands.
  Postgres: 2763 pass, 1 fail. The failure, in `content-import.test.ts`'s
  sibling-order test, is a timing flake: it passed twice in isolation, and
  it exercises the import, which this story does not touch.
- **Not changed:** a site that has only been run from the command line has a
  Folder that holds only folders. The server links Folder to the other
  built-in media types at boot, and `types sync` does not, so until the site
  has been started, `media move` into a folder is refused. The CLI test does
  what boot does; story 180 closes the gap.

## Acceptance criteria

- [x] `crombolo content move <path|uuid>… --to <path|uuid|/>` and
      `crombolo media move …`
- [x] `crombolo content copy <path|uuid> --to <path|uuid> [--descendants]`
- [x] `crombolo content sort <parent> <child>…` sets the order of the named
      children; children not named keep their order after them
- [x] `crombolo content delete <path|uuid>…` moves to the recycle bin;
      `media delete` likewise. A permanent delete stays `recycle-bin empty`
- [x] Each takes `--dry-run`, checks the whole selection before writing (as
      `content publish` does), refuses what an editor could not do (moving under
      a type that does not allow it), and writes an audit entry
- [x] A move records the redirect an editor's move would (story 042)
- [x] In `crombolo schema` (clispec), with `-o json` and the usual exit codes
- [x] The allowed-type rule holds for the backoffice API too (create, move,
      copy, restore to a target), for pages and media; the system actor is exempt
- [x] Media writes go through `createMediaOperations`: permissions, audit entry,
      event and cache instruction in the change's transaction, whoever starts it
- [x] Tests on SQLite and Postgres
