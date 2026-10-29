# 221 — Kysely as the query layer

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** XL
**Depends on:** —

## Story

As a developer of crombolo, a bundle or a site, I want SQL built one way
throughout, typed and portable across SQLite and Postgres, so that nobody
writes a query twice or learns which engine it will meet.

## Context

Split from 189 when planning it (2026-10-29). A site's own schema needs queries
and migrations that run on both engines, since sites start on SQLite and may
deploy on Postgres, and a bundle must install on either. Raw SQL makes every
author cater for both. Kysely, a typed query builder with Postgres and SQLite
dialects and a schema builder for migrations, was chosen for 189, and for the
whole codebase so there is one way of building SQL.

Today core has about 950 hand-written statements across 108 files, rendered
through the seam in `packages/data/src/dialect.ts` (`?` placeholders, portable
column types, engine-specific fragments such as full-text search). Bundle
tables (062) have a builder of their own in `packages/data/src/bundle-tables/`.

## Decisions (2026-10-29)

1. **Kysely compiles; our `Db` runs.** A thin Kysely driver whose one
   connection forwards each compiled query to `db.query(sql, params)`.
   - Every `Db` has a typed `db.q`; inside `db.transaction(async tx => …)`,
     `tx.q` is that transaction's.
   - Unchanged: transaction queueing and nested joins, the ambient
     transaction, the lock manager, `readSnapshot` (174), read-only
     connections, `listen` and deadlock handling.
   - Kysely's own `transaction()` throws, pointing at `db.transaction`.
   - Kysely emits each engine's placeholders, so its queries bypass
     `dialect.render`; hand-written `?` SQL keeps working meanwhile.
   - 189's confined handles are `Db`s of the same shape.
   - No `pg` or `better-sqlite3`. Kysely is `@crombolo/data`'s first runtime
     dependency, pinned exactly, and not part of the supported API (173) in
     this story.
   - Not chosen: Kysely owning pools and transactions, with `Db` retired.
2. **Core's table types are generated from both engines and committed.**
   `bun run db:types` (through docker) migrates a fresh SQLite and Postgres,
   reads every table's columns and nullability, and writes
   `packages/data/src/tables.gen.ts`.
   - A column's read type is what either engine returns
     (`boolean | number`, `Date | string`); its write type is what
     `dialect.boolValue` and `DbDate` produce, so a read that forgets to
     normalise is a compile error.
   - A test in the dialect suites regenerates in memory and fails, naming the
     table and column, when the committed file differs.
   - Not chosen: hand-written types; types from Postgres only.
3. **One story, converted area by area, with a ratchet.**
   - Foundation first (driver, `db.q`, generator, drift test), then: small
     repositories; members and users; content and documents; publishing and
     the published cache; search and transfer; migrations, the ledger and the
     remaining services; 062's query builder last. Each area ends on a green
     full run on both engines.
   - A check in `bun run check` lists the files still holding SQL strings
     outside the dialect seam and released migrations, and fails if the list
     grows. Done when it is empty; the check then forbids hand-written SQL.
   - Releases may go out mid-way. 189 starts once the list is empty.
   - Not chosen: a story per area; one change with no checkpoints.
4. **New core migrations use Kysely's schema builder**, in the existing
   `Migration` record (name, release, kind, ledger, checksum).
   - Column types come from `dialect.types` through a small helper, so
     `textCi`, `json` and `timestamp` still map per engine. Engine-specific
     pieces (partial indexes, collations, full-text) are `sql` fragments
     behind the dialect seam.
   - Not chosen: 062's step builder for core; its inferred types add nothing
     once Q2 generates them, and it would grow into a second DDL layer.
5. **Unchanged from the split:** released migrations stay as written;
   engine-specific SQL stays behind the dialect seam; 062's query builder is
   retired in favour of Kysely typed from a bundle's declared steps, while its
   declaration and DDL side stays (189), and existing bundles' tables keep
   working until 189 moves them.

## Acceptance criteria

- [x] Kysely runs on both engines through `db.q`, inside the existing
      connection, transaction, snapshot and lock handling; Kysely's own
      `transaction()` refuses.
- [x] `bun run db:types` writes `packages/data/src/tables.gen.ts` from both
      engines, and a dialect-suite test fails on drift.
- [x] Every repository and service builds its SQL with Kysely; the ratchet
      check is empty and then forbids hand-written SQL outside the drivers,
      the dialect seam, released migrations and an import's staging copy.
- [x] ~~062's query builder is gone; bundle tables query through Kysely typed
      from their steps.~~ Moved to 189: the capability's internals are built
      with Kysely here, and its public API is replaced when 189 moves bundle
      tables into schemas of their own, so third-party bundles break once,
      not twice.
- [x] New migrations use the schema builder; released ones are unchanged, and
      `tests/migrations.test.ts` still passes.
- [x] The unit, integration and both dialect suites pass with no change in
      behaviour.
- [x] `docs/data-model.md` and the README describe the query layer, the type
      generator and the rule against hand-written SQL.

## What was built (2026-10-30)

- **The query layer, `packages/data/src/query.ts`.** A Kysely dialect whose
  one connection forwards each compiled statement to the `Db`: a select, or a
  write with `RETURNING`, as `db.query`; anything else as `db.exec`. The
  Postgres compiler keeps `?` placeholders so the `Db` renders them as it
  always has, which is what lets the upgrade plan's recording `Db` and the
  tests' statement counters see Kysely's SQL. `db.q` is a getter on every
  `Db` (made once per handle through `queryFor`); a test that wraps a `Db` in
  an object literal gives it `get q() { return queryFor(this) }`.
- **Helpers:** `now(db)` for the database clock; `rowLock(db, mode)` for
  `FOR UPDATE` / `FOR SHARE` / `SKIP LOCKED` on Postgres only; `compilerFor(dialect)`
  for statements rendered before there is a connection (062's DDL);
  `TransactionRefused` when Kysely's own `transaction()` is called.
- **The seam, `dialect.ts`.** `fullTextHits` and `siteSearchHits` became
  `fullTextMatches(query)` and `siteSearchMatches(query)`, returning a Kysely
  raw builder with the query bound. New: `columnsOf` and `tableNames`, the
  catalogue lookups the ledger and 062's purge need. `boolValue` returns
  `boolean | number`.
- **Types, `tables.gen.ts`**, written by `bun run db:types`
  (`scripts/db-types.ts`, generator in `packages/data/src/table-types.ts`).
  Aliases `Bool`, `Timestamp`, `Decimal`, `BigInteger` and `Bytes` carry both
  engines' read types; `Default<…>` marks an aliased column with a default.
  `tests/table-types.test.ts` (Postgres suite) fails on drift. The file is
  `.gen.ts`, so Biome leaves it alone.
- **The rule, `scripts/check-sql.ts`** (`bun run check:sql`, in `bun run
  check`): a small lexer reads every string and template literal in
  `packages/*/src`, and any that looks like SQL fails, outside `database.ts`,
  `locks.ts`, `table-types.ts`, `dialect.ts`, the released schema files and
  `packages/import-umbraco`. It ran as a ratchet from 89 files to none
  during the conversion; `tests/check-sql.test.ts` keeps it at none.
- **Converted:** every repository, the ledger and schema helpers, search,
  audit, cluster, events, approvals, the auth store, the schema, transfer and
  content packages, and the server's adapters and services. Behaviour and
  statement counts are unchanged. Small differences: literals once spliced
  into SQL (LIKE patterns, `''`) are bound parameters; a value explicitly
  `undefined` in an update is written as null, as the old binding did.
- **062's bundle tables:** the capability builds its statements with Kysely
  and still passes every one through the guard before it runs; step DDL is
  rendered with the schema builder. Its public API is unchanged: replacing it
  moved to 189 (see the criteria).
- **Tests changed only where they matched SQL text**, now matched without
  regard to case (Kysely writes lower-case keywords and quotes identifiers):
  `bundle-tables`, `bundle-tables-site`, `cache-notify`, `media-scale`.
- **Upgrade plans show bundle steps' SQL in lower case.**
- **Verified:** `bun run check` clean; SQLite 3189 pass, 0 fail; Postgres 3189
  pass, 0 fail (with the drift test); integration 100 pass, 0 fail.

