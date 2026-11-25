# 424 — A replace takes the file's schema whatever its version

**Epic:** K — Moving content · **Priority:** should · **Size:** M
**Depends on:** 105

## Story

As a host making one site a copy of another, I want a replace to take the file's
schema even when the site being replaced has a newer schema version, so that a site
whose types moved on can be levelled back to the one it is copied from.

## Context

Asked for by Crombolo Cloud on 2026-11-25, seen on 0.79.0, and the cause confirmed here
by reading. Not built.

`contentImport` with `replace` from site A's export into site B, where B has types made
since A's version, is refused: "the schema this bundle carries was not applied: files
are at 0.1.0+0, database at 0.2.0+0; running in compatibility mode".

A replace stages the schema from the file alone and syncs it inside the install's
transaction with `forceRetireTypes` (`packages/server/src/bundle-install.ts`). The sync
(`syncSchema`, `packages/schema/src/sync.ts`) compares the staged files' version with
the database's current state:

- **older:** `skipped-older`, which the install turns into a refusal;
- **the same version, other definitions, on a site not in development:** refused, "the
  definitions changed without a new version";
- **newer:** applied.

Both rules protect a rolling deploy, where an older node must never undo a newer one's
schema. A replace is not that: it says the file is what the site should be. So a
replace works only towards a newer schema, and "Studio becomes Production" fails
exactly when Studio made a type it has not sent on.

Going back has consequences the rules were hiding:

- **The database's current state would be an older version.** The current state is the
  latest row of `schema_state`, so one appended at 0.1.0 after 0.2.0 is current. A node
  still running from 0.2.0 files is then ahead of the database, and on its next start
  its sync would apply 0.2.0 over the replace. A site whose schema is in its schema
  store is safe once the install publishes the staged schema to it; a site whose schema
  is baked into its image is not.
- **Pages of a type the file lacks** are already gone by the time the schema syncs
  (`pruneSite`), so `forceRetireTypes` retiring those types loses nothing more.

## The design

- **A replace applies the file's schema whatever its version:** older, or the same
  version with other definitions, as well as newer. The site's schema version becomes
  the file's. No new option: a replace already takes the file's side of content, files
  and types without being asked, and this was the one exception.
- **An import that is not a replace** is refused in both cases, as today.
- **A file with no schema at all** is refused on a replace, with a sentence saying the
  file carries no schema. This is what stopped an empty export retiring every type on
  2026-11-24. A schema with no `schema.toml` is taken as it is today.
- **The check says so beforehand:** `siteReplaceCheck` reports that the schema will go
  from the site's version to the file's, and which types will be retired, and changes
  nothing.
- **A site whose schema is not in a schema store** is not refused: the CMS cannot tell
  an image from a disk that is kept. `docs/content-transfer.md` says a replace stays
  only where the schema is in the store, or the site is deployed again with it.

## Decisions (2026-11-25, the maintainer's)

1. **No new option.** A replace takes the file's schema as it takes everything else.
2. **The site ends at the file's version,** though that is lower: not a new version
   above both.
3. **No refusal for a site with its schema in its image;** the docs say what it needs.

## Acceptance criteria

- [x] A replace from a file whose schema is older than the site's applies it: the types
      the file lacks are retired, the site's schema version is the file's, and a `runId`
      is returned.
- [x] A replace's sync applies the same version with other definitions on a site not in
      development.
- [x] An import that is not a replace is refused, as today.
- [x] A replace from a file with no schema, onto a site that has one, is refused, saying
      the file carries no schema.
- [x] The replace check names the version going back and the types to be retired, and
      changes nothing.
- [x] Tests on both dialects; `docs/content-transfer.md` and the release notes say a
      replace can take the schema back, and where it stays.

## Implementation

- `SyncOptions.takeFiles` (`packages/schema/src/sync.ts`): skips `skipped-older` and the
  refusal of a same-version change in production. Only the install passes it, on a
  replace (`packages/server/src/bundle-install.ts`).
- **No schema:** the install refuses (`NO_SCHEMA`, `site-replace.ts`) a replace whose file
  carries no schema section where the site's schema state was synced from files. A site
  that has never had schema files takes such a file as before.
- **The check:** `replaceSchema` (`site-replace.ts`) stages the file's sections apart,
  runs the sync as a replace would with `dryRun`, and answers `from`, `to`,
  `retiredTypes` and `refused`; `siteReplaceCheck` puts it on `summary.schema` and
  `crombolo site import` prints it.
- Tests: `tests/schema-sync.test.ts` (the two rules, with `takeFiles`),
  `tests/site-replace.test.ts`, story 424's block.
