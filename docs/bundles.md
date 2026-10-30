# Bundles

The backoffice's Bundles section — Umbraco's `Umb.Section.Packages`, renamed
below — covers two things that have nothing to do with each other, and this
document keeps them apart:

- **Created packages** — exporting a slice of this site as a file, which is the
  nine `package` operations in the Management API contract. All nine are
  implemented (`api-coverage.md`).
- **Extensions** — code someone else wrote, added to a site. This used to be the
  `App_Plugins` directory convention inherited from Umbraco; it is now npm
  dependencies, and `App_Plugins` has been removed.

## One artifact: a bundle is an npm package

Every bundle is an npm package, with no exceptions: the Created view's
download, an environment's `bundle export`, a site directory's `bundle build`, and
anything published to the registry. Its `package.json` carries the **bundle
manifest** in its `crombolo` field, and the manifest declares the bundle's three
possible halves:

```json
{
  "name": "@acme/tasks",
  "version": "1.1.0",
  "keywords": ["crombolo-bundle"],
  "peerDependencies": { "@crombolo/crombolo": "^0.10.0" },
  "crombolo": {
    "id": "acme-tasks",
    "name": "Tasks",
    "extensions": [],
    "content": true,
    "server": "tasks",
    "schemaVersion": 2
  }
}
```

| Field | What it is |
| --- | --- |
| `id` | the bundle's one identity: its route segment, its log name, and the prefix of anything else it owns. 2–39 lowercase letters, digits and hyphens, starting with a letter |
| `name` | what a person calls it; the package name when absent |
| `extensions` | the backoffice half, Umbraco extension manifests (Part 2) |
| `content` | `true` when the package carries a payload: `bundle.json` at its root, and the content, schema, components, styles, scripts, dictionary items and code it lists, beside it (Part 1) |
| `server` | the factory the package exports for its server half (Part 3). A declaration only: core never imports it |
| `schemaVersion` | the bundle contract the package is written for; absent means `1`. A package with a `server` must say `2` (0.37, story 211's [routes](#routes)), or it is refused at install and at boot |

A manifest with none of the three halves is refused, because it declares a
bundle that does nothing. `peerDependencies["@crombolo/crombolo"]` is required of
every bundle, and a bundle whose range excludes the running release is refused,
naming the bundle, its range and the running version. `bun run release:version`
moves the range of every bundle this repository commits.

The one module that reads and validates the field is
`backoffice-host/src/bundle-package.ts`, so discovery, the marketplace, the
server half and the installer cannot disagree about what a bundle is.
`@crombolo/crombolo`'s own package carries a `crombolo` field too, its release
declaration, and is never read as a bundle.

**The payload is the package** (story 193). `bundle.json` sits at the root
beside `package.json`, and the directories it lists sit beside them, as
[`content-transfer.md`](content-transfer.md) describes. One integrity hash in
`bundle.json` covers everything it carries. `package.json` is the one file
outside the hash: it is npm's, and only names the package. `files` lists
`bundle.json` and each top-level entry the payload carries. The package is
what gives the payload a name, a version and the core it was written for.
Before 0.33.0 the payload sat in `content/`, and that layout is no longer
read. `bundle.json`'s own
`id` identifies the export it came from, which is what the transfer ledger keys
on, so it stays distinct from `crombolo.id`.

## What the backoffice calls them

The section reads **Bundles**. One word for one thing: the artifact the builder
produces is a bundle ([`content-transfer.md`](content-transfer.md)), and
an installable extension is published to npm under the `crombolo-bundle`
keyword, so both halves of the section hold the same kind of thing by name.

Its three views are named for what each one holds rather than for the section:
**Marketplace**, **Installed**, **Created**. Umbraco labels its marketplace view
"Packages", which under a section of the same name said nothing twice.

Three of those labels are dictionary keys, so the rename is an override in
`plugin/branding/localization-en.js` rather than a manifest:

| What reads it | Key or manifest |
| --- | --- |
| The section, in the nav | `sections_packages` |
| The button that starts a bundle, and the empty state beside it | `packager_createPackage`, `packager_noPackagesCreated` |
| The Marketplace, Created and Installed views | crombolo's own `sectionView` manifests |

**A replacement `section` manifest would not have worked.** The nav lists
section manifests whose *alias* appears in the signed-in user's
`allowedSections` (`apps/backoffice/backoffice.context.js`), and the server
sends Umbraco's `Umb.Section.Packages`. A manifest under a crombolo alias —
even one declaring `overwrites` — matches nothing, so the section would have
disappeared rather than been renamed.

### The Created view is a router, not a screen

Umbraco's Created view mounts its own overview at `overview` **and every
`package-builder` workspace** at `package-builder/create` and
`package-builder/edit/:unique`. Those two routes are the only way to reach the
builder from anywhere in the backoffice, so `plugin/bundles-created.js`
reproduces them exactly and replaces only the overview. A replacement that
rendered a list would have renamed the view and lost the builder;
`tests/bundles-backoffice.test.ts` asserts each of upstream's routes is still
declared here.

### The builder's two labels are corrected, not overridden

The builder workspace writes `Name of the package` and `Package Content` as
English in its template rather than as dictionary keys, so there is no key to
override and no manifest seam — it is one 431-line vendored element wired to
picker contexts. `plugin/branding/bundle-builder-labels.js` corrects both after
each render, the same way the client credential dialog's prefix is corrected,
and does nothing at all if upstream rewords either. That silence is the point:
the cost of a vendor bump is a stale label, never an error. The test asserts
both strings are still there to correct, so the bump is still noticed.

**What still says package.** Two toasts — `Package saved` and `Package
updated`. They are passed to the notification context from inside the builder's
private methods, which have no interception point, so removing them means
reimplementing the workspace. They are transient and they are the last of it.

The npm *identifier* keeps the name npm gives it — the Installed table's column
reads `npm package`, and an install still writes `package.json`. Renaming that
would make the screen disagree with every command it tells you to run.

### What stayed `Umb.`

Six identifiers in this repo wore `Umb.` and were invented here: the Forms
section alias and the five form permission verbs. They are `Crombolo.` now, and
migration 026 rewrites the verbs already stored. Everything else spelled `Umb.`
is Umbraco's and names something upstream defines — including three that the
vendored *client* never mentions and that are Umbraco's all the same:

| Identifier | Why it stays |
| --- | --- |
| `Umb.DocumentRecycleBin.Restore` | Umbraco's verb for the recycle bin entity, alongside its other document verbs |
| `Umb.PropertyEditorUi.RichText` | the alias migration 009 migrates *away* from; renaming it would match no row |
| `Umb.PropertyEditorUi.TinyMCE` | what an imported Umbraco site's data says; renaming it would break the importer |

## What the section used to do

Nothing routed the `package` operations, so each fell through to the router's
default (`api-management/src/router.ts`) and answered 501. Three fire on section
load — `configuration`, `migration-status`, `created` — so the section raised an
error toast, and the Marketplace view sat on its spinner forever waiting for a
`marketplaceUrl` that never arrived.

---

# Part 1 — Created packages

## The artifact: a created package *is* a bundle

There is one artifact format, and it is the bundle: an npm package whose
payload is a transfer bundle ([`content-transfer.md`](content-transfer.md)).
A created package is a bundle that carries its own structure, so one writer
produces it, one reader validates it, one manifest covers it and one importer
applies it.

It is **not** an Umbraco package: an Umbraco install cannot read it, and that is
a deliberate trade for carrying everything the builder UI offers using exporters
that already exist and are already tested.

```
acme-tasks-1.0.0.tgz
└── package/
    ├── package.json           name, version, keyword, peer range, and the crombolo manifest
    └── content/
        ├── bundle.json        the payload's manifest: what it is, and which sections it carries
        ├── nodes/<uuid>.json  picked content, media and element nodes   ┐
        ├── media/<key>        the media bytes, listed in media.json      │
        ├── schema/*.toml      types and languages, canonical TOML       │ each
        ├── components/…       components, at whatever depth             │ optional
        ├── styles/…           stylesheets                               │
        ├── scripts/…          scripts                                   │
        └── dictionary.udt     dictionary items                          ┘
```

The download is laid out as `npm pack` lays out a package, so `bun add
./acme-tasks-1.0.0.tgz` installs it and `bun publish` publishes it as it is. Its
`package.json` names the package, carries the `crombolo-bundle` keyword, and
declares a peer range of `>=` the release it was built by — the same range an
environment's export, an Umbraco import and a `bundle build` carry.
A later release reads every earlier bundle format, so it is never a reason to
refuse one, and an earlier release is turned away by name. Not `^`: before 1.0
a caret pins the minor, and a production one minor ahead of its preview would
refuse the preview's export.

**The section names are logical, not the destination's directory names.** A site
holds its components wherever `componentsDir` points, so the artifact says what a
file *is* and the importer decides where it goes — `components/` lands in
`componentsDir`, `styles/` in `stylesheetsDir`. A bundle built against one site's
layout therefore installs into another's, which a hard-coded path would have
broken.

There is **one** section for components, not two. Umbraco's split of templates
and partial views was a Razor concern ([`rendering.md`](rendering.md)), and
a bundle that carried it would push the distinction back into every site that
installed one.

### What the manifest adds

A bundle carrying sections declares them in `carries`, and the integrity hash
covers every one — so a half-copied package is refused rather than half applied,
exactly as a missing blob already was. It also carries `label`, the package's
name, so a downloaded artifact still knows what it is; without it two downloads
are distinguishable only by filename, which is the first thing to be lost.

Every bundle says `formatVersion: 5`, whatever it carries. A content-only bundle
carries no `carries` key. An older node refuses a newer bundle by name, with
"upgrade crombolo to import it", rather than failing an integrity check it
cannot explain. A node refuses a bundle older than 5 with a message saying to
rebuild it (stories 193 and 195).

A created package downloads **without its media files** unless asked
(story 195). The Created view's Download offers "Include media files",
unticked, and the plugin route takes `?withMedia=true`. Umbraco's own Download
button, on the contract's route, always downloads without them. Either way
`media.json` lists every file the picked media items name, so the destination
knows what to expect.

Three existing exporters compose it, and the build writes no new serialization
format of its own:

| Half | Comes from |
| --- | --- |
| Content, media, elements, blueprints, media bytes | `exportBundle` (`transfer/src/export.ts:165`) then `writeBundle` (`write.ts:149`), which returns exactly the `BundleFile[]` a zip wants |
| Document, media and member types, data types, languages | `exportSchemaSet` (`schema/src/export.ts:188`) and the writers behind `writeSchemaFiles` (`:331`) — canonical TOML, the same files `schema/` holds |
| Components, stylesheets, scripts | read through `FileSystemPort` (`api-management/src/ports-files.ts`) |
| Dictionary items | `dictionaryToUdt` (`server/src/dictionary-transfer.ts:31`) |

`exportSchemaSet` exports the whole schema, so it needs a variant — or a filter
over its result — that takes the aliases the definition selected. That is the
only new code on the schema side.

### Three things the build decides, which are not obvious

**The two child-node flags are honoured separately.** `contentLoadChildNodes`
and `mediaLoadChildNodes` are independent booleans in the contract, and elements
have no such flag at all, but `descendants` is a property of a whole export. So
the picks are exported in up to three groups and the resulting sets are merged
into one bundle — nodes deduped by key, counts recomputed, dependencies and
selector unioned. Passing one flag for all three would mean that asking for a
media folder's children quietly dragged a content page's children along too.

**Member types are never carried.** The builder has no picker for them and the
contract's definition model has no field, so there is nothing to select.

**An unchanged built-in data type is not carried either**, because
`exportSchemaSet` does not write files for built-ins
([`schema-as-code.md`](schema-as-code.md)) — every site already has them,
so a file would ship something the destination already satisfies. Picking one is
allowed and carries nothing.

The `bundle.json` inside is a real transfer bundle, so the content half of a
package is loadable by the importer that already exists. The schema half is
canonical TOML, so it is applied by copying it into `schema/` and running the
sync that a deploy already runs. Nothing here needs a bespoke installer.

### Packing

No dependency. A package tarball is a gzipped ustar archive: 512-byte headers
and padded file bodies, every entry under `package/`, which `server/src/tar.ts`
writes in under 100 lines and `Bun.gzipSync` compresses. Timestamps are fixed at
the one npm writes, so the same selection packs to the same bytes. Its test
unpacks the result with the system's own `tar`, because a tarball we write
wrongly fails in somebody's package manager rather than in our suite.

### The package's name and version

Umbraco's definition has no field for either, so the `bundle` table stores
them beside the columns the contract names (`package_name` and
`package_version`, migration 029 in 0.10.0). The builder workspace has no seam
for a field of its own, so they are set from the Created overview instead: each
row shows the `name@version` it downloads as, and **Package details** edits
them, through `<backoffice>/crombolo/api/bundles/created/<id>/package`. Until
they are set, the name is derived from the definition's name and the version is
`1.0.0`; an empty field goes back to that default.

## Where definitions live

A `bundle` table rather than a file in the site directory: the definitions are
shared state, they page, and a file would be per-node in a system that keeps
everything else coherent across nodes. The columns match Umbraco's
`umbracoCreatedPackageSchema` one for one, which is why the table was first
called `created_package` too.

It costs two migrations, both shipping in 0.5.0:
`data/src/schema/created-packages.ts` creates it after `serverRoleMigration`,
and `data/src/schema/bundles-rename.ts` renames it to `bundle` and rebuilds the
unique index on `name`. A rename rather than an edit to the first: 022 has
already run everywhere, and rewriting it would leave those databases holding a
table the code no longer looks for, with no migration to say so.

Columns follow the contract's model: `id`, `name`, `content_node_id`,
`content_load_child_nodes`, `media_ids`, `media_load_child_nodes`,
`element_ids`, and the alias/path lists — content types, media types, data
types, components, stylesheets, scripts, languages, dictionary items. The lists are JSON text; they are read and written whole and never
queried into, so a column each would be columns for nothing.

## The package is built on download, never stored

`GetPackageCreatedByIdDownload` serializes and packs on the spot. The definition
is the only stored state.

This is the difference that matters in practice: a stored artifact goes stale
the moment someone edits a content type it carries, and a user who downloads it
a week later gets something that no longer matches the site. Building on demand
cannot be stale, needs no blob storage, and works from any node. `packagePath`
in the response is a derived filename rather than a real path.

## The nine operations

| Operation | Answer |
| --- | --- |
| `GetPackageCreated` | paged from `bundle`, honouring skip/take validation |
| `PostPackageCreated` | insert; 400 on a name collision |
| `GetPackageCreatedById` | the definition, 404 otherwise |
| `PutPackageCreatedById` | update |
| `DeletePackageCreatedById` | delete |
| `GetPackageCreatedByIdDownload` | build and stream the package tarball |
| `GetPackageConfiguration` | `{ marketplaceUrl }` — see Part 2 |
| `GetPackageMigrationStatus` | `{ total: 0, items: [] }`, honestly |
| `PostPackageByNameRunMigration` | 404 for every name |

### The last two are a deliberate divergence

Umbraco's package migrations are C# migrations shipped inside a package and run
against the site's database. Nothing in this CMS carries them: extensions are
client-side (Part 2), and schema changes travel as TOML through a deploy. So
there is no such thing as a package with a pending migration here, and the
honest answers are an empty page and a 404 — not a stub standing in for work
that is coming.

Both are also about to stop being called at all: the Installed view that reads
them is replaced in Part 2.

---

# Part 2 — Extensions

## Why `App_Plugins` goes

It is a .NET-era convention — a directory of unmanaged files, baked into the
image (only `cms_media` is a volume, `compose.yaml:107`), with no version, no
dependency resolution and no record of where anything came from. npm already
solves all four, and the site already has a `package.json` the CLI scaffolds.

**The client does not care.** Checking the vendored backoffice's eight
`App_Plugins` references: `appendCacheBust` stamps `?umb__rnd=` only on
`/app_plugins/`-prefixed URLs and returns anything else unchanged;
`server-extension-registrator` prepends the server base URL to whatever the
manifest declares; the third is a deprecation warning string. Nothing dispatches
on the path. The manifest is the contract.

This repo already proves it: the framework's own extensions serve from
`/crombolo-plugin` (`backoffice-host/src/paths.ts:45`) and are registered
exactly like an `App_Plugins` package.

### What removal touched

| Place | Change |
| --- | --- |
| `backoffice-host/src/static.ts` | the serving branch, replaced by `resolveExtensionFile` |
| `backoffice-host/src/manifests.ts` | `collectManifests` now takes the discovered extensions |
| `server/src/config.ts` | `appPluginsDir` and `CROMBOLO_APP_PLUGINS_DIR` are gone |
| `server/src/ports.ts`, `server.ts` | wiring, now an `ExtensionRegistry` |
| `cli/src/templates.ts` | stopped scaffolding `App_Plugins/.gitkeep` |
| `tests/` | views, backoffice-host, api-handlers |
| `docs/` | 00, 01, 04, 06, 07, 09, 10, 14, 16 |

`packages/import-umbraco` keeps reading `App_Plugins` — it is reading a *foreign*
Umbraco site's layout during an import, which is unrelated and stays.

Removal is complete, with no fallback. The boot logs a warning when a non-empty
`App_Plugins` directory exists, naming the replacement, so nobody's extensions
vanish without explanation (`server/src/extensions-notice.ts`); the warning goes
at 1.0.

## `package.json` is the source of truth

A site's bundles are its dependencies. Discovery reads the site's
`package.json`, resolves each dependency, and reads the bundle manifest from the
dependency's own `package.json`. A bundle's backoffice half is its
`extensions`:

```json
{
  "name": "@acme/seo-tools",
  "version": "1.0.0",
  "peerDependencies": { "@crombolo/crombolo": "^0.10.0" },
  "crombolo": {
    "id": "acme-seo-tools",
    "extensions": [
      { "type": "dashboard", "alias": "Acme.Dashboard.Seo", "element": "dist/seo.js" }
    ]
  }
}
```

A dependency without a `crombolo` field is an ordinary dependency and is
ignored. One that has the field and fails validation is reported by package and
left out, so one malformed bundle cannot take the backoffice's manifest down
with it.

One file, no second artifact, and discovery reads a file it is opening anyway.
Asset paths are relative to the package root; the server rewrites them to its
own URL space, so a package never hard-codes a site path.

Resolution goes through Bun, not a `node_modules/<name>` string join, so
workspaces, hoisting and scoped names all work.

Discovery stays bounded: declared dependencies only, not a walk of
`node_modules`, which also means a transitive dependency cannot inject a
backoffice extension into a site that never asked for one.

### Serving

`/bundles/<name>/<path>`, following the existing plugin branch in `static.ts`
exactly — `safeJoin` into the resolved package directory, `no-cache`. The
`?umb__rnd=` stamp is lost, which costs nothing: the framework plugin already
lives without it on the same header.

### Caching

`discoverManifests` currently hits the filesystem on every
`GET /manifest/manifest` and that is load-bearing — it is why an extension
appears without a restart. Reading a handful of `package.json` files per request
is a little more work than one `readdir`, so discovery memoizes and the install
endpoint invalidates. The uncached behaviour must survive in development, where
an author editing a local extension expects a reload to show it.

## Finding packages on npm: discovery and declaration are different jobs

The `crombolo` field is **not searchable**. Tested against the registry:
`text=crombolo:true` returns zero results and no error — npm's search indexes
`keywords:`, `author:`, `maintainer:` and `scope:`, and nothing else. A custom
field cannot be queried.

But a packument *does* preserve custom top-level fields (confirmed: `oclif` on
`oclif@6.0.2`, `packageManager` on `netlify-cli`). So:

- **Discovery** is a published keyword convention: `"keywords": ["crombolo-bundle"]`.
  It is the only thing npm will index, so it is a publishing requirement, and
  `docs` and the package template say so.
- **Declaration** is the `crombolo` field, which the server reads after install.

The two combine into a free quality gate: the marketplace searches the keyword,
then reads each hit's packument and offers only the ones that actually declare
`crombolo`. One cheap HTTP call per hit, no tarball download, and a package that
squats the keyword without declaring anything never reaches the list.

The gap this leaves: a package that declares `crombolo` but forgets the keyword
is invisible to search. Install by exact name is therefore always available as
its own input, independent of the listing.

## The marketplace

`www.npmjs.com` sends `x-frame-options: SAMEORIGIN` (tested), so an npm search
URL cannot be iframed — the Umbraco design does not transfer. Instead, the
framework plugin ships a native section view that `overwrites`
`Umb.SectionView.Packages.Marketplace`, which the plugin manifest already does
for other extensions (`Umb.Dashboard.UmbracoNews`). No iframe, a real list, and
an install button.

It is fed by a server-side proxy rather than a browser fetch: it works where the
browser cannot reach npm, keeps the backoffice making same-origin requests only,
caches briefly, and keeps the keyword in config. A hit is listed only when its
latest version's manifest validates, and each card says what the bundle adds:
screens, content, server features. `marketplaceUrl` from
`GetPackageConfiguration` stays in the contract and points at that view, so a
site that wants the Umbraco marketplace back can set it.

`Umb.SectionView.Packages.Installed` is overwritten too — it is built around
pending package migrations, which do not exist here. The native view lists the
site's bundle dependencies with their versions, what each adds, whether its
content has been added here (from the transfer runs, which record the package
and version that brought them, migration 030), and whether its server features
are switched on by `crombolo.config.ts`.

## Runtime install

`bun add <name>@<version>` in the site directory, as a subprocess. Bun resolves,
verifies and writes `package.json` and `bun.lock` correctly, which matters more
than avoiding a subprocess: the committed result is byte-for-byte what a
developer would have produced by hand. Fetching tarballs ourselves would mean
hand-maintaining a lockfile, and a lockfile maintained badly is worse than none.

Then discovery is invalidated and the next manifest read picks the extension up.
No restart.

**Only a bundle, and server code only on an explicit yes** (story 194). Before
`bun add`, the install reads the registry's manifest for the version asked for:
the exact version, the highest a range admits, or the latest.
- A package that is not a valid bundle is refused, so the endpoint never
  installs an arbitrary package.
- A registry that cannot be read is refused too, because what the package
  carries cannot be checked.
- A bundle that declares `server` is refused, with `needsServerConsent` and the
  permissions it asks for, unless the request carries `acceptServerCode: true`
  and grants exactly those permissions (`grant`), no fewer and no others
  ([Permissions](#permissions)).
- After `bun add`, the installed package's own manifest is checked again. A
  version that turned out to have a server half nobody accepted, or to ask for
  more than was granted, is removed, and the install is refused. This catches a
  `latest` that moved between the listing and the install. Otherwise the grant
  is recorded against the version that landed.

The Marketplace asks for the yes in the bundle's own card:
- The tag reads "Runs code on the server", in warning colour.
- **Install** opens a panel. It says the code can read and change the site's
  data, files and settings once the developers turn it on, lists in plain words
  what the bundle asks to do, and names the publisher with links to npm and the
  source.
- The panel has an unticked "I trust this publisher, and approve what it asks
  to do" box, and **Approve and install** stays disabled until it is ticked.

The yes is for what the code may do once wired. Installing still does not wire
it: that takes the import in `crombolo.config.ts` and a deploy, as before. The
audit log records each install and uninstall once: `system` / `Install` /
`Bundle`, naming `package@version`, with `accepted server code; granted …`
when it was.
A bundle with screens says, after install, that they run in the browser of
everyone who uses the back office.

**No install scripts.** The install runs `bun add --ignore-scripts`, so a
package's lifecycle scripts never run on the server, whatever Bun's built-in
list of trusted packages or the site's `trustedDependencies` say.

**Then its content, unless declined.** A bundle that carries content has it
applied straight after `bun add`, through the same installer and overlay check
as `crombolo bundle install` (`server/src/bundle-install.ts`), with the server's
own connection. The site turns this off with `applyBundleContentOnInstall: false`
(`CROMBOLO_APPLY_BUNDLE_CONTENT=false`), and the Marketplace card has a toggle
that declines it for one install. A refused check or a backup the site cannot
take leaves the dependency installed and says why; the import then waits on the
Changes dashboard, where its conflicts are answered and it is run
([`content-transfer.md`](content-transfer.md), "In the backoffice"). The install
that succeeded is not undone.

**`package.json` is the install ledger.** There is no separate record of what was
installed at runtime, because the dependency list already is one. "Incorporate
this into future deployments" is therefore just committing the two changed files,
and the install response carries the dependency line itself — the range as
`bun add` wrote it and the version it resolved to — so the view shows exactly
what there is to commit.

### What it cannot do, stated plainly

- **It is per-node and ephemeral.** `node_modules` lives in an image layer, so a
  redeploy loses the install until the dependency is committed, and in a
  load-balanced set only the node that served the request has the files. The UI
  says so on success rather than implying permanence. **A site of several nodes
  turns it off** with `runtimeInstalls: false` (`CROMBOLO_RUNTIME_INSTALLS=false`):
  the Marketplace still lists packages, with the `bun add` line to commit and
  deploy instead of an Install button, and Installed has no Uninstall. It is
  off by default where a schema store is configured, which already says the
  nodes' disks do not last.
- **It needs a writable site directory and network egress.** Both fail cleanly:
  a read-only filesystem and an unreachable registry each get a specific error,
  not a subprocess stack trace.
- **A runtime install never loads a bundle's code.** A package whose code must
  run in the server process is a dependency plus a deploy — see
  [Part 3](#part-3--server-side-bundles), which is what that turned into.
  Loading third-party JS into a running node has no isolation story and a
  `role: web` node would never see it, so an install writes `package.json`,
  applies the content (which is files and data, never code), and stops there. A
  package that installs but is not a valid bundle is reported as exactly that
  rather than as a success.
- **Content applied at runtime is this node's too.** It writes `schema/` and the
  component directories on the node that served the request. On a
  load-balanced site, turn `applyBundleContentOnInstall` off and let the content
  arrive with the deploy that commits it.
- **Uninstall** is `bun remove`, the same path in reverse.

Supply chain: the install runs third-party JS in the backoffice origin with the
user's session. It is gated on the same permission as the Bundles section, the
resolved version is recorded, and nothing is fetched outside the registry.

That is the whole of what an install trusts today: the registry's integrity
hash and the permission to install. Saying who published a package — the
registry's provenance attestation, and a list of publishers crombolo has
reviewed — is not built yet: stories `060` and `061`.

### Side panels

A bundle's client half can dock a panel beside whatever the editor has open
(story 182): help, notes, a checklist, a tool to work alongside. The panel stays
open, with its element and state, as the editor moves between sections, and is
still open after a reload.

```json
{
  "type": "sidePanel",
  "alias": "Acme.SidePanel.Notes",
  "name": "Notes",
  "element": "dist/notes-panel.js",
  "meta": { "label": "Notes", "icon": "icon-notepad", "toggle": true,
            "defaultWidth": 400, "minWidth": 280, "maxWidth": 720 }
}
```

- **`meta.toggle: true`** adds a header button that opens and closes the
  panel, so one manifest is enough.
- **Widths** default to 400, with limits of 280 and 720 px. A panel is never
  wider than half the window, and the editor resizes it with the splitter,
  by pointer or keyboard.
- **One panel is open at a time.** Which one and its width are remembered per
  user in the browser.
- **Narrow windows:** below 768 px, or where main would drop under 480 px,
  the panel opens as a full-width sheet over the view, which Escape closes.
- **Control from code** through the context `Crombolo.Context.SidePanel`,
  consumed by that string so nothing of ours is imported:
  `this.consumeContext('Crombolo.Context.SidePanel', (panels) => panels.open('Acme.SidePanel.Notes'))`.
  It offers `open(alias)`, `close()`, `toggle(alias)`, `active` and `width`
  (observables), and `setAvailable(alias, available)`, which hides the toggle
  and closes the panel while it cannot be used.
- **Reading the open workspace** is the bundle's own business: a
  `workspaceContext` observes it and shares what it sees with the panel.

How the panel docks is in [`backoffice-hosting.md`](backoffice-hosting.md),
"Side panels".

### A host that installs packages

Someone who runs crombolo for other people's sites can offer a third route
besides a runtime install and a deploy (story 181). The host resolves the
site's packages with its own tooling, and the running nodes take them up
without a restart.

- **What it writes.** The site's `package.json` and the `node_modules` that
  resolve it, the same on every node that serves the back office, kept across
  restarts. Only those nodes need the packages: a `role: web` node serves no
  back office, and a reload there does nothing.
- **How a node is told.** The host's `server.ts` keeps the server handle from
  `cromboloServer()` rather than `crombolo()`, and calls `reloadBundles()` on
  each node after writing its files there:

  ```ts
  import { cromboloServer } from '@crombolo/crombolo'
  import config from './crombolo.config.ts'

  const server = await cromboloServer(config)
  Bun.serve(server.serveOptions)
  // When the host has changed this node's packages, by whatever means it uses:
  const { added, removed, changed, problems } = await server.reloadBundles()
  ```

  Discovery runs again from the files as they are now. New extensions are
  served, removed ones are not, and `/bundles/<pkg>/…` follows. Open back
  offices hear `Crombolo:Bundles` / `Changed` on the live-update channel, and
  offer "Extensions changed — reload to use them". Nothing reloads by itself.
  The Marketplace's own install goes through the same reload.
- **Never a server half.** Configured `bundles` are wired at boot only. A
  newly found bundle with a `server` field is reported with `wired: false`.
  Wiring it is a config change and a deploy, as before.
- **Checking a package first.** `validateBundlePackage` and `peerRangeProblem`
  are exported from `@crombolo/crombolo`, so a host checks a package by the
  CMS's own rules without reaching into `@crombolo/backoffice-host`.
- **Where installs happen.** With `runtimeInstalls` off,
  `installsElsewhere: { message, url }` (`CROMBOLO_INSTALLS_ELSEWHERE_MESSAGE`
  and `_URL`) replaces the Marketplace's "add it to `package.json` and deploy":
  the banner shows the message and a link, each package not installed shows the
  link instead of the `bun add` line, and a refused install says the message.
- **Output should import only what the host provides.** A bundle's back-office
  files are served as they are, so an import of a package the host has not put
  on the node fails in the browser. The import map covers the vendored client
  (`@umbraco-cms/backoffice/*`), and nothing else is promised.

### A site's bundle with code

A site that is part application has server code of its own: the server
bundles its `crombolo.config.ts` wires, and their source. A self-hosted site
deploys that from its repository. A host that runs the server for its
customers needs it as one artifact, checked by the CMS's rules, and the
bundle is that artifact (story 192).

- **Which files.** The site's `package.json` names them, as globs in
  `crombolo.code` (`"code": ["src/**", "vendor/**"]`), and
  `crombolo bundle build --code <glob>…` overrides the list. Once there is
  code, `package.json`, `bun.lock` and `crombolo.config.ts` are always packed.
  These are never packed, whatever a glob matches: `node_modules`, `.git`,
  `.env` files, SQLite files, the folders the bundle already carries as
  sections (`schema/`, `components/`, `css/`, `scripts/`, `seed/`), and the
  site's `media/`, `logs/` and `.crombolo/`. A glob that matches nothing, or a
  site with no `bun.lock`, stops the build. A site that names no code builds
  the bundle it always did.
- **Where.** The code goes in `code/`, at its site paths. It is a section like
  `schema/` or `components/`: `bundle.json` lists it under `carries.code`, and
  the bundle's one hash covers it. It is read as bytes, because source is not
  only text (story 193).
- **The CMS is the host's.** A site lists `@crombolo/*` under
  `peerDependencies`, and so does `crombolo init`. `bun install` still installs
  peers, so local development is unchanged. The code's install runs
  `bun install --frozen-lockfile --ignore-scripts --omit peer`, so it never
  carries a copy of the CMS. Discovery reads peers as well as dependencies, so
  a server bundle from the `@crombolo` scope is still found.
- **`crombolo bundle check <bundle>`** (`checkBundleCode`) lists every
  problem, not just the first:
  - the hash;
  - the frozen install;
  - any `@crombolo/*` package the install put anywhere, which happens when
    something depends on one directly;
  - a `@crombolo/*` package listed under `dependencies`;
  - the site's peer range against this version;
  - each declared bundle's peer range.

  It links this CMS's packages in, as a host provides them. It never runs the
  site's code, its `crombolo.config.ts` included: a host runs the check before
  it has accepted the code, and importing a config is running it. Which server
  bundles the config wires is checked by the boot (`validateServerBundles`),
  so a host starts the installed code once in a throwaway directory before it
  serves from it. The check lists the server bundles the declared packages
  carry.
- **`crombolo bundle install-code <bundle> <dir>`** (`installBundleCode`)
  checks the hash, then installs the code into an empty directory the same way.
  It never writes over a directory that already holds files. The directory has
  to sit where the host's `@crombolo/*` packages resolve from. Starting the
  site, or restarting it so its server bundles are wired, is the host's step.
- **An import leaves it alone.** `content import` and `start --bundle` install
  the content and say the bundle carries code to install. A server half is
  wired only at boot, so applying code always means a restart.

Both functions are exported from `@crombolo/crombolo`, beside
`validateBundlePackage`, for a host to run in its own process.

---

## Installing one

A bundle's content installs through the bundle's own commands — there is no
second importer:

```
crombolo content check  <pkg>     # read-only: what it would do here
crombolo bundle install <pkg>     # apply it
```

`<pkg>` is either the name of a bundle the site depends on, resolved exactly as
discovery resolves it, or a package directory, applied in place without being
added to `package.json` — which is how an environment's export arrives. A
directory holding a bare `bundle.json` with no `package.json` is refused, as is
a package whose manifest names no `content` or whose peer range excludes this
release. The transfer run records the package's name and version.

### Encrypted content and people

An environment's export seals its property values, media files and any
members or users under a passphrase ([`content-transfer.md`](content-transfer.md),
"What is readable, and what is sealed"). Such a bundle installs only when given
it — the command line prompts or reads `CROMBOLO_BUNDLE_PASSPHRASE`, and the
Changes dashboard asks for it and sends it with each request, never storing it.
Without it the check is one blocking finding and an install is refused before
anything is backed up or written. A package meant for anyone is open:
`writeBundlePackage` refuses to write a public one that carries people or
sealed content, and the marketplace's install of one that does anyway is
refused with the reason.

`bundle` is the artifact's name and `install` reads better for one that brings
its own structure, but these are aliases: `content check` and `content import`
are the same operations on the same artifact, and still work. A bundle applies
whatever it carries by default — that is the point of carrying it — with
`--no-schema` and `--no-files` to decline a half.

### The order is forced, and so is where the check happens

Content naming a type the bundle brings cannot pass a check until that type
exists. So the structure has to land before the content is checked — which means
a blocking schema change has to be caught **before the first file is written**,
or a refused install leaves a half-applied site behind.

That is why the check runs against an **overlay**: a copy of the site's
`schema/` with the bundle's files laid over it. The site's own directory is not
touched until it is known the schema can apply. An install whose schema would
need data work is refused with nothing written.

Then three phases (story `105`): every carried section is **staged** into a copy
under `.crombolo/transfer/pending-…/next/`; **one transaction** syncs the staged
schema, imports the dictionary items and the content; and once it commits the
staged folders **swap** into the site's configured directories. A refusal at any
point leaves the site's files and database as they were
([`content-transfer.md`](content-transfer.md), "Replacing a site").

Schema is applied by **writing the files and syncing**, never by writing the
database directly. The file is the truth and the database follows it
([`schema-as-code.md`](schema-as-code.md)), so an install cannot produce a
database its files do not describe, and what it installed is reviewable in a
diff afterwards.

### A file this site already has is not replaced without being asked

Every section an install writes is editable **in the backoffice**: a stylesheet
and a script through the Settings section, a template through the template
editor, a content type through `createSchemaFileWriter`. So an overwrite does
not destroy a file that came from a deploy — it destroys whatever somebody last
saved. And git cannot be assumed to be behind it: `git` is `undefined` by
default, a feature a site opts into.

So an install is **refused while any file would be replaced**, naming them, and
`--replace-files` is how someone says yes. On a fresh site every file is a
create, so the friction appears only where something would be lost. An identical
file is not a replacement.

### Undoing one

The content half is a transfer run, so `content revert <run>` takes it back as
any import. The files are not in that ledger — but they are not left to git
either. The swap keeps what each staged folder replaced under
`.crombolo/transfer/<runId>/previous/<section>`, with `swap.json` naming the
sections, and the dictionary as it was in `dictionary-before.udt`. `content
revert` swaps the folders back, re-syncs the schema and restores the dictionary
(`revertSections`).

The run id does not exist until the content has imported, so the staging
directory is `pending-…` until the transaction commits and is renamed to the run
then. A refused install removes its staging directory: nothing of the site was
moved into it. Runs from before the staged install kept single replaced files
under `replaced/` with `files.json`; those still revert as they did.

`.crombolo/transfer/` is a sibling of `.crombolo/components`, never inside it:
the components cache is rebuilt from `components/` and cleared at boot, and these
have to outlive a restart to be worth taking.

### Known rough edge

A re-install rewrites a schema file that the sync had annotated with assigned
keys, so the sync runs again and re-assigns them from the database. A file whose
type carries a key this site has never had, for an alias it has, is matched by
the alias and given the site's key (story `105`), so a bundle from a site whose
types were created separately updates them rather than clashing. It converges
— the type is matched by alias when the file carries no key, so it is updated
and never duplicated, which `tests/bundle-install.test.ts` holds it to — but a
repeat install is not a silent no-op the way re-importing unchanged content is.

## What shipped where

| Piece | Where |
| --- | --- |
| The nine operations | `api-management/src/handlers/package.ts`, `ports-packages.ts` |
| Definitions | `data/src/schema/created-packages.ts` (migration, release 0.5.0), `bundle-package.ts` (the npm name and version, 0.10.0), `data/src/repositories/bundles.ts` |
| The build | `server/src/adapters/bundles.ts` — composition of `exportSchemaSet`, `exportBundle`/`writeBundle`, `FileSystemPort` and `dictionaryToUdt`, wrapped by `writeBundlePackage` |
| The tarball | `server/src/tar.ts` |
| The manifest | `backoffice-host/src/bundle-package.ts` — reading, validation, discovery and the peer range |
| The format | `transfer/src/model.ts` (`carries`, `label`, sections), `write.ts`, `load.ts`; `package.ts` for the package around a payload |
| The installer | `server/src/bundle-install.ts` and `bundle-sections.ts`, called by the CLI's `contentCheck`/`contentImport` and by the Marketplace |
| File safety and revert | `replacementsNeedingPermission`, `stageBackups`/`promoteBackups`/`restoreSectionFiles`, same file |
| Discovery and serving | `backoffice-host/src/extensions.ts`, wired through `static.ts` and `manifests.ts` |
| The marketplace and install | `server/src/marketplace.ts`, routed at `<backoffice>/crombolo/api/bundles/*` |
| The two native views | `backoffice-host/plugin/bundles-marketplace.js`, `bundles-installed.js` |
| The App_Plugins notice | `server/src/extensions-notice.ts` |
| Server-side bundles | `server/src/bundles.ts`, wired in `server.ts`, `bundles` in `config.ts`, matched to their packages at boot |
| The redirects bundle | `packages/simple-redirects` — `src/index.ts` and `plugin/` |

Adding the migration needed `bun run release:version 0.5.0` first: `v0.4.0` was
tagged and `tests/migrations.test.ts` asserts `release <= VERSION`, so a
migration naming an unreleased version fails the suite rather than landing in
someone's `migration_history` as a release that was never cut (`AGENTS.md`).

## Testing

`tests/bundle-package.test.ts` covers the manifest, one rule per test: the id,
the package name and version, the peer range, a bundle that does nothing, a
server half that is not an export name, content outside the package or holding
no payload, every problem reported at once, and core's own field never read as a
bundle.

`tests/bundles.test.ts` covers the contract operations and the build. The
content assertion is a round trip: build the tarball from a definition, unpack
it, write the payload out and load it through `loadBundle` — so the package is
proved to carry a real bundle rather than a file of the right name. The whole
package, unpacked, is accepted by the installer, and the npm name and version
set from the Created view are what the download is packed as.

`tests/tar.test.ts` reads each tarball back two ways: through a reader of its
own that is independent of the writer, and through the system's `tar`, so a
wrong header is a test failure instead of a corrupt download. It covers an empty
entry, a non-ASCII path, a path too long for one header field, determinism, and
a path that would land outside the package.

`tests/extensions.test.ts` covers discovery (including a transitive dependency
that declares an extension and must be ignored), asset-path rewriting, the
memoizing registry, and serving — a path escaping the package root and a
dependency that is not a declared extension are both refused, so `/bundles/`
cannot be used to read `node_modules`.

`tests/bundle-install.test.ts` covers the installer: finding a bundle as a
package directory applied in place or as a dependency by name, the run
recording the package and version, and the refusals — a name the site does not
depend on, a bare payload, a peer range that excludes this release, and a
package with no content. Then each section mapping onto
this site's directories, that a plan writes nothing, create vs overwrite vs
unchanged, the overlay schema check, declining either half, and that applying
twice converges on one type rather than duplicating it.

It also covers the two rules that keep an install from destroying work — which
file needs permission before it is replaced (including a schema file the
backoffice changed, and *not* an identical one), and that a revert puts back what
was replaced and removes what was created. `replacementsNeedingPermission` is
its own function rather than a condition inside the importer precisely so it can
be held to that.

`tests/content-bundle.test.ts` covers the format: every bundle says the current
version and a layout older than it is refused, a bundle with sections declares them, the integrity hash catches
an edited view, a declared file that is absent is reported, a path that climbs
out of the bundle is dropped, and a newer format is refused by name.

`tests/marketplace.test.ts` runs against a recorded registry and a stubbed
installer: the keyword search, the packument filter that drops keyword
squatters and invalid manifests, the unreachable-registry case, name and version
validation, and what the user is told after an install. The content half is
applied after `bun add`, declined by the request or by the site, and a refused
or throwing content install leaves the dependency installed and says why.
Nothing in the suite reaches npm.

`tests/server-bundles.test.ts` covers the mechanism on its own, with a stub host
and no database, because the things that must hold are properties of
`bundles.ts` rather than of any one bundle: a wired bundle no declared package
owns, one whose package declares no server half and one whose peer range
excludes the running release are each refused by name, the mounted bundle takes
its name and version from its package, an id or route path that could leave
the namespace is refused, a bad set fails the boot naming every problem at once,
`api/bundles/` is not claimed by `api/bundle/`, the section is checked before the
handler runs, a handler sees only the capabilities it declared in a frozen
object, and a throwing handler is a 500 that leaves the other bundles answering.

`tests/simple-redirects.test.ts` covers the redirects bundle end to end against a
real site, because the only assertion that proves the client, the routes, the
capability and core's matcher agree is that a rule typed through the API makes a
visitor get a 301. It also holds the confinement: a configured rule and a tracked
one are listed but refuse to be edited or deleted, `source` cannot be forged,
a manual rule survives both `syncConfigured` and a reverted rename, and the
precedence between the three sources is checked by what actually answers the
request.

Those fixture sites live under `output/` rather than the system temp directory —
a site's views cache has to resolve `@crombolo/crombolo/jsx-runtime` by walking up to a
`node_modules` that carries it, which nothing outside the repository can do.

---

# Part 3 — Server-side bundles

A server bundle is written against `@crombolo/crombolo/bundle`, the supported
entry point for a bundle's author ([`api.md`](api.md)), and peers on
`@crombolo/crombolo`. Nothing in `@crombolo/server` is a bundle's to import.

Part 2 said a bundle that needs to run in the server process is "a dependency
plus a deploy" and left it there. This is that, made into something a bundle can
be written against: `bundles.ts` in `packages/server`, and
`@crombolo/simple-redirects` as the first one.

## The objection, and what actually answers it

The original objection was specific, and it was right: loading third-party JS
into a running node has no isolation story, and a `role: web` node would never
see a runtime install. Neither is solved by a sandbox — Bun has no mechanism that
would make a hostile dependency safe inside this process.

What answers it is that **nothing here is discovered**. There is no
`CROMBOLO_BUNDLES` and no scan of `node_modules`; a bundle's server half runs
only because a site wrote this:

```ts
import { redirects } from '@crombolo/simple-redirects'

export default defineConfig({
  bundles: [redirects()],
})
```

So the two halves of a bundle arrive by different routes on purpose:

| Half | How it arrives | What it takes |
| --- | --- | --- |
| The backoffice screen | discovered from the `crombolo` field once the package is a dependency | `bun add`, no restart |
| The server endpoints | imported by name into `crombolo.config.ts` | an edit, a review, a deploy |

That asymmetry is the whole security story. The dangerous path — someone clicks
*Install* in the Bundles section and third-party code is in the request path — is
not guarded, it does not exist. The safe path is a committed diff that reaches
every node, which is also what makes `role: web` coherent: the import is in the
site's code, so every node has it or none does.

A test holds this down rather than leaving it to the prose:
`tests/server-bundles.test.ts` asserts the default is `[]` whatever the
environment says, that no environment variable names a bundle, that discovery
parses JSON and never imports a dependency's module, and that the install path
runs the package manager and nothing of the package.

### Bundles a host provides

An installation that runs other people's sites often wires bundles of its own
into every one: an editing tool, an integration with its own services, a
private package it never published. They belong to the host, not to any one
site. Whoever runs the installation lists them by package name:

```ts
export default defineConfig({
  bundles: [hostTool(), siteBundle()],
  hostProvided: ['@host/tool'],
})
```

- **A whole-site file leaves them out of `requires`** (story 177), so it does
  not name the host's packages, private ones included, and it starts anywhere
  that has the bundles the site chose itself. This covers `crombolo export
  --site`, a pull and the operations export alike.
- **A file written before** that names one still imports on the host that
  provides it, where the package is installed.
- **A listed name that is not installed** is logged once at start, not
  refused, so a host can list a bundle it is still rolling out.
- **Code only**, as `bundles` is: it is a decision about code.

**Its output still has to stand on its own.** A host bundle's output (its
components, styles, schema and content) is the site's own, and travels as
usual. A tool that writes components importing the tool has made the site
depend on it, so such a tool should write self-contained files. This setting
only stops the file claiming a dependency the site does not have.

### Tools a host provides

A host can give every site it runs a back-office tool whose work happens on
the host's side, without the CMS running any of the host's code on its
server (story 178). Three pieces:

1. **Browser code**, a back-office extension listed in `hostProvided`, so it
   never leaves with a site (above).
2. **The Management API as the person.** The extension calls the API from the
   browser, as every back-office extension can, with the rules and
   permissions the signed-in person already has.
3. **A host token to the host's own service.** The extension asks the back
   office who is signed in, as a short-lived statement signed with the
   host's key:

   ```js
   const base = document.querySelector('base').getAttribute('href').replace(/\/$/, '')
   const { token } = await (
     await fetch(`${base}/crombolo/api/host-token`, { method: 'POST', credentials: 'include' })
   ).json()
   await fetch('https://tools.example.com/api/work', {
     method: 'POST',
     headers: { authorization: `Bearer ${token}` },
   })
   ```

The installation names its host in `crombolo.config.ts`. The key stays out of
the file by being read from the host's own variable:

```ts
export default defineConfig({
  host: {
    origin: 'https://tools.example.com',
    signingKey: process.env.TOOLS_SIGNING_KEY ?? '',
    keyId: 'installation-7',
  },
})
```

**The token:**
- a compact JWS, signed HS256 with that key, with `kid` the key id;
- `aud` is the host origin and `iss` the site's address;
- it lasts five minutes;
- `sub` is the user's key, with `name`, `groups` (aliases) and `sections`;
- `site` gives the site's name and node id.

**Getting one:**
- only a signed-in person gets one, on a request from the site itself;
- it reflects their groups now, and a locked-out or disabled person, or one
  whose session has ended, gets `401`;
- each person may ask ten times a minute, on each server;
- each one issued is a log line, not an audit entry;
- without `host` the route is a `404`.

**The host checks it with the key alone**, choosing the key by `kid`:

```ts
import { jwtVerify } from 'jose'
const { payload } = await jwtVerify(token, keyFor(kidOf(token)), {
  audience: 'https://tools.example.com',
  algorithms: ['HS256'],
})
```

It must check `aud` and `exp`, which `jwtVerify` does when given the audience.
It should keep a separate key per installation. The key both signs and
verifies, so only the service that checks tokens should hold it: any component
that has it can mint tokens the others accept. If the back office ever gains a
content security policy, it must name the host's origin for these calls.

## What a wired bundle gets

A narrow interface, not the server:

```ts
export interface ServerBundle {
  id: string              // the crombolo.id of the package that exports it
  section: BundleSection  // what a caller must have access to
  capabilities: readonly BundleCapability[]
  routes?: readonly BundleRoute[] // below
  tables?: BundleTables   // Part 4
  media?: BundleMediaDeclaration // the media folders it uses, below
  forms?: BundleForms     // form field and workflow types, docs/forms.md
  events?: BundleEvents   // webhook event handlers, docs/webhooks.md
  middleware?: Middleware // offered to the site's chain, below
  jobs?: Record<string, BundleJob> // background jobs, below
  schedules?: JobSchedule[] // when they run by themselves
}
```

**A bundle may offer middleware** (story 210), in the published contract
(`@crombolo/common`; [`rendering.md`](rendering.md#middleware)). It runs only
where the site lists it, so installing a bundle never changes request handling
by itself:

```ts
const redirects = redirectsBundle()
export default defineConfig({
  bundles: [redirects],
  middleware: { request: [redirects.middleware!] },
})
```

**A wired bundle belongs to a package.** Its id must be the `crombolo.id` of a
dependency the site declares whose manifest has a `server`, and its name,
version and peer range are read from that package rather than declared twice.
A wired bundle no declared package owns, or one whose peer range excludes the
running release, refuses the boot by name. A bundle reads its id from its own
`package.json` so it is written once:

```ts
import manifest from '../package.json' with { type: 'json' }

export const tasks = (): ServerBundle => ({ id: manifest.crombolo.id, … })
```

The `server` field is a declaration only: core reads it to know a package has a
server half, and never imports the module it names. What runs is still exactly
what `crombolo.config.ts` imports.

`section` is a core section by its application alias (`settings`, `content`) or
a section of the bundle's own by its manifest alias (`Acme.Section.Design`).

- **Its own namespace.** Back-office routes mount at
  `<backoffice>/crombolo/api/bundle/<id>/`. The id is lowercase letters,
  digits and hyphens, so it cannot climb out of its segment however it is
  spelled, and each back-office path is validated as a plain path of segments
  with at most one `:name` each. Two bundles cannot claim one id. Site routes
  answer at the paths they declare ([below](#routes)).
- **No anonymous traffic unless declared, and no self-granted access.** For a
  back-office route the server authenticates before dispatch and the registry
  checks the declared section before calling anything, so a bundle has no way
  to widen a back-office route's authorisation — the test asserts the handler
  is never reached by a caller without the section. A route reaches members or
  visitors only by being a site route, which answers only where the site lists
  the bundle.
- **Only the capabilities it declared**, as a frozen object, and of each only
  what its granted permissions allow ([Permissions](#permissions)). No `Db`, no
  config, no filesystem. A capability is an interface `bundles.ts` owns and
  implements, so the reachable surface is what core decided to expose rather
  than what the bundle can find.
- **Its own failures.** A handler that throws becomes a 500 with a reference and
  a log line naming the bundle; the request path stays up and the other bundles
  keep answering.
- **No back-office routes on a `web` node.** These are backoffice endpoints, so
  they answer only where `servesBackOffice`. Site routes answer where the site
  is served: `all` and `web` nodes, never `api` nodes. The bundle itself is
  validated on every node, because its `forms` types are needed where forms
  render and submit (story `095`).

### Permissions

Story 222. A bundle's package says what its server half may do with the site,
and an administrator approves all of it, or the bundle stays off.

```json
"crombolo": {
  "id": "redirects",
  "server": "redirects",
  "schemaVersion": 3,
  "permissions": ["redirects.read", "redirects.write", "documents.read"]
}
```

| Permission | Allows | Capability |
| --- | --- | --- |
| `redirects.read` | `list`, `byKey` | `redirects` |
| `redirects.write` | `save`, `replace`, `remove` | `redirects` |
| `documents.read` | `url` | `documents` |
| `identityProviders.read` | `list`, `test`, `groups` | `identityProviders` |
| `identityProviders.write` | `update`, `reset` | `identityProviders` |
| `media.read` | `get`, `list`, `crop` | `media` |
| `media.write` | `create`, `update`, `delete` | `media` |
| `member.delegate` | acting as the signed-in member calling a route | `media`, which always acts as the caller |

Each has a plain sentence the install panel and the Installed view show
(`BUNDLE_PERMISSIONS` in `@crombolo/backoffice-host`). `log` and a bundle's own
`database` (Part 4) need none: neither reaches the site's data.

- **Declared, and held to the code.** Schema 3 makes `permissions` required of
  a server half; `[]` is a bundle that asks for nothing. A package written for
  an earlier schema, or naming a permission this release does not offer, is
  refused by name. At boot each capability must have one of its permissions
  (`media` also `member.delegate`), and each permission must be used by a
  capability the bundle declares.
- **Only what is declared.** A capability method whose permission is not
  declared throws `PermissionRefusedError`, naming it: a bundle that asked only
  to read redirects cannot save one.
- **All or nothing.** An administrator grants a bundle's whole list, in the
  install panel or with **Approve and turn on** on its card in Installed, and
  withdraws it there. A bundle is on while its grant covers everything it
  declares. One that is off is still mounted: its routes answer 503 saying it
  is waiting for approval, its events are not delivered, its screens are left
  out of the back office, the boot log names it, and `crombolo start` lists it.
  A new version that asks for more is off until the new list is approved.
- **Per environment, by the people who install.** Grants are rows in
  `bundle_grant` (migration 054), in each environment's own database, made by
  anyone with the Packages section, and audited (`system` / `Grant` or
  `Withdraw` / `Bundle`). They are never in the repository and do not travel in
  an export or a pull, so a developer cannot grant a bundle by committing a file.
- **From a pipeline:** `crombolo bundle grant <id>` grants a bundle's list as
  an operator of that environment, audited as a grant in the back office is.
  A bundle added with `bun add` and wired in code is off until one or the other.

### Jobs

A bundle declares background jobs and schedules on its `ServerBundle`, run by
the same queue as the site's ([`rendering.md`](rendering.md#background-jobs);
story 187):

```ts
export const sweeper = (): ServerBundle<'redirects', typeof tables> => ({
  id: 'sweeper',
  section: 'settings',
  capabilities: ['redirects'],
  tables,
  jobs: {
    async sweep(payload: { since: string }, { bundle, job }) {
      const stale = await bundle.database.selectFrom('visit').selectAll().execute()
      await job.progress(stale.length)
    },
  },
  schedules: [{ job: 'sweep', cron: '*/30 * * * *' }],
  routes: [
    route('sweep', { POST: async (_r, { bundle }) => Response.json({ id: await bundle.jobs.enqueue('sweep', {}) }) },
      { audience: 'backoffice' }),
  ],
})
```

- **`context.bundle.jobs`**, on a bundle that declares jobs, queues one of its
  own (`enqueue(name, payload)`) and reads one (`status(id)`); another bundle's
  job is not found.
- **A job sees what the bundle's public route sees.** Its `bundle` holds the
  capabilities that do not act for a caller, and its own `database`; its caller
  is `{ kind: 'job' }`, treated as the public, so `media` refuses there as on a
  public route. Powers a public route lacks come from permissions an
  administrator grants ([Permissions](#permissions)), checked in a job as in a
  route. Nothing acts as the site.
- **A bundle that is off** (not granted) keeps its jobs waiting, and queues
  none of its schedules, until it is on again.

### Routes

A bundle's routes are route handlers, the contract a site's own routes use
([`rendering.md`](rendering.md#route-handlers)), declared with `route()`
(story 211):

```ts
import { type BundleRouteContext, route, type ServerBundle } from '@crombolo/crombolo/bundle'

type Ctx = BundleRouteContext<'log', typeof tables>

export const visits = (options: { routesAt?: string } = {}): ServerBundle<'log', typeof tables> => {
  const at = options.routesAt ?? '/visits'
  return {
    id: 'visits',
    section: 'content',
    capabilities: ['log'],
    tables, // Part 4: its handlers get `bundle.database`
    routes: [
      route<unknown, unknown, Ctx>(`${at}/species`, { GET: listSpecies }),
      route<unknown, unknown, Ctx>(
        `${at}/records`,
        { GET: myRecords, POST: addRecord },
        { members: true, rateLimit: { perMinute: 30, by: 'member' } },
      ),
      route<unknown, unknown, Ctx>(`${at}/reviews`, { GET: review }, { members: { groups: ['Staff'] } }),
      route<unknown, unknown, Ctx>('stats', { GET: stats }, { audience: 'backoffice' }),
    ],
  }
}
```

| `audience` | Where it answers | Who gets in | The context adds |
| --- | --- | --- | --- |
| `'site'`, or none | the path it declares, starting with `/` | as its `members` option says; anyone by default | `bundle`, `caller` |
| `'backoffice'` | `<backoffice>/crombolo/api/bundle/<id>/<path>` | a back-office user holding the bundle's `section` | `bundle`, `caller`, `principal` |

- **Site routes** are mounted only when the site lists the bundle in
  `bundles`, and they sit in the site's one route table with its own routes.
  The same rules apply: the reserved paths and a clash refuse the boot,
  naming the bundle, and a route hiding a published page is a status-check
  finding. A factory option such as `routesAt` lets a site move them.
- **Their options** are the site's: `members`, `csrf`, `rateLimit` and `cors`
  ([`rendering.md`](rendering.md#route-handlers)). A back-office route takes
  none of them, since the back office does its own checks, and declaring one
  refuses the boot.
- **The member** comes from the site's member cookie, or from a Delivery API
  member bearer token (`docs/delivery-api.md`, "Member sign-in") for an app.
  Either way the member must be approved and not locked out. A token's scopes
  never widen what the route allows, and a bearer token that is not live
  counts as nobody rather than falling back to the cookie.
- **A group** a route names that does not exist is reported at boot as a
  warning, not refused: groups are made in the back office while the site
  runs, and until it exists no member is in it.
- **Capabilities stay per bundle.** `context.bundle` holds the capabilities
  the bundle declared, frozen, on either kind of route. A site route reaches
  nothing a back-office one could not.

**From the browser**, the layout writes the anti-forgery token and
`crombolo.fetch` sends it with a cookie-authenticated write:

```tsx
import { AntiforgeryMeta } from '@crombolo/crombolo'

<head>
  <AntiforgeryMeta />
  <script src="/crombolo/bundle.js" defer />
</head>
```

```js
await crombolo.fetch('/visits/records', { method: 'POST', body })
```

`<AntiforgeryMeta />` writes `<meta name="crombolo-antiforgery" content="…">`
while a member is signed in, and nothing for a visitor. `crombolo.fetch` is
`fetch` with the header added from that tag, for this site's own address only.
The token is an HMAC of the member's session (`auth/src/antiforgery.ts`): the
member, the security stamp and the session's expiry, keyed by the member
cookie's signing key. Nothing is stored, so every node can check it, and it
stops working when the session ends or the stamp rotates.

**Upgrading a bundle written before 0.37.** Bundle routes before story 211
were `{ method, path, audience, handler }` objects whose handler took
`{ request, host, principal | member }`. Site routes answered under
`/crombolo/bundle/<id>/`. Those are gone, with no compatibility layer:
1. Declare each route with `route(path, { METHOD: handler }, options)`.
2. A back-office route takes `{ audience: 'backoffice' }` and keeps its
   relative path.
3. A member or public route gets a path of its own, starting with `/`. A
   member route also takes `members: true` or `{ groups }`.
4. A handler is `(request, context)`: `host` becomes `context.bundle`, and
   `principal` and `caller` are on the context.
5. `rateLimit: { max, perSeconds }` becomes `{ perMinute }`.
6. Add `"schemaVersion": 2` to the package's `crombolo` field.

### Who is asking: `caller`

Every handler is given `context.caller`, frozen, which says who the host
resolved the request to before dispatch:

```ts
type BundleCaller =
  | { kind: 'backoffice'; principal: Principal }
  | { kind: 'member'; member: BundleMember; via: 'cookie' | 'token' }
  | { kind: 'public' }
```

A site route's caller is the member when one is signed in, by cookie or
token, and `public` otherwise. Core builds a capability that acts for the
caller from it. The host passes `callerHost`, a factory per capability that
takes the caller and the bundle, and the registry calls it for each request.
That lets a capability write as the member who called and refuse a public
caller ([`media`](#media-as-the-member)). A capability without a factory is
one shared object.

### Media as the member

A bundle whose members upload files, such as a photo attached to an
observation, asks for the `media` capability and declares the folders it uses
by path (story 198):

```ts
export const observations = (): ServerBundle<'media'> => ({
  id: 'observations',
  section: 'content',
  capabilities: ['media'],
  media: {
    folders: ['/Observations/Photos'],
    types: ['jpeg', 'png', 'heic'], // optional: narrows each folder's list
    maxBytes: 10 * 1024 * 1024,     // the largest upload; a folder's own limit may be smaller
  },
  routes: [
    route<unknown, unknown, BundleRouteContext<'media'>>(
      '/observations/photos',
      {
        POST: async (request, { bundle }) => {
          const year = String(new Date().getFullYear())
          const result = await bundle.media.create({
            folder: `/Observations/Photos/${year}`,
            name: 'Sighting',
            file: request, // or a File from request.formData()
            fileName: 'sighting.jpg',
          })
          if (!result.ok) return Response.json(result, { status: result.status })
          // result.metadata: { width, height, location?, takenAt? } — keep it in the
          // bundle's own tables if the observation needs it; the stored file has none.
          return Response.json({ key: result.key, url: result.url })
        },
      },
      { members: true },
    ),
  ],
})
```

**Folders by path.** The capability reads and writes only in the declared
folders and the subfolders below them; `create` makes a missing subfolder,
such as one per year, which follows its folder's permissions rather than
belonging to the member who caused it. The boot resolves every path, matched
in any case, and **refuses a path that does not exist**, naming the bundle and
the path: create the folder in Media first, or leave the bundle out of
`crombolo.config.ts` until it exists. Because a path breaks when a folder is
renamed, the back office shows "Used by <bundle>" on the folder and on every
folder above it, and asks before renaming, moving or deleting one (the
Permissions panel's API lists them at `<backoffice>/crombolo/api/media-access/used`).
After the boot the capability holds the folders by key, so a rename while the
site runs takes effect at the next boot, which is the one that would refuse.

**As whom.** On a site route with a signed-in member it acts as the member: a `member` actor
(`content/src/actor.ts`) that only media operations take, so it can never reach
a page. The audit log names the member and the bundle, and change events carry
the member's key. On a back-office route it acts as the route's user, with
their media permissions and start nodes. For a visitor every call is
refused (`401`), since there is nobody to act as.

| Call | Needs | Gives |
| --- | --- | --- |
| `create({ folder, name, file, fileName?, mediaType? })` | write permission on the folder | `{ ok, key, url, metadata }` |
| `get(key)` | read permission | the item, its URL and its crops, or undefined |
| `update(key, { name?, file?, fileName? })` | write permission on the item | `{ ok, url, metadata }` |
| `delete(key)` | write permission on the item | `{ ok }`; the item goes to the recycle bin |
| `list(folder, { skip, take })` | — | `{ ok, total, items }`: what the caller may read, 20 a page (100 at most) |
| `crop(key, request?)` | read permission | a `Response`: the file, or a named crop or `{ width, height }`, `private, no-store`; 404 otherwise |

Permissions are 196's (`docs/rendering.md`, "Protected media"): a member may
create where they are in one of the folder's write groups, change or delete an
item its own write policy allows (a folder can give each file to the member who
added it), and read what its read policy allows. A refusal is
`{ ok: false, status, message }`, the message written for the member.

**Everything is checked before anything is stored:** the declared folder, the
permission, then the file. A member's upload is accepted only when
- its first bytes say what it is (`detectFileType`, `core/src/uploads.ts`) and
  its extension agrees: an HTML page named `photo.jpg` is refused;
- that type is on the folder's list of "File types members may upload here",
  set by an administrator in the Permissions panel, narrowed by the bundle's
  `types`; an empty list, or a folder with no rule, accepts nothing;
- the site's own disallowed extensions do not refuse it;
- it is within the smallest of the bundle's `maxBytes`, the folder's limit and
  the site's, counted as it is read, so an upload past it stops being read
  there (`413`).

A back-office user's upload keeps to the bundle's list and limits, since the
folder's list is about members.

**Images are stored upright and stripped.** A JPEG, PNG, WebP, HEIC or AVIF is
turned the way its EXIF orientation says, re-encoded in its own format, and
stored with every metadata block gone (EXIF, XMP, IPTC, comments, text
chunks), so a phone's location is never served; the colour profile is kept.
A GIF keeps its frames and loses its comments and application blocks. What the
metadata said is returned as `metadata`: `width` and `height` as stored,
`location` (`latitude`, `longitude`, `altitude?`) and `takenAt` (the camera's
local time, with its offset when it wrote one). An image that cannot be
re-encoded on this server — HEIC and AVIF need an operating system codec Linux
does not have — is refused rather than stored with its metadata. Uploads made
in the back office are not changed.

### What a handler knows about the caller

On a back-office route, `context.principal` is the authenticated backoffice user, already holding the
section the bundle declared. Everything a finer check needs is on it:

| Field | What it is |
| --- | --- |
| `id`, `email`, `userName`, `name` | who they are |
| `isAdmin` | the administrator group, which bypasses verb checks everywhere else |
| `allowedSections` | section aliases, bare or `Umb.Section.*` depending on where they were read |
| `permissions` | verbs granted globally by their groups |
| `groupKeys`, `groups` | their groups, and each group's verbs for a per-node check |
| `startNodes` | where they may work in the document, media and element trees |
| `languages`, `hasAccessToAllLanguages` | the content languages they may write |

`@crombolo/server` re-exports `Principal`, `AppAlias`, `BundleSection`, `hasSection` and
`hasCultureAccess`, so a bundle needs that one dependency rather than reaching
into `@crombolo/api-management` for them:

```ts
import { hasSection, type Principal } from '@crombolo/server'

const mayPublish = (principal: Principal) =>
  principal.isAdmin || principal.permissions.includes('Umb.Document.Publish')
```

Use `hasSection` rather than comparing the strings: `allowedSections` arrives in
either spelling, and it normalises both.

### A section of its own

A bundle that wants a top-level tab beside Content and Settings declares a
`section` manifest in its `crombolo` field like any other extension, and gates
its server half on the same alias. Nothing else is registered: the backoffice
lists a section whose alias the signed-in user holds, and a user group is
granted the section by that alias. The server stores the alias as it was sent
and hands it back at sign-in, where a core section is translated from its
stored application alias and an extension's passes through
(`core/src/sections.ts`). What is still dropped is a bare application alias
with no section behind it, which Umbraco seeds for `forms` and which the
translation exists to hide.

Every section check goes through `sectionKey`, which reads a core section by
its stored alias and an extension's by its manifest alias, so a bundle's
`hasSection(principal, 'Acme.Section.Design')` and the host's gate on
`section` agree with the grant. `tests/security.test.ts` grants an extension's
section to a group, signs in as a member, and reaches a bundle gated on it; the
administrator, who was never granted it, is refused.

### Deliberately not offered

crombolo's own `Db`, migrations of core's tables, writing the site's files, and
any capability an administrator has not granted.
The original objection to a bundle's migrations still stands: a migration
arriving with a dependency would be a schema change no `migration_history` could
account for. What a bundle may have instead is tables of its **own**, under its
own ledgered chain, in a schema or file of its own, which
[Part 4](#part-4--tables-a-bundle-owns) describes — and nothing that reaches a
table of core's.

A capability is therefore the unit of negotiation. Adding one is a deliberate act
in core — which is the point, because it is also the moment somebody decides what
a third party may touch.

## The second bundle: Microsoft Entra

`@crombolo/entra` (story 033) is a Settings screen for the Microsoft Entra
sign-ins a site declares in code with `entra()`. It never declares one: the
config is what makes a provider exist. What it changes are that provider's
settings, through the `identityProviders` capability:
- tenant, client id, client secret and button text;
- create accounts, link by verified email, trust emails;
- the group mappings and default groups.

Core keeps those overrides in `key_value`, with the client secret sealed by
`CROMBOLO_SECRET_KEY`, and applies them on top of the code's settings at every
sign-in, so a change reaches every node at once. "Use the code's settings"
deletes them.

The capability lists the providers with their effective settings, and never a
secret. It sets or clears fields, resets a provider, tests the provider's
discovery document, and lists the groups a mapping can name. The bundle shows
only the providers `entra()` made. Anyone with Settings can read the screen;
only an administrator can change it, because a group mapping can grant
administrator.

```ts
import { entraSettings } from '@crombolo/entra'
import { defineConfig, entra } from '@crombolo/crombolo'

export default defineConfig({
  backofficeIdentityProviders: [entra({ tenantId, clientId, clientSecret })],
  bundles: [entraSettings()],
})
```

## The first bundle: Simple Redirects

`@crombolo/simple-redirects` adds what the Umbraco redirect packages add over
Umbraco's own Redirect URL Management dashboard: an administrator **creating and
editing** a rule, rather than only listing and deleting the ones a rename
recorded.

The engine is not in the bundle. Matching, the URL tracker and the `redirect_url`
table are core ([`rendering.md`](rendering.md)), and they work without it.
What the bundle adds is the third `source`:

| Source | Who owns it | Precedence |
| --- | --- | --- |
| `config` | `crombolo.config.ts`, synced at boot | first |
| `manual` | an administrator, through this bundle | second |
| `tracked` | the URL tracker, on a rename or move | last |

That order falls out of `ORDER BY source` — `config` < `manual` < `tracked` is
alphabetical — which is why the repository says so out loud rather than leaving a
future reader to think it a coincidence. It is also the right order: a rule in
the site's code outranks one somebody typed, which outranks one the CMS wrote by
itself.

**Writing is confined to `manual`.** The capability sets the source itself and
refuses a key belonging to any other, so the bundle cannot forge a configured
rule, delete one the file owns, or interfere with the tracker. Posting
`source: 'config'` stores a `manual` rule, which is tested. Deleting a configured
rule answers 409 and says the file owns it — the honest answer, because the next
boot would put it back.

Two existing behaviours had to be checked rather than assumed, and both already
held: `syncConfigured` deletes only `source = 'config'` rows, so a deploy does not
remove a typed rule, and `removeSelfReferencing` touches only tracked rows, so a
rename reverted does not remove a manual rule for the same route.

### The screen

A `menuItem` in Settings' Advanced menu plus the `workspace` it points at — the
pattern Umbraco's own log viewer uses, so no vendored element is replaced to put
a screen in Settings, and the lesson from Part 1 about `overwrites` does not
apply.

It lists **every** rule in force, not only the ones it can change: a screen that
hid the configured and tracked rules would be lying about what the site does when
a URL is requested. Each row carries its source, and edit and delete appear only
where the server would allow them.

The editor offers everything the matcher supports — exact, starts-with and
regular-expression matching, a page, a path or an external URL as the target, the
four redirect status codes, and an optional culture. A screen quietly weaker than
the config file is the failure mode worth guarding against, because it is
invisible until somebody needs the option that is missing; a test asserts each
kind is offered.

One validation is load-bearing rather than cosmetic: a regular expression is
compiled when it is saved. The matcher runs it against the path of every request
that resolved to nothing, so a pattern that throws there would 500 the public
site rather than the screen that stored it.

### The screen's own view of the user

The client half is an ordinary backoffice extension, so it uses the client's own
mechanisms — there is nothing bundle-specific here.

**Declaratively**, through `conditions` on the manifest. The extension is simply
not registered when the condition fails, which is better than a screen that
renders and then refuses:

| Condition | Gates on |
| --- | --- |
| `Umb.Condition.SectionUserPermission` | access to a section (`match` is the section alias) |
| `Umb.Condition.CurrentUser.IsAdmin` | the administrator group |
| `Umb.Condition.CurrentUser.GroupId` | membership of a named group |

**Imperatively**, by consuming `UMB_CURRENT_USER_CONTEXT` from
`@umbraco-cms/backoffice/current-user`. Its members are observables —
`isAdmin`, `allowedSections`, `permissions`, `fallbackPermissions`,
`hasAccessToSensitiveData`, `languages`, `hasAccessToAllLanguages`, the start
nodes — read the way `UmbLitElement` reads any context:

```js
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'

this.consumeContext(UMB_CURRENT_USER_CONTEXT, (context) => {
  this.observe(context?.isAdmin, (isAdmin) => {
    this._mayEdit = isAdmin === true
  })
})
```

**None of this is a security boundary.** A client-side check decides what to
draw; the server decides what happens. Every bundle route is gated by the host
before dispatch, and a bundle that shows a button to the wrong person has a
cosmetic bug, not a hole.

### Calling an endpoint with the caller's identity

Authentication here is an **httpOnly cookie**, not a bearer token a script can
read — `UmbAuthContext.getLatestToken()` returns `[redacted]` under cookie auth,
by its own documentation. So a bundle's client calls its own endpoints as a
same-origin request and lets the browser carry the session:

```js
const response = await fetch(`${base()}/rules`, {
  credentials: 'include',
  headers: { accept: 'application/json' },
})
```

`base()` is read from `<base href>` rather than hard-coded, because the
backoffice path is configurable (`CROMBOLO_BACKOFFICE_PATH`) and the plugin path
moves with it — see `plugin/redirects-client.js`.

The identity needs no passing: the cookie is the session, the server resolves it
to a `Principal`, and the same `Principal` is what reaches the handler. There is
no way for a client to claim a different one.

For the **Management API**, prefer a vendored repository — `UmbPackageRepository`
is how `plugin/bundles-created-overview.js` reads created bundles — because it
carries the auth and the contract types with it. A direct `fetch` works on the
same `credentials: 'include'` footing.

### How it is published

It ships in the same release as everything else, at the same version, through
`release:publish` — `publishablePackages()` is the whole of `packages/` bar
anything private, so the bundle joined the set by existing.

Two things it needs that an ordinary package does not:

- **The `crombolo-bundle` keyword.** npm indexes keywords and not custom fields
  (Part 2), so a bundle without it is invisible in the Bundles section however
  correct the rest of it is. `tests/packaging.test.ts` asserts it, and that every
  asset the `crombolo` field points at exists and is inside `files`.
- **A place in `OPT_IN`.** The packaging suite otherwise requires every published
  package to be a dependency of `@crombolo/crombolo`, and a bundle is by definition
  something a site chooses.

### A template may wire one

`crombolo init --template demo/harbourstone` scaffolds a site with this bundle
already wired, because `template.json` says so:

```json
"bundles": [{ "package": "@crombolo/simple-redirects", "import": "redirects" }]
```

`init` then writes the dependency into the site's `package.json` **and** the
import and `bundles: [redirects()]` into its `crombolo.config.ts`. That is the
same opt-in, not a way around it: the line lands in the site's own committed
file, where it is visible in the first diff and removable by deleting it. A
template cannot wire a bundle into a site without the site's code saying so.

---

# Part 4 — Tables a bundle owns

A bundle that keeps state alongside content — a task list, an approval step, a
log of its own — can declare tables and evolve them across its own releases,
without being able to break a site's core upgrades. Story `062` gave bundles
declared, ledgered tables; story `189` moved them out of crombolo's schema into
a place of the bundle's own and gave its handlers full queries over them. The
site's own tables work the same way ([`data-model.md`](data-model.md#custom-tables)).
Core can see, verify and order a bundle's schema changes because they are
declared, ledgered and confined.

## Declaring tables

```ts
import { defineBundleTables } from '@crombolo/crombolo/bundle'

export const tables = defineBundleTables('acme-tasks', [
  {
    name: 'tasks',
    release: '1.0.0',
    up: (s) =>
      s.createTable('task', {
        id: s.uuid().primaryKey(),
        node_key: s.uuid().indexed(),
        assignee: s.uuid().nullable(),
        status: s.varchar(32).default('open'),
        due: s.timestamp().nullable(),
      }),
  },
  {
    name: 'task-priority',
    release: '1.1.0',
    up: (s) => s.addColumn('task', 'priority', s.integer().default(0)),
    backfill: (db) =>
      db.updateTable('task').set({ priority: 9 }).where('status', '=', 'urgent').execute(),
  },
])
```

The bundle hands it to its `ServerBundle` as `tables`. Declaring tables is the
whole declaration: there is no capability to ask for, and asking for the old
`tables` capability refuses the boot. A step's `up` returns the builder's
operations as plain data:

| Kind | Operations |
| --- | --- |
| Expand | `createTable` (exactly one primary key), `addColumn` (nullable or defaulted only), `addIndex`, `widenColumn` (a longer varchar, varchar to text, integer to bigint, a decimal that holds more) |
| Contract | `dropTable` (not one another table points at), `dropColumn` (not one an index covers, nor a foreign key), `dropIndex` |
| Column types | `uuid`, `varchar(n)`, `text`, `integer`, `bigint`, `boolean`, `timestamp`, `json`, `decimal(precision, scale)` |
| Column options | `nullable()`, `default(v)`, `primaryKey()`, `indexed()`, `unique()`, `references(table, { column?, onDelete? })` |
| Index options | `unique`, `descending: [columns]`, `where: { column, is: 'null' \| 'not null' }` |

A foreign key points at another of the **same owner's** tables, at its primary
key or a unique column of a type that joins; `onDelete` is `restrict` (the
default), `cascade` or `set null`. A column added later with a foreign key must
start out nullable without a default, because SQLite adds one no other way. A
default is a literal in DDL, so a string default is limited to letters, digits,
spaces and `_ . : @ / -`, and `json` and `timestamp` take none.

**A backfill is the step's own `backfill(db)`**, run in the step's transaction
once `up` has, through the bundle's Kysely handle over the tables as that step
leaves them. Keeping it out of `up` means a step's checksum and its plan never
depend on data, and that the final shape of every table can be worked out from
the declaration's types: `context.bundle.database.selectFrom('task')` is typed,
and `selectFrom('node')` does not compile. `upgrade --plan` reports a step with
a backfill as unplannable.

## Where they live

| | Postgres | SQLite |
| --- | --- | --- |
| A bundle's tables | the schema `bundle_<id>`, the id's hyphens as underscores | the file `<crombolo>.bundle.<id>.sqlite` beside crombolo's |
| Owned by | a login-less role, `{site}_{id}_{hash}` (below) | — |
| A table, an index | its logical name; an index's is `ix_<hash>`, generated, never chosen | the same |

Statements are unqualified: they run on the bundle's own connection, in its own
schema or file, so a table needs no prefix and two bundles cannot collide. A
table may not start with `ix_`, the indexes' namespace; any name past Postgres's
63-character limit is refused at boot. A bundle may not have the id `site`,
which names the site's own tables.

Roles and connections are described in
[`data-model.md`](data-model.md#custom-tables): every transaction on the
handle begins `SET LOCAL ROLE`, the role has no privilege on crombolo's tables or
another owner's, and on SQLite crombolo's file and the others are never
attached. The CMS creates the role and schema when the bundle is first migrated,
or prints the SQL for an operator where its database user may not.

## The ledger

| | Where |
| --- | --- |
| A bundle's state | `key_value`, under `Crombolo.Tables.<id>.State` |
| Its role's name | `key_value`, under `Crombolo.Tables.<id>.Role`, recorded when it was made |
| Its steps | `migration_history`, with the bundle's id in the `bundle` column; null for core |
| A step's state | derived from its position and name: `tables:<id>:<n>:<name>` |
| A step's checksum | a hash of its recorded operations, not their SQL, so it is the same on both dialects |

`migrate` is generalised over a chain's state key, initial state and where its
steps run (`MigrationPlan` takes them). A bundle's chain runs under the same lock
as core's and writes through the same `recordInLedger`. On Postgres a step runs
in crombolo's transaction with the bundle's role and search path taken for it,
so the step and its ledger row commit together; on SQLite the step commits on the
bundle's file just before its ledger row on crombolo's. A bundle's chain is also
verified before it runs: a step whose operations no longer match the checksum
ledgered when it ran is refused, naming the step, because a shipped step is
never edited. A bundle's contract does not count toward the contracts a `web`
node watches for: it removes only the bundle's tables, which no core read
depends on.

## Expand and contract, per bundle

The rules core's plan is held to, with `release` read as the **bundle's**
version: from the bundle's 1.0 a contract may only ship in a bundle major
(`x.0.0`), and before it in any release, and it may only remove what an earlier
bundle release added; a step is an expand or a contract, never both; no step may
claim a release later than the package's own version. `compileTables` collects
every problem and `validateServerBundles` reports them at boot. A bundle's own
test suite can hold itself to the same rules with
`assertBundleTables(tables, version)`, and `bundleTablesCompatibility(tables,
version)` derives the `"crombolo": { "migrations": "compatible" | "breaking" }`
its `package.json` declares, the way core's declaration is derived. Boot refuses
a bundle with tables whose package declares none, or declares something its
plan does not make true.

## Order and gates

- `crombolo upgrade` applies core's pending steps first, then the site's own,
  then each bundle's in the order `bundles` lists them, so a bundle step always
  runs against a core it declared itself compatible with. `bootstrapDatabase`
  and `installDatabase` do the same.
- `upgrade --plan` and `upgrade check` list each owner's steps under it;
  `/status` reports `bundles[id].state` and `.pending`; the Changes dashboard
  shows each owner's changes, done and waiting.
- In production, boot refuses while any step is pending, with
  `UpgradePendingError` naming the owner. Development applies them.
- A database ahead of a bundle's code refuses with `UpgradeStateError`, naming
  the bundle and both states.
- The pre-upgrade backup covers bundle tables: SQLite copies each owner's file
  beside crombolo's; on Postgres `CROMBOLO_PG_DUMP` dumps the database, schemas
  included. Roles belong to the server, not the database, so a dump does not
  carry them: a restore onto another server re-creates them at its first boot.
- Only a node that owns the database — one serving the backoffice — migrates a
  bundle's tables or creates its role. A `web` node reads nothing of a bundle's.

## `context.bundle.database`

A Kysely instance on the bundle's own connection, typed from its steps, handed
to every handler of a bundle that declares tables:

```ts
const open = await bundle.database
  .selectFrom('task')
  .selectAll()
  .where('status', '=', 'open')
  .where('due', '<', new Date())
  .orderBy('due')
  .limit(50)
  .execute()

await bundle.database.transaction().execute(async (trx) => {
  await trx.updateTable('task').set({ status: 'done' }).where('id', '=', id).execute()
})
```

Joins, grouping and aggregates across the bundle's own tables are Kysely's, and
so is `sql` for anything else, with values bound and never spliced. Values read
and write the same on both engines: a boolean is `true`/`false`, a timestamp a
`Date`, `json` a parsed value, a `decimal` a string to its scale, and a `uuid`
lowercase and compared without case. Only columns a query names, or `*`, are
converted; an expression arrives as the engine computes it. In an insert of
several rows, SQLite stores null for a column a row leaves out rather than its
default, so give every row the same columns, or insert them one at a time.

## Confinement

The requirement is that the handle never reaches outside the bundle's tables:

- **On Postgres**, the role owns its schema and nothing else, has no privilege
  on crombolo's tables or another owner's, and may not create a schema. Every
  statement runs in a transaction that begins `SET LOCAL ROLE`, so the role
  drops back at commit and is safe behind a connection pooler.
- **On SQLite**, the handle is a connection to the bundle's own file, with
  crombolo's database and the other owners' files never attached.
- **No `Db` is reachable.** The handle is Kysely over a driver that holds the
  owner's connection; crombolo's own is not a property of anything handed out.

`tests/custom-tables.test.ts` proves it on both engines by trying: a handle
naming a crombolo table, qualified or not, and another owner's table, fails.
What it guards against is mistakes and injected input. A bundle runs unsandboxed
in the server process (story 173), so deliberately hostile code could issue
`RESET ROLE` or `ATTACH DATABASE` (Bun's SQLite driver cannot forbid attaching);
installing a bundle is a decision to trust it.

## Moving from 062's prefixed tables

Until 189 a bundle's tables were `bundle_<id>__<table>` in crombolo's schema,
reached through a `tables` capability with its own filter language. They are not
migrated: nothing in the repository used them beyond tests, and their state key
is not the new one, so a bundle's chain starts again in its own place. The old
tables are left where they were; drop them once their data is moved. The
release notes carry the upgrade note.

## Removal

Taking a bundle out of `bundles` leaves its tables, state and ledger rows in
place, and re-adding it resumes from its recorded state.

```
crombolo bundle purge <id> [--yes] [--backup-taken]
```

drops the bundle's schema and its role on Postgres, or deletes its file on
SQLite, and clears its state, after the same backup `upgrade` takes. It is
ledgered as kind `purge` against the bundle, which also starts the bundle's
checksum history again. A role the CMS's database user may not drop is left and
named. It refuses while `crombolo.config.ts` still wires the bundle, and lists
what it will drop and asks for the id to be typed back, unless `--yes`.

## Testing

`tests/custom-tables-rules.test.ts` holds the declaration's rules with no
database: names, roles and files, the builder's limits and what 189 added to it,
SQL steps, expand and contract per owner read against the owner's version,
states and checksums. `tests/custom-tables.test.ts` runs under both dialects
against the fixture bundle in `tests/support/fixture-bundle.ts` — an
expand-only 1.x and a 2.0.0 with a contract — and a site's own tables: the
chain, the ledger, backfills, edited and newer steps, the handle's values,
joins, aggregates and transactions, confinement, purge, and on Postgres the
roles, with two databases on one server and a database user that may not create
roles. `tests/custom-tables-site.test.ts` boots a real site with its own tables
and named queries and wiring the fixture: a route using `site().queries`,
another using `context.bundle.database`, the dashboard's report,
`upgrade --plan`, `check`, `/status` and `upgrade`, and `bundle purge`.

## Out of scope

- Reading an Umbraco-authored package, `.zip` or `.udt`. Importing *types*
  already works (`GetImportAnalyze` and the content-type importers).
- Package migrations of core's tables, which this document argues should never
  exist here. A bundle's *own* tables, under its own ledger and never touching
  core's, are Part 4.
- Bundle tables travelling with content transfer or a created package; joins
  with core tables; events from core such as "this node was deleted". A whole
  site's export carries them with `--with-site-data`
  ([`data-model.md`](data-model.md#custom-tables)).
- Isolating a bundle's server code. There is no sandbox and none is implied: a
  bundle you import is code you run, exactly like any other dependency in the
  file. What the design buys is that importing it is a decision somebody makes
  and commits.

## The product site's bundle

`sites/crombolo/bundles/demo-crombolo` is the one committed bundle that carries
its site's schema, components and styles as well as its content, so a new page
type reaches the platform in the same install as the pages that use it. The
platform installs it with permission to replace files, so the repository wins
over an edit made there. The templates' bundles stay content-only, since
`crombolo init` writes the files beside them.

Its docs section (`/docs/`) is built into it: the guides are Markdown in
`sites/crombolo/docs/`, and the command line, configuration and exit code
references are generated from the CLI's manifest and
`packages/server/src/settings.ts` (`scripts/docs-site.ts`).
`bun run build:template` rewrites the lot: the docs pages as seed files under
`sites/crombolo/seed/content/home/docs/`, then the site's bundle, and
`tests/docs-site.test.ts` fails when a guide, a command or a setting has changed
without a rebuild.
