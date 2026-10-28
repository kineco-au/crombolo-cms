# The supported API

What a site, a bundle's author and a host may depend on across releases, and
what they may not (story 173).

## Three entry points, one package

Everything supported comes from `@crombolo/crombolo`, split by who is using it:

| Entry point | For | What is in it |
| --- | --- | --- |
| `@crombolo/crombolo` | a site | `defineConfig`, `crombolo()`, `cromboloServer()` and `ServerHandle`; the presets for identity providers, e-mail and media stores; the view API (`Blocks`, `Form`, `SeoHead`, `search`, `usePage` and their types); `VERSION` |
| `@crombolo/crombolo/bundle` | a server bundle's author | `ServerBundle` and `ServerBundleRoute`; what a handler is given (`BundleRequest`, `Principal`, `BundleHost` and the capabilities); `BundleSection`; `defineBundleTables` and its types |
| `@crombolo/crombolo/host` | whoever runs sites | `createServer`, `loadConfig`, `cromboloServer` and `ServerHandle`; the media and schema stores; `liveNodes`; the bundle checks (`validateBundlePackage`, `peerRangeProblem`, `checkBundleCode`, `installBundleCode`); and the operations a deploy runs (`upgradePlan`, `upgradeFix`, `contentImport`, `siteExport`, `findTemplate`) |

`@crombolo/crombolo/branding` (the marks and the palette) and the JSX runtimes
are supported too. The JSX runtimes' names are the JSX compiler's contract, not
ours.

Every name each entry point exports is listed in [`api/surface.json`](api/surface.json).

## The promise, before 1.0

- **A patch never breaks the supported API.**
- **A minor may remove or change an export, after a deprecation.** The export
  first spends one minor still working, marked `@deprecated` where it is
  exported, and named in the release notes with its replacement. When that is
  impractical, the release notes say why.
- **Everything else is internal and can change in any release.** That covers
  every other `@crombolo/*` package except the ones below, and any deep import
  into a package.

These packages are supported in their own right:

| Package | What is supported |
| --- | --- |
| `@crombolo/cli` | the `crombolo` command and its documented flags (its JavaScript exports are internal: use `./host`) |
| `@crombolo/delivery-client` | the typed Delivery API client |
| `@crombolo/contracts`, `@crombolo/remote-conformance` | the API documents and the remote protocol's conformance checks (`docs/remote-protocol.md`) |
| `@crombolo/simple-redirects`, `@crombolo/entra` | as bundles: the factory a site wires, and the screens |

The internal packages are still published, because `@crombolo/crombolo` depends
on them. Each one's `package.json` description and README say it is internal.

## How it is held

- **The snapshot.** `tests/api-surface.test.ts` reads each entry point's
  explicit export lists. It fails on any `export *`, on any subpath beyond the
  agreed ones, and on any name added or removed against `docs/api/surface.json`.
  A deliberate change runs `bun run api:snapshot` and commits the new snapshot,
  so the change shows in review. Names are held, not signatures: TypeScript 7's
  native compiler has no stable JavaScript API to read them with.
- **Deprecations.** Every name marked deprecated still resolves where it was,
  and is exported from the entry point it moved to.
- **The import boundary.** The first-party bundles, the sites in `sites/` and
  an outside-consumer fixture (`tests/fixtures/consumers/`) may import
  `@crombolo/*` only through the supported entry points and the bundle packages
  a site wires. The fixture is a site config, a server bundle and a host script.
  The suite type-checks it, boots a site with its bundle wired, and calls the
  bundle's route.

## Not a sandbox

This is a stability boundary. A wired server bundle, and a site's own code, run
in the server process with everything that process can reach: the database,
the files and the environment. The capabilities in `./bundle` are what crombolo
hands a bundle, not a limit on what its code can do ([`bundles.md`](bundles.md),
Part 3). Installing server code from the Marketplace takes an explicit yes for
that reason (story 194).

## Moving to the entry points (0.34.0)

Names that belong to a bundle's author or a host moved off the root. They still
work at the root through 0.34, marked deprecated:

| Name | Now in |
| --- | --- |
| `ServerBundle`, `ServerBundleRoute`, `BundleRequest`, `BundleHost`, `BundleCapability`, `BundleDocuments`, `BundleLog`, `BundleMethod`, `BundleRedirects`, `BundleRedirectRule`, `BundleRedirectInput`, `BundleSection`, `Principal`, `AppAlias` | `@crombolo/crombolo/bundle` |
| `defineBundleTables`, `assertBundleTables`, `bundleTablesCompatibility`, `BundleTables`, `BundleTablesCapability`, `BundleStep`, `TableHandle`, `Where` | `@crombolo/crombolo/bundle` |
| `createServer`, `loadConfig`, `liveNodes`, `LiveNode`, `BundleReload`, `ReloadedBundle` | `@crombolo/crombolo/host` |
| `validateBundlePackage`, `peerRangeProblem`, `BundlePackage`, `CromboloField`, `PackageJson` | `@crombolo/crombolo/host` |
| `checkBundleCode`, `installBundleCode`, `BundleCodeCheck`, `BundleCodeInstall`, `BundleCodeOptions` | `@crombolo/crombolo/host` |

A host that imports `upgradePlan`, `upgradeFix`, `contentImport`, `siteExport`
or `findTemplate` from `@crombolo/cli` takes them from
`@crombolo/crombolo/host` instead. A bundle that imported types from
`@crombolo/server` takes them from `@crombolo/crombolo/bundle`, and drops the
dependency in favour of its peer on `@crombolo/crombolo`.
