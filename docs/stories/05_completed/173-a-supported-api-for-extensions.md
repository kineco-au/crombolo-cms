# 173 — A supported API for extensions

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** M
**Depends on:** 062, 063

## Story

As an extension author, I want a small, documented API with a clear compatibility
promise, so that I can upgrade crombolo without depending on its internals.

## Context

The architecture review scored extension boundaries **3/5**. Bundles already
have explicitly wired factories, namespaced routes, host-enforced access checks
and narrow capabilities. The bundle host does not provide a raw database.

However, `packages/server/src/index.ts` exports most adapters and runtime
machinery, while `packages/data/src/index.ts` exposes repositories, migrations
and database internals. Consumers can depend on those exports even though the
capability interface is narrow, making internal changes public obligations.

The candidate is an intentional supported export surface with automated checks
against accidental growth. Installed extensions remain trusted in-process
JavaScript; this is an API stability boundary, not a sandbox.

Already promised to hosts by story 181, so part of whatever boundary this
draws: `cromboloServer()` and the `ServerHandle` it returns (with
`reloadBundles()`, `BundleReload` and `ReloadedBundle`), and
`validateBundlePackage`, `peerRangeProblem` and `PackageJson`, all from
`@crombolo/crombolo`.

## Inventory (2026-10-28)

| Consumer | Imports today |
|---|---|
| Sites (`sites/*`, `wt-natures-calendar`) | `@crombolo/crombolo` only. It already has explicit named exports and no `export *`. |
| First-party bundles (`simple-redirects`, `entra`) | Types only, from the internal `@crombolo/server`: `ServerBundle`, `BundleRequest`, `BundleSection`, `BundleRedirectInput`, `ProviderOverrideInput`. |
| Crombolo Cloud | `@crombolo/crombolo` 33 times (`createServer`, `loadConfig`, `CromboloConfig`, `ServerHandle`, the media stores, `liveNodes`, `VERSION`, `validateBundlePackage`, `peerRangeProblem`, `defineConfig`, `oidc`, `Html`), and `@crombolo/crombolo/branding`. Also `@crombolo/cli` 17 times (`upgradePlan`, `upgradeFix`, `contentImport`, `siteExport`, `findTemplate`), `@crombolo/contracts` and `@crombolo/remote-conformance`. |
| Every internal package | Published, with `exports: "."` exposing all of it. `@crombolo/server` and `@crombolo/data` each have about 105 export lines. |

## Decided (2026-10-28)

- **The supported API is `@crombolo/crombolo`, split into subpaths by
  audience:**
  - `.` for a site: `defineConfig`, `crombolo()`, `cromboloServer()`, the JSX
    and view types, and the presets for identity, e-mail and media.
  - `./bundle` for a server bundle's author: `ServerBundle`, its routes,
    request, capabilities and sections, and `defineBundleTables` with its
    types.
  - `./host` for whoever runs sites: `createServer`, `loadConfig`,
    `ServerHandle`, the media and schema stores, `liveNodes`, the bundle
    checks (`validateBundlePackage`, `peerRangeProblem`, `checkBundleCode`,
    `installBundleCode`), and the operations Cloud takes from `@crombolo/cli`
    today.
  - `./branding` and the JSX runtimes stay as they are.

  Internal packages stay published, because the umbrella depends on them. Each
  one's `package.json` description and README say it is internal and carries
  no promise.
- **The promise before 1.0: breaks only in a minor, after a deprecation.** A
  patch never breaks the supported API. A minor may remove or change an export
  only after one minor in which it still worked, was marked `@deprecated`, and
  was named in the release notes with its replacement. Where that is
  impractical, the notes say why. Internals change in any release.
- **The check is names, with a committed snapshot.** A test reads each
  supported entry point's explicit export lists, fails on any `export *`, and
  compares the names to `docs/api/surface.json`. Adding or removing a name
  fails until the snapshot is updated deliberately. Signatures are not
  snapshotted: TypeScript 7's native compiler has no stable JS API.

## Plan (2026-10-28)

1. **Entry points.**
   - `packages/crombolo/src/bundle.ts` and `src/host.ts`, as explicit
     `export { … } from` lists, added to the umbrella's `exports`.
   - The root keeps every name it exports today, so nothing a site uses moves.
     Host-only names that sit at the root now (`createServer`, `loadConfig`,
     `ServerHandle`, `liveNodes`, the bundle checks) also go in `./host`, and
     are marked `@deprecated` at the root.
   - The CLI operations Cloud uses are re-exported from `./host`. The umbrella
     already depends on `@crombolo/cli`.
2. **First-party bundles** import from `@crombolo/crombolo/bundle`.
   `simple-redirects` and `entra` change their `@crombolo/server` dependency to
   a peer on `@crombolo/crombolo`, as third-party bundles have.
3. **An external-consumer fixture.** `tests/fixtures/consumers/` holds a tiny
   site, a server bundle and a host script that use only the three entry
   points. A test type-checks them with `tsc --noEmit`, and boots the site with
   the bundle wired.
4. **The checks** (`scripts/api-surface.ts`, `tests/api-surface.test.ts`).
   - **Surface:** parse the entry points' export lists (with `type` names
     marked), fail on `export *` and on any subpath beyond the agreed ones in
     the umbrella's `exports`, and compare to `docs/api/surface.json`.
     `bun run api:snapshot` rewrites the snapshot.
   - **Boundary:** `packages/simple-redirects`, `packages/entra`, `sites/*`
     and the fixture may import `@crombolo/*` only through
     `@crombolo/crombolo`, `@crombolo/crombolo/{bundle,host,branding}` and the
     JSX runtimes.
   - **Deprecations:** every name the snapshot marks deprecated still resolves,
     and carries `@deprecated` in its entry point.
5. **Internal packages labelled.** Each internal package's `description` says
   "Internal to crombolo: use @crombolo/crombolo", and a short README points at
   the supported API. `release:version` keeps them in step as now.
6. **Crombolo Cloud.** A migration note lists each import it has today and its
   new place: root to `./host`, and `@crombolo/cli` to `./host`.
   `@crombolo/contracts` and `@crombolo/remote-conformance` are the
   remote-protocol packages (story 107), and stay supported in their own right.
   The Cloud repo moves in its own change, after the release.
7. **Docs.**
   - `docs/api.md` (new): the three audiences, each entry point's contents,
     the compatibility promise, the deprecation process, and that this is a
     stability boundary, not a sandbox: wired code is trusted and in-process
     (see `docs/bundles.md`, Part 3).
   - The README's package table marks which packages are supported.
   - `docs/bundles.md` points bundle authors at `./bundle`.
   - The release notes give each moved name.
8. **Unchanged, and re-run:** route authorization, capability restrictions,
   table isolation and the package-compatibility tests. No behaviour changes.

## Acceptance criteria

- [x] Document the supported extension surface and its versioning promise.
- [x] First-party bundles and external-consumer fixtures compile and run using
      supported entry points only.
- [x] Package exports expose the agreed surface without accidental wildcard
      exports or unrestricted subpaths revealing internals.
- [x] Automated API-surface and import-boundary checks catch unintended exports
      and first-party extension imports of internal implementations.
- [x] Existing route authorization, capability restrictions, table isolation and
      package compatibility checks continue to pass.
- [x] Changed exports have tested migration paths and release notes; there are
      no unexplained removals of previously public APIs.
- [x] README and bundle docs explain package boundaries, supported APIs and
      trusted code execution.

## Out of scope

Sandboxing JavaScript, replacing the Umbraco frontend extension model, or
redesigning storage to hide its implementation from extensions.

## As built (2026-10-28)

- **The entry points.** `packages/crombolo/src/bundle.ts` and `src/host.ts`
  are explicit export lists, added to the umbrella's `exports`.
  - The root lost no name: checked against v0.33.1's root.
  - The 38 names that moved are exported again at the root's end, one
    statement each, under a `/** @deprecated Import it from … */` note. That
    is the marker the snapshot reads. Editors may not strike a re-export
    through.
  - `cromboloServer` is in both `.` and `./host`.
- **The snapshot.** `scripts/api-surface.ts` parses export statements with
  their leading doc comment, marks `type` names, and refuses `export *`. The
  JSX runtimes are skipped: their names are the JSX compiler's.
  `bun run api:snapshot` writes `docs/api/surface.json` and formats it with
  Biome.
- **The tests.** `tests/api-surface.test.ts` (8 tests):
  - the snapshot matches;
  - the subpaths are the agreed ones;
  - every deprecated root name resolves and is offered where it moved;
  - every snapshotted value resolves from its entry point;
  - the import boundary holds, walking the files itself because the test
    image has no `git`, and checking that it found the files it should;
  - the first-party bundles declare no internal dependency;
  - the outside consumer boots with its bundle wired and answers on the
    bundle's route;
  - a host builds a config and vets packages.
- **First-party bundles** import types from `@crombolo/crombolo/bundle`, and
  `simple-redirects` and `entra` dropped their `@crombolo/server` dependency.
- **Internal packages.** 13 internal packages have the description prefix
  "Internal to crombolo, with no compatibility promise: use
  @crombolo/crombolo", and a README pointing at the entry points. Supported in
  their own right: `cli` (the command), `delivery-client`, `contracts`,
  `remote-conformance`, and the two bundles.
- **Crombolo Cloud** moves in its own change after the release. Its imports
  are mapped in `docs/api.md`, "Moving to the entry points".
