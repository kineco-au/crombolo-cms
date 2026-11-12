# 342 — The schema is exported and imported from Settings

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As an administrator, I want to download the site's schema as TOML files and to
upload schema files from another site, previewed and approved before they apply,
so that I can move types and their definitions between sites without the command
line.

## Context

Settings → Developers → "Types for code" opens Umbraco's Models Builder screen.
Crombolo wired it to write the TypeScript declarations a site's templates use
(`schema/content-types.d.ts`, `server/src/models-builder.ts`), but the screen keeps
Umbraco's words, which talk about C# models and ModelsBuilder modes. `crombolo
generate` writes the same file from the command line.

The schema already is TOML (`schema/`), written by `exportSchemaSet`. A bundle's
schema half is applied by copying its TOML into `schema/` and running the sync a
deploy runs, and `checkSchemaDirectory` classifies a change as automatic, needing a
person, or blocking. `<plugin>/api/schema-import` applies the site's own files, with
a dry run, and has no screen.

## The design

- **Settings → Developers → "Schema"**, described "Import or export the model data
  types". It replaces the Models Builder card, and the Models Builder dashboard is
  removed from the back office. TypeScript declarations stay with `crombolo generate`.
- **The whole schema folder**: document, media and member types, data types,
  languages, forms, approval workflows and user groups.
- **Export** downloads the folder as a zip of canonical TOML, as `schema/` holds it.
- **Import** takes a zip (or one `.toml`) uploaded from the browser. Nothing applies on
  upload: it is staged and checked against the site, and appears on the Changes
  dashboard as an Import row, its findings sorted as a schema change's are. It applies
  once approved, through the same copy-into-`schema/`-and-sync path as a bundle, or is
  discarded. One import waits at a time; a new upload replaces the waiting one.
- **Where the back office may not write schema files** (`schemaWritable` false,
  production without a schema store), export still works and import is refused,
  saying the schema changes with a deploy.
- **Who**: administrators. Uploading and approving are audited, with the files the
  import changed.
- **Refused before staging**: anything that isn't TOML under the schema folder's own
  layout, paths that escape it, and a set that doesn't load or validate. Its problems
  are shown on the screen.

## Acceptance criteria

- [x] The Schema card replaces Types for code; nothing in it mentions TypeScript,
      C# or Models Builder
- [x] Export downloads every file under `schema/` as TOML, and importing that zip
      into the same site finds nothing to change
- [x] An uploaded import is shown on Changes with its findings and applies only once
      approved; a blocking finding stops it
- [x] Import is refused where schema files can't be written, and for files outside
      the schema layout or that don't validate
- [x] Upload, approval and discard are audited

## Built

- `packages/server/src/schema-transfer.ts`: export as a zip of every `.toml` under
  `schema/`; upload (a zip, or one `.toml` placed by its first table and by alias),
  checked over a copy of `schema/` with the version raised as far as the change needs,
  kept in `key_value` (`crombolo:schema-import`) with its findings as change-report
  source `import`; apply (checked again, written under the schema lock, synced, put
  back if the sync refuses) and discard. `migrations/` never travels: it is code.
- `packages/server/src/zip.ts` gains `readZip`, bounded by entry count and unpacked size.
- Routes `<plugin>/api/schema-transfer/export`, `…/import` (GET, POST, DELETE) and
  `…/import/apply`, administrators only. They, and the e-mail routes of story 340,
  write their own audit entry, so the generic plugin-write entry skips them (e-mail
  saves had been recorded twice).
- Back office: `schema-transfer.js` (Settings → Developers → Schema, overwriting
  `Umb.Dashboard.ModelsBuilder`), `schema-transfer-client.js`, `schema-transfer-words.js`,
  and a Schema import group on the Changes dashboard with Apply and Discard.
- Tests: `tests/schema-transfer.test.ts`, `tests/schema-transfer-words.test.ts`, the
  card and manifest lists, and `tests/browser/schema-transfer.browser.ts` in place of
  the Models Builder browser test.
- The Postgres suite was not run: no migration, and the new state is a `key_value` row
  and a `change_report` source, both plain text columns already used the same way.
