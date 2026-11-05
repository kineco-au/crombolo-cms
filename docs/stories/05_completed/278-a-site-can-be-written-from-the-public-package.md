# 278 — A site can be written from the public package

**Epic:** H — Importing a site · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As the author of a tool that produces a crombolo site, I want to write schema
files and a content bundle through `@crombolo/crombolo`, so that a tool
outside this repository does not have to reach into internal packages.

## Context

The formats a tool writes to produce a site, the schema files and the bundle,
are read by the CMS and written by `crombolo export`, but their writers live
in `@crombolo/schema` and `@crombolo/transfer`, which carry no compatibility
promise. A subpath on the umbrella, as `@crombolo/crombolo/branding` is, keeps
a browser or a site's server from pulling them in.

## Acceptance criteria

- [x] `@crombolo/crombolo/transfer` exports what writing a site takes: the
      schema writers and `validateSchemaSet`, `hashSchemaSet`,
      `loadSchemaDirectory`, the built-in types, `writeBundle`,
      `writeBundlePackage`, `loadBundle`, `openBundle`, `newSeal`,
      `bundlePeerRange`, `referenceCandidates`, `toEditorValue`, `ObjectTypes`,
      `scaffoldFiles`, `writeUdtAll`, `writeDomainsFile`, `componentAliasesIn`,
      and the bundle's types.
- [x] A bundle may carry a person with no password hash, as `site-file.test.ts`
      holds.
- [x] `docs/api.md` lists the subpath, and `docs/api/surface.json` its exports,
      under the same compatibility promise as the rest of the umbrella.
- [x] `tests/packaging.test.ts` holds that the main entry does not pull it in.

## Out of scope

- Any change to the formats themselves.
