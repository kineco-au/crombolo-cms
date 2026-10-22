# 052 — Types for every content type

**Epic:** F — Headless · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a front-end developer, I want TypeScript types for my site's content types
and a small typed client for the Delivery API, so that my editor completes
property names and a renamed property fails my build instead of my page.

## Context

The schema is already code: content types, data types and compositions are
TOML under `schema/` ([`schema-as-code.md`](../../schema-as-code.md)), and each
data type's editor fixes the shape the Delivery API writes for it
([`delivery-api.md`](../../delivery-api.md), "Output"). Umbraco has nothing
equivalent for headless; its ModelsBuilder generates C# for Razor only, and
"the typed per-content-type contract" is listed as not built.

`crombolo generate` already exists: it writes `schema/content-types.d.ts`, the
values a server-rendered view receives (`PublishedContent`, `BlockItem`, from
`@crombolo/crombolo`). The Delivery API writes different JSON, so this is a
second output from the same schema loading.

### Decisions (2026-10-21)

- **Source: the schema files.** Read `schema/*.toml` as `crombolo generate`
  does: offline, in CI, no running site. An app in another repo commits the
  generated file or points `--schema` at a checkout of the site.
- **Command and client: `crombolo generate --delivery --out <file>`** writes
  types only. The client is a small zero-dependency package,
  `@crombolo/delivery-client`, released with the rest of the set, generic over
  the generated type map, so client fixes reach apps through npm.
- **The client ships built JavaScript.** Every other package is TypeScript
  source run by Bun; a browser app's toolchain cannot rely on that (Node will
  not strip types inside `node_modules`, Next.js needs `transpilePackages`). So
  `@crombolo/delivery-client` alone is built at pack time to ESM `.js` with
  `.d.ts` declarations, and its `exports` point at them.
- **Pickers: reference or expanded.** A picker is typed as the content items it
  may hold, with properties that may be empty, and the client exports an
  `isExpanded()` guard. Right for any `expand`; the app narrows when it needs to.

## Acceptance criteria

- [x] `crombolo generate --delivery --out <file.ts>` writes an interface for each content
      type, element type and media type, with compositions merged, and a union
      of all content items keyed by `contentType`
- [x] Each property is typed as the Delivery API writes it: text, numbers,
      dates, true/false, pickers as reference arrays, blocks with their element
      types, rich text as `{ markup, blocks }`, media with crops, and `null`
      where a property may be empty
- [x] Types that `disallowedContentTypeAliases` (or the allow list) keeps out of
      the API are left out
- [x] `@crombolo/delivery-client` covers `item`, `items`, `content`, `media` and `search`,
      sending the key, culture and `Start-Item` headers, and returns the generated
      types
- [x] Pickers are typed as reference-or-expanded, with an `isExpanded()` guard
- [x] Running the command twice on an unchanged schema writes the same file
- [x] A starter or example app uses the generated types
- [x] Tests generate types for the demo schema and type-check a file using them;
      documented in `delivery-api.md`

## What was built

- **The generator**, `generateDeliveryTypes` in
  `packages/schema/src/generate-delivery.ts`, beside `generateTypes`, sharing its
  composition and block handling (`effectiveProperties`, `blockElements`,
  `dataTypeOf`, now exported). It writes `DeliveryTypes` (`content`,
  `elements`, `media` by alias), `Content`, `Media`, `ContentReference`,
  `MediaReference`, `MediaWithCrops` and `Element`, and one properties interface
  per type. Media types include the built-in ones the site has no file for, with
  the `umbraco*` properties left out, as the API leaves them out. Every property
  is `| null`.
- **The command**: `crombolo generate` gains `--delivery`, `--out` and
  `--schema`. `--delivery` needs `--out` — the file belongs in the app, and a
  site's own type check would fail on an import of a package it does not have.
  The allow and disallow lists come from the site's `deliveryApi` settings, so
  the CLI now depends on `@crombolo/api-delivery`.
- **The client**, `packages/delivery-client/src/index.ts`: one file, no
  imports, so the build is a single entry and the declarations a single file.
  `fields` narrows the properties' types to `Partial`.
- **Publishing**: `scripts/delivery-client.ts` builds with `Bun.build` and
  `tsc --emitDeclarationOnly --ignoreConfig`; `publish-packages.ts` builds it,
  packs it under `builtManifest`, and restores the source manifest and removes
  `dist/` afterwards. It is opt-in in `tests/packaging.test.ts`: no site depends
  on it.
- *Example app:* the app in `tests/delivery-types.test.ts`, type-checked against
  the generated types with `@ts-expect-error` lines for what must not compile,
  and the usage in the package's README and `delivery-api.md`. There is no
  runnable starter app.
- Tests: `tests/delivery-types.test.ts` (each editor's type, the maps, the
  allow list, determinism, the demo schema, the app type check),
  `tests/delivery-client.test.ts` (every method against a running site, headers,
  errors, the build and the packed manifest), `tests/cli.test.ts` (the flags).
