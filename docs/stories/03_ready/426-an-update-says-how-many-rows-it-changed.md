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

- **`Db` says how many rows a statement changed:** a `run(sql, params)` beside `exec`,
  answering the number, on SQLite (`changes`) and Postgres (the command's count), inside
  a transaction and out, and on a confined handle.
- **The query builder passes it on** as `numAffectedRows`, so `numUpdatedRows` and the
  others are true.
- **A handle that cannot say** (a wrapper in a test, a recording handle) fails the
  statement that asks, not answers nothing: decide while building whether `run` is
  required of every `Db` or the builder throws where it is absent and a count is read.
- **The three repositories' answers become true,** and a test holds each.
- **A rule for the code:** a count read from the builder is covered by a test on both
  dialects.

## Acceptance criteria

- An update, a delete and an insert through `db.q` report the rows they changed, on
  both dialects, inside a transaction and out.
- `TrustedSignerRepository.rename` and `.remove` and `RemoteTrustRepository.remove`
  answer true for a row that was there and false for one that was not.
- An extension's statement reports its own count, not 1.
- No statement that changes rows reports nothing silently.
- Tests on both dialects; `docs/` says where the builder's counts come from, where the
  data layer is described.
