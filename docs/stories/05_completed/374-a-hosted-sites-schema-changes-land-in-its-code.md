# 374 — A hosted site's schema changes land in its code

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer whose site's schema is in its code, I want the CLI to change a hosted
site's schema and my checkout's `schema/` files together, and to bring a hosted site's
live schema into my files, so that the site and its code never drift apart.

## Context

The type commands (`types new`, `update`, `rename`, `remove`, `property`, `tab`…) write
`schema/` and apply it to the local site's database. `types export` writes the local
database's definitions as `schema/` files. Neither reaches a hosted site, so a schema
change made there, in its back office or by an agent, can't be brought into code from
the command line. The next publish of the code then refuses to remove a type that has
content (found on a hosted preview, 2026-11-17).

## The design

A site is named by its profile, as `push` and `pull` name one: `--from <profile>`,
`--to <profile>`, `--against <profile>`, each with `--env`, since each command reaches
one hosted site.

- **Through the remote protocol** (`/crombolo/remote/v1`), as every hosted command is,
  not the back office's Settings → Schema routes (`342`), which take an administrator's
  back-office session, can't remove a file, and wait for approval. Two new capabilities:
  - **`schema-files`**: `GET schema`, the host's `schema/` TOML files (the layout
    `schemaPathOf` accepts) and its version. `read` access and Pull.
  - **`schema-edit`**: `POST schema/edits` with `{ edits: {path: text|null}, base:
    {path: sha256|null} }`. Refused (409) when a file no longer matches its `base`;
    otherwise checked as `342` checks an upload, written under `Locks.Schema`, synced, put
    back when the sync refuses, published to a schema store, and audited as the person.
    It raises the version as `342` does and answers `{ changed, action, version,
    findings }`. `dryRun: true` in the body checks only. `content` access, ApplyStructure, and a writable schema.
  - The check-write-put-back core is shared with `createSchemaTransfer`.
- **`types export --from <profile>`** mirrors the host's definitions into `schema/`: the
  pull. It lists what it adds, changes and removes, and asks unless `--yes`.
  `migrations/` is never touched. The host's version comes with it.
- **The type commands take `--to <profile>`.** By default only the edit is sent:
  1. the host's copy of each file the edit touches is fetched, and the command is
     refused, changing nothing, where it differs from the checkout's before the edit,
     naming `types check --against` and `types export --from`. `--force` sends it anyway,
     over the host's copy;
  2. the host checks it (`dryRun`), so a refusal there (a type with content) comes before
     any file is written;
  3. the files are written and applied locally, as now; `--no-apply` still means this
     folder's database only;
  4. the host applies it at once, as a type editor save would; no approval. When it
     refuses, the files are left changed, and it says so, with `types export --from` as
     the way back. When it applies, the host's new version is written to `schema.toml`,
     so the files are never older than the site and a deploy is never skipped as older.
  - **`--all`** sends every definition that differs, removals included, so the host
    matches the checkout. It lists what on the host it overwrites or removes, and asks
    unless `--yes`.
  - **`types rename --everywhere --to`** is allowed only when the checkout's views and
    content files don't name the alias, so only definitions change. Otherwise it is
    refused, naming them: those reach the host with a deploy.
  - `--dry-run --to` runs both checks and changes nothing.
- **Dual write, not a transaction.** Files and a hosted site can't change together
  atomically. The order above keeps the files, which are the source, at least as new as
  the site; only a host that changes between its check and its apply leaves them apart.
- **`types check --against <profile>`** lists each definition only here, only there, or
  different, and a version that differs, without changing either. Exits 20 when they
  differ. The same diff drives `types export --from`'s preview.

## Acceptance criteria

- [x] **`types export --from <site>`** brings a hosted site's definitions into `schema/`,
      saying what changes first.
- [x] **The type commands with `--to <site>`** change the files and the hosted site
      together, files first.
- [x] **`types check --against <site>`** lists the differences.
- [x] **A host changed since** the checkout is refused before anything is written, unless
      `--force`; `--all` makes the host match the checkout.
- [x] **A rename with `--everywhere --to`** goes through when only definitions name the
      alias, and is refused, naming the files, otherwise.
- [x] **The files' version** is never older than the host's after either direction.
- [x] **The remote conformance suite** covers `schema-files` and `schema-edit`.
- [x] **Tests:** against a hosted site served by the test harness, in each direction.

## Built

- `packages/server/src/schema-transfer.ts`: `check` takes removals; the write, sync and
  put-back are one `commit`, shared by the 342 import's `apply` and the new `edit`,
  which checks `base` (by `schemaFileHash`) before the check and again under
  `Locks.Schema`, refuses with a `code` (`changed-here`, `problems`, `blocked`,
  `removed-with-content`, `not-writable`), and audits a `Save` naming the files.
  `files()` and `schemaFilesIn` read the layout. `importSchema` takes
  `forceRetireTypes`.
- `packages/server/src/remote-schema.ts`: the `schema` and `schema/edits` routes and
  their capabilities, wired in `remote.ts` (`me` gains `may.schemaEdit`) and given the
  server's transfer in `server.ts`.
- `packages/cli/src/support/hosted-schema.ts`: `hostedSchema`, `schemaDiff`,
  `laterVersion`, `toFlags`, `schemaWritesOf` (refuses edits outside `schema/`) and
  `HostedChange` (`prepare`: drift check, `--all`, the site's dry run; `apply`: the
  site's apply, its version brought into `schema.toml`).
- `support/type-edit.ts`: `commitFileEdits` runs `HostedChange` around the local write
  and apply; `editFlags` carries `toFlags`, so every `types` edit command takes them.
  Form and workflow edits pass `localOnly` flags, since their own `--to` names
  recipients. `types new` calls `HostedChange` itself.
- `types export --from`, `types check --against`.
- `packages/remote-conformance`: a check for each capability.
- Tests: `tests/remote-schema.test.ts` (the routes: reads, edits, removal, dry run,
  stale base, problems, retire, not writable, levels and permissions) and
  `tests/types-hosted.test.ts` (the CLI against a site served in-process, in each
  direction, plus the pure diff and version order).
- Signing in: the CLI tests sign in to the site through a saved sign-in, as a person
  at a checkout would. `CROMBOLO_TOKEN` names one site and the local gate checks it too,
  as for `push` and `pull`.
- Docs: `docs/schema-as-code.md` (A hosted site's schema and the checkout),
  `docs/remote-protocol.md`, `docs/cli/`, release notes.
