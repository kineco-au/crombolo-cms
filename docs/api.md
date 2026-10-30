# The supported API

What a site, a bundle's author and a host may depend on across releases, and
what they may not (story 173).

## The entry points, one package

Everything supported comes from `@crombolo/crombolo`, split by who is using it:

| Entry point | For | What is in it |
| --- | --- | --- |
| `@crombolo/crombolo` | a site | `defineConfig`, `crombolo()`, `cromboloServer()` and `ServerHandle`; the site's own tables (`defineSiteTables`, `TablesDatabase`, `ShapeDatabase`, `SiteTables`, `SiteStep`, `SqlStep`, `AnonymiseRules`, story 189); the presets for identity providers, e-mail and media stores; the view API (`Blocks`, `Form`, `Island`, `SeoHead`, `AntiforgeryMeta`, `search`, `usePage` and their types); `VERSION` |
| `@crombolo/crombolo/bundle` | a server bundle's author | `ServerBundle`; its routes (`route`, `BundleRoute`, `RouteHandler`, `RouteContext`, `RouteMethod`, `RouteOptions`); what a handler is given (`BundleRouteContext`, `Principal`, `BundleMember`, `BundleCaller`, `BundleHost` and the capabilities, `BundleMedia` and its types among them); `BundleSection`; `defineBundleTables`, `TablesDatabase` and their types; jobs (`BundleJob`, `OwnerJobs`, `JobInfo`, `JobSchedule`, `JobStatus`) |
| `@crombolo/crombolo/navigation` | a site's page code | the functions that end a page early, mirroring `next/navigation`: `redirect`, `permanentRedirect`, `notFound`, `forbidden`, `unauthorized`, the HTTP-named extras (`foundAt`, `movedPermanentlyTo`, `seeOther`, `badRequest`, `gone`, `unprocessableContent`) and `rethrow` (story 206) |
| `@crombolo/crombolo/headers` | a site's page code | `cookies()` and `headers()`, read-only, mirroring `next/headers` |
| `@crombolo/crombolo/server` | a site's page and data code | `site()`, the site's services acting as the visitor; named queries (`NamedQuery`, `QueryCaller`, `QueriesOf`, `SiteQueries`, and `Register` for the config's types); background jobs (`SiteJobs`, `SiteJobStatus`, `JobInfo`, `JobSchedule`, story 187); `Result`, `Ok`, `Outcome`, `ok`, `isOk`, `isOutcome` and their types |
| `@crombolo/crombolo/routes` | a site's route handlers | the route contract bound to crombolo's types (`route`, `RouteHandler`, `RouteContext`, `SiteRoute`, `RouteOptions`, `RouteMethod`, `ROUTE_METHODS`), `Outcome`, `ok`, `FieldError`, `CookieOptions` and `fromRouteModule` (story 211) |
| `@crombolo/crombolo/middleware` | a site's middleware | the middleware contract bound to crombolo's types (`Middleware`, `MiddlewareHandler`, `MiddlewareContext`), `rewrite`, `withCookie`, `NextResponse` and `fromNextMiddleware` (story 210) |
| `@crombolo/crombolo/islands-react` | the browser | `mount`, which renders a `'use client'` island with React; Crombolo's island build includes it, and a Vite build lists it as an input (story 209) |
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
| `@crombolo/common` | the contracts outside code is written against: `Result` and `Outcome`, the middleware contract with `rewrite` and `withCookie` (story 210), and the route contract with `route` (story 211); no dependencies |
| `@crombolo/delivery-client` | the typed Delivery API client |
| `@crombolo/next-integration` | the Next.js front end: `createCrombolo`, the caching adapters, route handlers, middleware, components and image loader (story 208) |
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
| `defineBundleTables`, `assertBundleTables`, `bundleTablesCompatibility`, `BundleTables`, `BundleStep` | `@crombolo/crombolo/bundle` |
| `createServer`, `loadConfig`, `liveNodes`, `LiveNode`, `BundleReload`, `ReloadedBundle` | `@crombolo/crombolo/host` |
| `validateBundlePackage`, `peerRangeProblem`, `BundlePackage`, `CromboloField`, `PackageJson` | `@crombolo/crombolo/host` |
| `checkBundleCode`, `installBundleCode`, `BundleCodeCheck`, `BundleCodeInstall`, `BundleCodeOptions` | `@crombolo/crombolo/host` |

A host that imports `upgradePlan`, `upgradeFix`, `contentImport`, `siteExport`
or `findTemplate` from `@crombolo/cli` takes them from
`@crombolo/crombolo/host` instead. A bundle that imported types from
`@crombolo/server` takes them from `@crombolo/crombolo/bundle`, and drops the
dependency in favour of its peer on `@crombolo/crombolo`.

## Media read asynchronously (0.35.0)

**An exception to the promise above.** The accessors that can resolve media
changed in place in 0.35.0, with no minor of deprecation (story 197). Media
left the published snapshot, so a value that names media is looked up as it is
read, and a lookup is asynchronous. Keeping the synchronous accessors working
for one more minor would have meant keeping every media item in every server's
memory for that minor, which is the problem the release fixes.

| Accessor | Was | Now | The change to make |
| --- | --- | --- | --- |
| `model.media(alias)` | `MediaWithCrops[]` | `Promise<MediaWithCrops[]>` | `const [hero] = await model.media('hero')` |
| `model.value(alias)`, a Media Picker | `MediaWithCrops \| MediaWithCrops[] \| null` | a promise of the same | `await model.value('hero')` |
| `model.value(alias)`, a Multinode Treepicker | `PublishedContent[]` | `Promise<Array<PublishedContent \| PublishedMedia>>` | `await model.value('related')` |
| `model.value(alias)`, a Multi URL Picker | `Link[]` | `Promise<Link[]>` | `await model.value('links')` |
| `model.html(alias)` | `RawHtml` | `RawHtml \| Promise<RawHtml>` | none in JSX: `{model.html('body')}` renders either |
| `model.value(alias)`, rich text | `string` | `string \| Promise<string>` | use `html()` |
| `model.text(alias)`, rich text | links to media resolved | links to media are `#` | use `html()` |
| `effectiveMeta(…)` | `EffectiveMeta` | `Promise<EffectiveMeta>` | `await effectiveMeta(…)` |
| `SeoHead` | `RawHtml` | `Promise<RawHtml>` | none in JSX |

The same holds on a block's elements (`content.value()`, `content.html()`, and
the new `content.media()`). A component that awaits one is declared `async`;
JSX renders async components as any other. `crombolo components check` reports
each use that does not wait, and `crombolo generate` types these properties as
promises. `menu()`, `text()` and every other editor's `value()` are unchanged.
`MediaWithCrops` and `PublishedMedia` are now exported as types from
`@crombolo/crombolo`.

## Member and public routes (0.35.0)

Story 186 added names to `./bundle` and `AntiforgeryMeta` to the root, and
changed nothing a bundle already wrote. `ServerBundleRoute` is now a union on
`audience`: a route that names none is a `BackofficeBundleRoute`, whose handler
is given `BundleRequest` as before; a `MemberBundleRoute`'s handler is given
`BundleMemberRequest`, with `member: BundleMember` and no `principal`; a
`PublicBundleRoute`'s is given `BundlePublicRequest`, with neither. Every
request also carries `caller: BundleCaller`. `bundles.md`, Part 3, "Routes for
members and visitors".

## Route handlers replace bundle routes (0.37.0)

**An exception to the promise above.** Story 211 retired 186's bundle routes
with no minor of deprecation, at the maintainer's decision.
`ServerBundleRoute`, `BackofficeBundleRoute`, `MemberBundleRoute`,
`PublicBundleRoute`, `BundleAudience`, `BundleRateLimit`, `BundleRequest`,
`BundleMemberRequest` and `BundlePublicRequest` are gone. A bundle's routes
are `route()` handlers (`BundleRoute`), given `(request, context)` with the
capabilities on `context.bundle`. Site routes no longer answer under
`/crombolo/bundle/<id>/`. A package with a server half declares
`"schemaVersion": 2`, and one that does not is refused. `bundles.md`, Part 3,
"Routes", lists the changes to make.

## A bundle's tables move into a place of their own (unreleased)

**An exception to the promise above.** Story 189 moved a bundle's tables out
of crombolo's schema, with no minor of deprecation, at the maintainer's
decision (189, decision 10): nothing outside the repository used them.
The `tables` capability, `BundleTablesCapability`, `TableHandle`, `Where` and
`SiteSql` (`site().sql`) are gone. A bundle that declares tables gets
`context.bundle.database`, a Kysely handle typed from its steps, without asking
for a capability; a backfill is handed the same handle. The site's own tables
are queried through `site().queries`. `bundles.md`, Part 4, "Moving from 062's
prefixed tables", says what happens to tables already made.

## Bundles declare their permissions (unreleased)

**An exception to the promise above.** Story 222 moved the bundle format to
schema 3 with no minor of deprecation, at the maintainer's decision: a server
half declares `crombolo.permissions`, and one written for schema 2 is refused.
`@crombolo/crombolo/bundle` is unchanged; what changed is the package's
manifest, and that a capability refuses a method its declared permissions do
not cover. `bundles.md`, "Permissions", lists them.
