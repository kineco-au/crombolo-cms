# 426 — An update says how many rows it changed

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** S
**Depends on:** 221

## Story

As someone writing a repository, I want an update, a delete and an insert through the
query builder to say how many rows they changed, so that code which asks gets the true
number and not a silent nothing.

## Context

Found on 2026-11-25 while checking a bug report: saving a page that varies by language
in a workspace failed with `UNIQUE constraint failed: workspace_document_culture…`. The
save updated the workspace's row for the language and inserted one where the update
changed nothing (`#writeWorkspaceCultures`, `packages/data/src/repositories/documents.ts`),
and the count was always nothing, so it always inserted. That save is fixed apart from
this story, by looking for the row first.

The cause is in the query builder's connection (`DbConnection.executeQuery`,
`packages/data/src/query.ts`): a statement that reads no rows goes through `Db.exec`,
which answers nothing, and the result is `{ rows: [] }` with no `numAffectedRows`. So
`numUpdatedRows`, `numDeletedRows` and `numInsertedOrUpdatedRows` are never the true
number, on SQLite and on Postgres, and nothing says so: the types promise a `bigint`.

Who asks today:

- `TrustedSignerRepository.rename` and `.remove`
  (`packages/data/src/repositories/trusted-signers.ts`) and `RemoteTrustRepository.remove`
  (`remote-trust.ts`) answer whether a row changed, and so always answer no. Their
  callers (`trusted-signers-admin.ts`, `remote.ts`) look the row up first and ignore the
  answer, so nothing is wrong for a person yet.
- `packages/server/src/extension-process.ts` reads `numAffectedRows` for an extension's
  own statements and falls back to 1.

## The design

- **`Db` says how many rows a statement changed:** `run(sql, params)` beside `exec`,
  answering the number, on SQLite (`changes`) and Postgres (the command's count), inside
  a transaction and out, and on a confined handle.
- **The query builder passes it on** as `numAffectedRows`, so `numUpdatedRows` and the
  others are true.
- **`run` is required of every `Db`,** so a wrapper that lacks it does not compile.
- **The three repositories' answers become true,** and a test holds each.

## Acceptance criteria

- [x] An update, a delete and an insert through `db.q` report the rows they changed, on
      both dialects, inside a transaction and out.
- [x] `TrustedSignerRepository.rename` and `.remove` and `RemoteTrustRepository.remove`
      answer true for a row that was there and false for one that was not.
- [x] An extension's statement reports its own count, through the same connection.
- [x] No statement that changes rows reports nothing silently.
- [x] Tests on both dialects; `docs/data-model.md` says where the counts come from.

## Implementation

- `Db.run` (`packages/data/src/database.ts`): `SqliteDb` answers the statement's
  `changes`, `PostgresDb` its `count`; the recording handle (`migrations.ts`) records and
  answers 0; the telemetry wrapper (`packages/server/src/telemetry.ts`) and the tests'
  wrappers pass it through.
- `DbConnection.executeQuery` (`query.ts`) runs a write with no `RETURNING` through `run`
  and answers `numAffectedRows`.
- **The save that showed it:** `#writeWorkspaceCultures` (`repositories/documents.ts`)
  looks for the workspace's row for the language, then updates or inserts.
- **The tests' harness** reads a page's revision in the workspace it saves in, as the back
  office does, so a second save there is not stale.
- Tests: `tests/query-layer.test.ts` (the counts, the signers, the trust rule),
  `tests/workspace-designers.test.ts` (a page that varies by language saved twice in a
  workspace, one Shared has and one made there).
