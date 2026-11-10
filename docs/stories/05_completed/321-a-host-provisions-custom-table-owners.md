# 321 — A host provisions custom-table owners itself

**Epic:** I — Hardening · **Priority:** should · **Size:** M
**Depends on:** 189, 311

## Story

As a host that runs many sites on a shared Postgres server, and never gives a site's
database user `CREATEROLE`, I want to make each custom-table owner's role and schema
myself before the site boots, so that a site's own tables and an extension's tables work
without the CMS stopping on `OwnerSetupNeededError` first.

## Context

Story 189 makes a login-less role per custom-table owner (the site, and each extension
that declares tables), names it `{site}_{hash}` or `{site}_{bundle id}_{hash}`
(`roleName`, `packages/data/src/custom-tables/names.ts`), and creates it at the first boot
of a node that owns the database. A database user without `CREATEROLE` gets
`OwnerSetupNeededError`, with the statements for an operator to run once.

Without `CREATEROLE` is the right setup on a shared server: before Postgres 16, a login
with it can take over any role that is not a superuser. A host running many sites there
provisions roles itself, as its own administrator, before a site boots. Today it can only
get the names and statements from the error, after a boot has failed, or by copying the
naming rule, which then breaks silently if the rule changes.

`provisionOwner` already accepts a role made beforehand: it checks the role's comment,
that the database user is granted it, and the schema's owner, then records the name and
carries on. All a host lacks is the name and the statements, ahead of time.

## The design

- **`@crombolo/crombolo/host` exports `ownerSetup`:**

  ```ts
  ownerSetup({ siteName, owner, database, grantee }): {
    role: string
    schema: string
    comment: string
    statements: string[] // what OwnerSetupNeededError prints today
  }
  ```

  - `owner` is `'site'` or an extension's id, as the CMS reads it from `crombolo.id`;
    anything else is refused;
  - `database` is the Postgres database's name;
  - `grantee` is the site's database user.

  It is `roleName`, `schemaName`, `roleComment` and the setup statements together, with
  no database connection: `ownerSetupStatements` takes a `Db` today only to quote, and
  Postgres's quoting is a fixed rule, so it moves into `ownerSetup`.
  `provisionOwner` builds its statements by calling `ownerSetup`, so the error's and the
  host's cannot drift.
- **An extension says it keeps tables, as a permission:** an extension's tables are known
  only once its process starts (`d.tables`, `extension-process.ts`), and the manifest has
  no key for them. So tables become a permission like the others:
  - `data.tables`, worded "Keep its own data in the site's database", in
    `BUNDLE_PERMISSIONS`, shown at install and granted like the rest (309/310);
  - checked both ways at boot, as `backoffice.code` is: a process that declares tables
    without `data.tables` is refused, and `data.tables` with no tables is refused as an
    unused permission;
  - a host reads it from `crombolo.permissions` before installing, and provisions only
    the extensions that ask for it. `extensionTables(field)` is not needed.

  No shipped extension declares tables, so nothing needs migrating. An installed
  extension with tables that is upgraded to a version declaring `data.tables` asks for
  more, so it is off until it is granted again (309).
- **Recorded name wins:** as today, a database that already recorded a role name keeps
  it, so a site renamed after its first boot moves nothing. `ownerSetup` cannot see a
  recorded name, so the docs say a host provisions with the site name the CMS will boot
  with.
- **Docs:**
  - `data-model.md`, "Provisioning", gains "A host that provisions roles itself", with
    `ownerSetup` and what the boot then checks;
  - `api.md` lists the export;
  - `bundles.md` and `extensions.md` list `data.tables`.

## Plan

1. **`packages/data/src/custom-tables/owners.ts`:**
   - `ownerSetup` and its `OwnerSetup` type;
   - `ownerSetupStatements` goes, and `provisionOwner` calls `ownerSetup`;
   - exported from `@crombolo/data`, and from `@crombolo/crombolo/host`.
2. **`data.tables` permission:**
   - in `bundle-permissions.ts`, with its words;
   - `permissionProblems` (`bundle-grants.ts`) refuses tables without it and it without
     tables;
   - the process's description of its tables is checked where its other declarations
     are;
   - the test fixtures with tables add it.
3. **Tests:**
   - Unit tests: `ownerSetup` for the site and an extension, the quoting of a name with a
     quote in it, a refused owner, and `OwnerSetupNeededError`'s statements matching
     `ownerSetup`'s.
   - Permission tests: tables without `data.tables`, and `data.tables` without tables.
   - Postgres tests:
     - an administrator runs `ownerSetup`'s statements, then a site whose database user
       has no `CREATEROLE` boots, records the name, and uses its tables;
     - the same for an extension with tables;
     - a role made for another database is still refused.
   - Since this touches the data layer, run the SQLite and Postgres suites.
4. **Docs:** as above, plus the release notes.

## Acceptance criteria

- [x] `ownerSetup` is exported from `@crombolo/crombolo/host`, typed, and returns the
      name, schema, comment and statements `provisionOwner` would use, for the site and
      for an extension.
- [x] A test makes the role and schema from `ownerSetup`'s statements as an
      administrator, then boots a site whose database user has no `CREATEROLE`: it boots,
      records the name, and its tables work. The same for an extension with tables.
- [x] `OwnerSetupNeededError`'s statements are `ownerSetup`'s.
- [x] An extension with tables declares `data.tables`, shown at install. An extension
      whose process declares tables without it is refused, and one declaring it without
      tables is refused.
- [x] A host can tell from `crombolo.permissions` whether an extension keeps tables.
- [x] `data-model.md`, `api.md`, `bundles.md` and `extensions.md` document it.

## Implementation notes

- **`ownerSetup`** (`packages/data/src/custom-tables/owners.ts`):
  - pure, quoting as Postgres does;
  - `provisionOwner` builds `OwnerSetupNeededError`'s statements with the same
    `setupFor`, from the recorded role name where there is one;
  - `ownerSetupStatements` is gone.
- **`EXTENSION_ID`** (`names.ts`) is `crombolo.id`'s rule, which `@crombolo/data`
  cannot import from `@crombolo/backoffice-host`. `tests/owner-setup.test.ts` holds
  the two equal.
- **The `data.tables` permission:**
  - in `BUNDLE_PERMISSIONS`, and in `DECLARATION_PERMISSIONS` (`bundle-grants.ts`),
    since no capability uses it;
  - `validateServerBundles` (`bundles.ts`) checks it both ways, from schema 4, beside
    `events.content` and `routes.public`. An extension's process-described tables
    reach the same check.
- **Exports:** `@crombolo/crombolo/host` exports `ownerSetup`, `OwnerSetup` and
  `OwnerSetupInput` (`docs/api/surface.json` refreshed).
- **Tests:**
  - `tests/owner-setup.test.ts`;
  - in `tests/custom-tables.test.ts`, "a host makes each owner from ownerSetup, and a
    site without CREATEROLE boots on them" (Postgres), and the existing limited-user
    test now asserts the error's statements are `ownerSetup`'s;
  - in `tests/extension-permissions.test.ts`, the two refusals.
- **Docs:** `data-model.md` ("A host that provisions roles itself"), `bundles.md`,
  `extensions.md`, `api.md` and the release notes.
