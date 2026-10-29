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
decimal type. That suits a task list. It does not suit Nature's Calendar
(`wt-natures-calendar` story 011): about 11 relational tables and reporting
queries with joins and grouping over millions of observations.

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
     login-less role, `crombolo_site` or `crombolo_bundle_<id>`, with no
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

## Acceptance criteria

- [ ] A site declares custom tables in its config and a bundle in its own code;
      each gets a Kysely handle typed from its steps, on both engines.
- [ ] Each owner is confined: a query naming a crombolo table or another
      owner's table fails, on Postgres and SQLite, proven by tests that try.
- [ ] Postgres roles and schemas are created by the CMS where it may, and
      otherwise boot or install prints the SQL to run and then verifies it.
- [ ] Steps run in order with core's migrations, ledgered and
      checksum-verified, under 062's expand and contract rules; a pending one
      refuses a production boot as core's do.
- [ ] `crombolo upgrade --plan` and the Changes dashboard list the site's and
      bundles' steps.
- [ ] Named queries are listed in the config and called as
      `site().queries.<module>.<name>(…)`, with the handle and caller supplied;
      a bad listing refuses the boot.
- [ ] The pre-upgrade backup includes the custom tables; `crombolo export`
      includes them with `--with-site-data`, and `--anonymise` applies the
      declared rules, leaving undeclared tables empty and naming them.
- [ ] 062's prefixed tables and guard are gone, with an upgrade note in the
      release notes.
- [ ] Bundle code queries its tables through a Kysely handle typed from its
      steps; 062's `tables.<name>.select(…)` capability is retired (moved here
      from 221, which rebuilt its internals on Kysely but kept its API).
- [ ] `docs/bundles.md` Part 4 is rewritten for the new home of bundle
      tables; `docs/data-model.md` describes the schemas, roles and files; a
      site guide covers custom tables and named queries.
