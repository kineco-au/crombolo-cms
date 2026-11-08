# 300 — Checking a bundle runs none of its code

**Epic:** I — Hardening · **Priority:** must · **Size:** S
**Depends on:** —

## Story

As someone running a site, I want checking a content bundle to only read it, so that
uploading a bundle to see what it would do never runs code from it, whoever uploaded
it and whatever its signature.

## Context

Checking a bundle in the backoffice (`contentCheck`, `bundle-install.ts`) plans the
carried sections (`planSections`). When the bundle carries schema, the plan checks
it against an overlay of the site's `schema/` (`checkSchemaOverlay`,
`bundle-sections.ts:214`). That check calls `checkSchemaDirectory`, which calls
`loadValueMigrations(schemaDir)`, which runs `import()` on every
`schema/migrations/*.ts` in the overlay, the bundle's included
(`packages/schema/src/value-migrations.ts:79`).

So a bundle's migration modules run inside the site's process during the check. That
happens:
- before any consent, since a check is what you look at before deciding;
- before `runtimeInstalls` is looked at, as it is only at install
  (`bundle-install.ts:658`);
- with the default signature policy (`CROMBOLO_BUNDLE_SIGNATURES=optional`), which
  takes unsigned bundles.

Anyone who may check a bundle can therefore run code as the site.

## The design

- **A check never imports a bundle's modules.** The overlay check loads the site's
  own migrations as it does today. The bundle's own `schema/migrations/*.ts` are
  listed by name only, and the report says each would run at install.
- **An editor change that needs a converter** is reported as needing data work, as
  now. If the converter is one the bundle brings, the report says so by file name
  and does not run it.
- **Migrations a bundle brings are code.** An install that would add or replace a
  `schema/migrations/*.ts` is refused unless code installs are allowed
  (`runtimeInstalls`) and the person installing asked for code ("install code"), as a
  bundle's other code is, with the same words. A local apply from the CLI is
  unaffected.
- **A test pins it:** a bundle whose migration writes a marker file when imported is
  checked, and no marker appears.

## Decisions (2026-11-08)

- **Migrations need both, like a bundle's other code:** `runtimeInstalls` on, and
  install code asked for. Without either, the install is refused, naming the migrations.

## Implementation plan

1. **The check imports nothing of the bundle's** (`packages/server/src/schema.ts`,
   `bundle-sections.ts`):
   - `checkSchemaDirectory` takes `migrationsDir`, defaulting to `config.schemaDir`.
     `checkSchemaOverlay` passes the site's own `config.schemaDir`, so the overlay's
     schema is checked against the site's migrations only.
   - The bundle's paths under `schema/migrations/` are copied into the overlay as now
     (they are files, not loaded), and also returned from the plan as
     `migrations: string[]`.
   - The check's report gains `migrations`: each carried migration by file name, "runs
     at install, not during this check". A breaking change it would have covered stays
     reported as needing data work, followed by "the bundle brings
     `schema/migrations/<name>` for it, which runs only at install".
2. **The install gate** (`bundle-install.ts`, beside story 241's code check):
   - Carried migrations join `code` when the bundle is not `local`. So they need
     `effective.installCode` and `config.runtimeInstalls`, refused with the same words
     (`installsElsewhere`, or "this site does not install code while it runs"), naming
     the migrations.
   - A migration that would replace the site's own is an `overwrite`, needing
     `--replace-files` as any replaced file does.
   - A `local` apply (the CLI's `bundle apply`) is unchanged.
3. **Docs:** `bundles.md` says a bundle's migrations are code, are listed but never run
   by a check, and run only at install where code installs are allowed and asked for.

## Tests

- **A marker migration:** a bundle carrying `schema/migrations/stamp.ts` whose module
  body writes a file when imported. Checking it (`contentCheck`) writes no file, and the
  report lists `stamp.ts` as running at install.
- **Install:** with `runtimeInstalls` off, or install code not asked, the install is
  refused naming `stamp.ts`, and still no file is written. With both, it installs and
  the migration runs.
- **Local:** `bundle apply` of a site's own content with a migration runs as before.

## Implemented (v0.56.0)

- `checkSchemaDirectory` takes `migrationsDir`; the overlay check passes the site's own
  `schemaDir`. A finding the bundle's migrations might have covered is followed by one naming
  them, as running only at install.
- `SectionPlan.migrations` lists the carried migrations; `crombolo bundle apply --dry-run`
  prints each as "runs at install, not during a check".
- `migrationChanges` (`bundle-sections.ts`) is the one list of migrations a bundle would add or
  change. The install gate refuses them without `installCode` and `runtimeInstalls`, and the
  remote apply counts them as code, so they need `Crombolo.Remote.InstallCode` too. A `local`
  apply is exempt. The CLI's `bundle apply` already asks for code.
- `bundle build` never carries `schema/migrations/*.ts` (only `.toml`), so the threat is a
  hand-made bundle. The tests write one with `writeBundle` (`tests/bundle-install.test.ts`).

## Acceptance criteria

- [x] Checking a bundle that carries `schema/migrations/*.ts` imports none of them:
      a migration that writes a file when imported writes nothing during the check.
- [x] The check lists those migrations by name, as running at install.
- [x] With `runtimeInstalls` off, or install code not asked for, an install that adds
      or replaces a migration is refused, saying it carries code. With both, the
      migration runs at install.
- [x] `crombolo bundle apply` from the CLI is unaffected.
- [x] `bundles.md` says a bundle's migrations are code and run only at install.
