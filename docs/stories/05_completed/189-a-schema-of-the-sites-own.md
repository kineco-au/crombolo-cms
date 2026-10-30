# 189 — A schema of the site's own

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** L
**Depends on:** 062, 173, 221

## Story

As a site with data that is not content, I want a database schema my server code
can query with SQL, migrated with the site and kept with its backups, so that an
application can live beside the content without a second database.

## Context

`062` gives a bundle tables of its own: declared, ledgered, confined by a guard,
with a builder rather than SQL, no joins, no aggregates beyond `count` and no
decimal type. That suits a task list. It does not suit a site with about 11
relational tables and reporting queries with joins and grouping over millions
of records.

**Decided there (2026-10-27):** the site gets a Postgres schema of its own in its
environment's database, a role confined to it, and full SQL through a
capability; an attached database is a later hosting add-on. Bundle tables stay
for small state. This story is the CMS half; the hosting half (roles, backups,
copies, restores) is `crombolo-cloud` 216.

## Decisions (2026-10-29)

1. **Who gets it.** The site's own server code, through named queries (7), and
   bundles that declare tables (9), which receive `context.bundle.database`
   scoped to a schema of their own. Declaring tables is the declaration; there
   is no separate flag.
2. **The handle** *(superseded by 8)*. A tagged
   template over `Bun.sql`: values-only parameters (no `sql(obj)`, no
   `sql.unsafe`), `sql.transaction(async tx => …)`, `search_path` set to the
   schema, plain row objects back. The query decides its `Result`; an uncaught
   error is a 500 with a reference.
3. **Confinement on Postgres: a role per owner, created by the CMS.**
   The owners are the site and each bundle that declares tables.
   - The site's schema is `site`, a bundle's `bundle_<id>`. Each is owned by a
     login-less role (named as in 11), with no
     privilege on crombolo's tables or another owner's, granted to the CMS's
     own role. Created at first boot for the site and at install for a bundle.
   - Every query on a handle runs in a transaction that begins
     `SET LOCAL ROLE <owner>`, with `search_path` set to the owner's schema.
     The role drops back at commit, so it is safe behind a connection pooler.
   - No second connection string and no stored password.
   - Where the CMS's role lacks `CREATEROLE`, boot (or the bundle's install)
     says so and prints the SQL for the operator to run once; the CMS then
     checks the roles exist with the right privileges.
   - What it guards against: mistakes and injected input (parameters are
     values only). A literal `RESET ROLE` would escape; bundles are trusted
     in-process code (173), not sandboxed.
   - Not chosen: one operator-supplied confined role shared by every owner
     (`CROMBOLO_SITE_DATABASE_URL`); `search_path` alone (confines nothing).
4. **Migrations** *(the format superseded by 9)*. Numbered SQL files in
   `database/migrations/` (`001-observations.sql`), in order, each in its own
   transaction under the confined role.
   - Ledgered in `migration_history` with `bundle = 'site'` and a checksum; an
     applied file that changes refuses the boot, asking for a new file.
   - Applied and refused as core's are (a pending one refuses a production
     boot); `upgrade --plan` lists them beside core's.
   - Forward only. Data is reshaped in SQL within the same file.
   - Bundles with a database ship the same folder, applied on install and
     upgrade into their own schema and ledgered under the bundle's id.
   - Not chosen: TypeScript `up(sql)` files; a declared schema diffed by the
     CMS.
5. **SQLite: a file per owner.** `data/site.sqlite`, and
   `data/bundles/<id>.sqlite` for each bundle that declares tables, each opened
   on a connection of its own with crombolo's database and the other owners'
   files never attached, so the same confinement test passes on both engines.
   - The CMS creates the file at first boot or install; a removed bundle's file
     stays until purged, as its ledger entries do.
   - Backups, exports and clones carry the files.
   - A literal `ATTACH DATABASE` would escape, as `RESET ROLE` would on
     Postgres; if `bun:sqlite` can set SQLite's attached-database limit to
     zero, these connections set it.
6. **Personal data.** Site tables travel in an export only with
   `--with-site-data`. Under `--anonymise` it is default-deny: the config
   declares, table by table, what may travel.

   ```ts
   database: {
     anonymise: {
       species: 'keep',
       observation: { member_key: 'member', notes: 'scrub', email: 'email' },
     },
   }
   ```

   - `keep` copies the table. Listed columns are rewritten and the rest kept:
     `member` maps to the member's placeholder, `email` to the same stand-in
     used everywhere else, `scrub` empties it.
   - An undeclared table travels empty, and the export names it.
   - Bundles declare the same in `bundle.json`.
7. **Named queries.** Modules listed in the config, as 219's actions are:
   `import * as observations from '#queries/observations.ts'`,
   `queries: { observations }`.
   - Each export is `(db, caller, ...args) => Result | Promise<Result>`;
     `caller` is the signed-in member or user, if any, and the locale.
   - Called as `site().queries.observations.forSpecies(speciesId)`; the CMS
     supplies `db` and `caller`. Types flow from the config.
   - Refused at boot: an export that isn't a function, a key used twice.
   - Calls run under the render's time limit and are named in error pages.
     Islands go through an action or a route.
   - Not chosen: the handle in page code; `run(query, …)` without a listing.

8. **Dialects (revisits 2 and 4).** Queries use Kysely, so the same code runs
   on both engines. `db` in a named query (7) and `context.bundle.database` is
   a Kysely instance on the confined connection (3, 5). Raw `sql` fragments are
   allowed, values only. Core moves to Kysely first, in 221, so the codebase
   has one way of building SQL.
9. **Custom tables are declared in code, as 062's bundle tables are**
   (replacing 4's SQL files). "Custom tables" are those a site or bundle
   defines, as against crombolo's own.
   - The site declares steps in its config,
     `database: { tables: defineSiteTables(steps) }`; a bundle uses
     `defineBundleTables(id, steps)` as now. Each step uses 062's portable step
     builder, ledgered and checksummed, under its expand and contract rules.
   - The builder gains what it lacks: decimal, more index kinds, and foreign
     keys between the declaring site's or bundle's own tables.
   - Types are inferred from the steps (`ShapeOf<Steps>`) and type the Kysely
     instance: no generated file, no database needed to type-check.
   - A raw `sql` step is allowed for the site only, untyped, with the shape
     after it declared by hand.
   - Code moves from a site into a bundle unchanged.
   - Not chosen: types generated from the migrated database; a hand-written
     interface; SQL migration files for the site alongside steps for bundles.

10. **062's prefixed tables are removed, not migrated.** Bundle tables no
    longer live as `b_<bundle>_…` tables in crombolo's schema behind a guard:
    a bundle that declares tables gets its own schema (Postgres) or file
    (SQLite) on the confined connection, and the guard is retired. Nothing in
    the repo uses 062 beyond its tests, so there is no data migration; the
    release notes carry an upgrade note, since `defineBundleTables` is in the
    supported API (173) and its tables' home changes.

## Decisions (2026-10-30)

11. **Role names are unique to the database (refines 3).** A Postgres role
    belongs to the whole server and a bundle's id is the same on every site
    that installs it, so fixed names would let one database's CMS take a role
    that owns another database's schema.

    | Owner | Role | Example |
    |---|---|---|
    | the site | `{site}_{hash}` | `crombolo_3fa9c2e1` |
    | a bundle | `{site}_{bundle id}_{hash}` | `crombolo_acme_tasks_3fa9c2e1` |

    - `{site}` is `siteName` lower-cased, anything but letters and digits
      turned to `_`, cut to 13 characters. `{hash}` is the first 8 hex
      characters of a hash of the database's name. Hyphens in a bundle id
      become `_`. At most 62 characters, inside Postgres's 63.
    - The site's role has no bundle part, so a bundle with the id `site`
      cannot collide with it.
    - Names are worked out once, when the role is created, and recorded in the
      database; renaming the site or the database does not move them.
    - Each role carries a comment naming its database. A role that already
      exists with another database's comment refuses the boot or install by
      name, so a clash fails rather than sharing a role.
    - Schemas stay `site` and `bundle_<id>` (hyphens to `_`): a schema belongs
      to one database and cannot clash.
    - A duplicate bundle id is not a way in: on another database it gets its
      own role, two bundles cannot claim one id on one site, and a bundle that
      replaces another under its id is installed, trusted code (173) that could
      already reach anything the CMS can. Verifying a bundle's publisher would
      be a story of its own.
    - Not chosen: fixed names with hosting keeping one crombolo database per
      server; an id stored in the database, which a copy restored to the same
      server would share; a 5-character hash, which two default-named sites
      on a server of a thousand databases would share about 40% of the time.

## Acceptance criteria

- [x] A site declares custom tables in its config and a bundle in its own code;
      each gets a Kysely handle typed from its steps, on both engines.
- [x] Each owner is confined: a query naming a crombolo table or another
      owner's table fails, on Postgres and SQLite, proven by tests that try.
- [x] Postgres roles and schemas are created by the CMS where it may, and
      otherwise boot or install prints the SQL to run and then verifies it.
- [x] Steps run in order with core's migrations, ledgered and
      checksum-verified, under 062's expand and contract rules; a pending one
      refuses a production boot as core's do.
- [x] `crombolo upgrade --plan` and the Changes dashboard list the site's and
      bundles' steps.
- [x] Roles are named per database (11), recorded when created, and a role
      already belonging to another database refuses the boot or install, proven
      by a test with two databases on one server.
- [x] Named queries are listed in the config and called as
      `site().queries.<module>.<name>(…)`, with the handle and caller supplied;
      a bad listing refuses the boot.
- [x] The pre-upgrade backup includes the custom tables; `crombolo export`
      includes them with `--with-site-data`, and `--anonymise` applies the
      declared rules, leaving undeclared tables empty and naming them.
- [x] 062's prefixed tables and guard are gone, with an upgrade note in the
      release notes.
- [x] Bundle code queries its tables through a Kysely handle typed from its
      steps; 062's `tables.<name>.select(…)` capability is retired (moved here
      from 221, which rebuilt its internals on Kysely but kept its API).
- [x] `docs/bundles.md` Part 4 is rewritten for the new home of bundle
      tables; `docs/data-model.md` describes the schemas, roles and files; a
      site guide covers custom tables and named queries.

## What was built

**Where tables live** (`packages/data/src/custom-tables/`):
- `names.ts`: schemas (`site`, `bundle_<id>`), role names per decision 11
  (`siteSlug`, `databaseHash`, `roleName`, `roleComment`), SQLite files
  (`ownerFile`: `crombolo.site.sqlite`, `crombolo.bundle.<id>.sqlite`, beside
  crombolo's rather than under `data/`, so two sites in one folder never share
  one), generated index names.
- `owners.ts`: `provisionOwner` creates the role, comment, grant and schema
  where the CMS may, refusing a role made for another database
  (`OwnerRoleTakenError`) or a schema someone else holds, and otherwise throws
  `OwnerSetupNeededError` with the statements to run; it records the role name
  in `key_value`. `recordedOwner` reads it on a node that does not provision.
  `openOwner` gives the owner's connection and `asOwner` runs a migration step
  inside crombolo's transaction with the role and search path taken for it.
- `database.ts`: `Db.confine(role, schema)` on Postgres, a handle on the same
  pool whose transactions begin `SET LOCAL ROLE` and `SET LOCAL search_path`.
- `handle.ts`: `tablesDatabase`, Kysely over the owner's connection, typed from
  the steps (`TablesDatabase<typeof tables>`, `KyselyTablesOf`), with Kysely's
  own transactions held on one owner transaction.
- `values.ts`: values portable across engines — written dates, booleans and
  objects converted as bound, read columns converted by their declared type
  (found from the query's node), so a boolean is a boolean and a timestamp a
  `Date` on both.
- `schema.ts`, `builder.ts`, `ddl.ts`: one compiler for every owner
  (`compileTables`, `defineSiteTables`), no prefixes, decimals, `unique()`,
  foreign keys between an owner's own tables, descending and partial indexes,
  and SQL steps for the site only. A new state key
  (`Crombolo.Tables.<id>.State`) starts every chain again in its own place.
- `chain.ts`: `tablesPlan` with a slot filled at boot; `migrate` gained
  `runStep` so a step runs on its owner. `purgeOwnerTables` drops the schema and
  role, or the file. 062's guard and capability are gone.

**The server**: `custom-tables.ts` (renamed from `bundle-tables.ts`) chains the
site's tables first, then each bundle's; `openTables` provisions on a node that
owns the database and only reads the recorded place elsewhere. `site-queries.ts`
validates `queries` at boot and builds `site().queries`, handing each query the
handle and a caller (`member()`, `locale`), and naming a query that fails.
`bundles.ts` hands `context.bundle.database` to a bundle that declares tables
and refuses the old `tables` capability and the id `site`. The production
gate, `web`-node readiness, `/status`, health, the Changes dashboard,
`upgrade --plan`, `check`, `upgrade` and `bundle purge` all include the site's
tables. The pre-upgrade backup copies the owners' SQLite files.

**Types for `site().queries`** flow from the config through a `Register`
interface the site augments on `@crombolo/crombolo/server`.

**Tests**: `custom-tables-rules.test.ts` (no database), `custom-tables.test.ts`
(both engines, including two databases on one server and a database user
without `CREATEROLE`), `custom-tables-site.test.ts` (a booted site's routes using
`site().queries` and `context.bundle.database`, and the upgrade commands).
`tests/support/db.ts` drops owners' schemas and roles on every Postgres reset.

**Found while building:** Bun's SQLite driver binds a `Date` as null and cannot
forbid `ATTACH DATABASE`; Kysely fills a column a row leaves out of a many-row
insert with null on SQLite, not its default, which the docs warn about.

**Site data in a site file** (`packages/transfer/src/site-data.ts`,
`packages/server/src/site-data.ts`, `anonymise-rules.ts`): `--with-site-data`
carries each owner's tables as sealed `data/<owner>/<table>.json` files listed
in the manifest's `siteData` block (format version unchanged, 5); `sanitise`
applies the rules with the stand-ins it uses for content, emptying and naming
undeclared tables; `installBundleContent` writes the rows back after the content
commits, owner by owner; a pull carries them, anonymised unless `--full`.
Bundles declare rules as `crombolo.anonymise` in `package.json` (the story said
`bundle.json`; the manifest is the `crombolo` field). Rules that could never be
written back (`member` on a required column, `email` on a non-text one) are
refused too. `tests/site-data-transfer.test.ts` covers it on both engines.
