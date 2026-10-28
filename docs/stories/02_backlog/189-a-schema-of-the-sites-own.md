# 189 — A schema of the site's own

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** L
**Depends on:** 062, 173

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

## Decisions before implementation

- **The capability.** Parameterised SQL (tagged templates over `Bun.sql`) inside
  the schema, with `search_path` set to it and a transaction helper; or a query
  builder. Either way no identifier from a caller, and no reach into core tables.
- **Confinement.** On Postgres, a role that owns only `site_<id>` and has no
  privilege on core's schema; the capability connects as it. Decide how the role's
  credentials reach the node (`CROMBOLO_SITE_DB_URL`, or created by the CMS from
  the owner role at install).
- **Migrations.** SQL files the site ships (`db/migrations/*.sql`), ordered,
  checksummed and ledgered in `migration_history` under the site's id, run by
  `crombolo upgrade` after core's and bundles'. Expand and contract rules as
  `062`'s, applied to SQL the CMS cannot plan: say so in `upgrade --plan`.
- **SQLite.** Local development on SQLite either gets a second database file
  attached as the schema, or the capability is Postgres-only and says so at boot.
- **Personal data.** How an anonymised clone (`100`) learns which columns hold
  personal data.

## Acceptance criteria

- [ ] A server bundle declares it uses the site schema and receives a `database`
      capability scoped to it; it cannot read or write a core table, proven by a
      test that tries.
- [ ] Migrations run in order with core's under `crombolo upgrade`, ledgered and
      checksum-verified; a pending one refuses a production boot as core's do.
- [ ] `crombolo upgrade --plan` and the Changes dashboard list the site's
      migrations.
- [ ] The pre-upgrade backup and `crombolo export` include the schema.
- [ ] `docs/bundles.md` gains Part 5, and `docs/data-model.md` the schema and role.
