# Bundles

Bundles, a tool in Settings (story 238) where Umbraco has its Packages section,
covers two things that have nothing to do with each other, and this document
keeps them apart:

- **Created packages** — exporting a slice of this site as a file, which is the
  nine `package` operations in the Management API contract. All nine are
  implemented (`api-coverage.md`).
- **Where it is (story 238).** Extensions is a Settings tool, the Extensions
  card under Extensions (`plugin/bundles-tool.js`), with Marketplace, Installed and
  Created as tabs at `section/settings/dashboard/extensions/<tab>`. The bundle
  builder is under Created, at `created/package-builder/create` and
  `created/package-builder/edit/:unique`.
  - **Who may use it:** whoever has Settings, and the server's bundle
    endpoints ask the same. Umbraco's Packages section is gone: the fork no
    longer registers it, and migration 060 removes it from every user group.
  - **A user-group file** that still names `packages` loads, without it.
  - **Old addresses:** a `section/packages/...` address opens the same screen
    under Settings, its query kept (the fork's `moved-sections.ts`).
- **Extensions** — code someone else wrote, added to a site. This used to be the
  `App_Plugins` directory convention inherited from Umbraco; it is now npm
  dependencies, and `App_Plugins` has been removed.

## Site packages and extensions

Every bundle says which of two kinds it is (story 306), in `bundleType`:
`"crombolo": { "bundleType": "site" }` or `"extension"` in its `package.json`,
and the same in its `bundle.json`. A bundle that says neither, or whose two
files disagree, is refused. Nothing is assumed.

| | Site package (`site`) | Extension (`extension`) |
|---|---|---|
| **What it is** | This site, or a part of it, made to move it: a backup, the next environment, a subtree to copy | Someone's addition to a site: screens, a server half, content and structure |
| **Made by** | `site build`, `site export` (and `--subtree`), `site deploy`, `push`, `pull` | The Bundle Editor (Created), `extension build <name>`, or by hand |
| **Brought in by** | `site apply` (here or `--remote`), `site deploy`, `push`, `pull`, `start --bundle`, `--code-into`: from a file or a directory only | `extension install` (here or `--remote`), the Marketplace: as a dependency |
| **May carry** | Everything the site has, `code/` included: its config, `package.json` and `bun.lock` | Never `code/` |
| **Published** | Never: it is `private`, and declares no `server`, `extensions`, `permissions` or `importmap`, which are an extension's | To a registry, or kept as a file |
| **Undone by** | `site revert <run>` | `extension uninstall --drop-content` |

Each way in takes only its own kind and names the other's command when given
the wrong one. A site package found on a registry, as a dependency, or in a
`.tgz` given to `extension install` is refused: "it is a site package, which is
applied to a site with `crombolo site apply`, never installed". Applying one
opens with what it replaces that decides how the site runs: "Site package:
replaces this site's code, config and dependencies", then
`crombolo.config.ts` and `package.json`, then the dependencies its
`package.json` adds, removes and changes, then the rest.

**The marker cannot change unnoticed, but it is not a lock.** From format 8
the integrity hash covers `bundle.json`, with its own `integrity` value blanked,
and the package's identity (its `name`, `version` and `crombolo` field, keys
sorted, so a packer's normalising of the rest does not matter) after every file
it carries. An edit to either file after the build fails it, and so does an
empty hash. It has no key, though: whoever changes the marker can work the hash
out again. Only a signature (story 060), whose digest covers both files, makes
it unforgeable, and a site that wants that sets
`CROMBOLO_BUNDLE_SIGNATURES=required`. The rules above are built so that a
forged marker gains nothing:
- an extension marked as a site package is refused by every registry route, and
  is applied only by someone choosing to run `site apply` on the file, which is
  trusted as restoring a backup is;
- a site package marked as an extension can do less, since an extension never
  carries `code/`;
- one marked as neither is refused.

**Installed extensions from before 306** say nothing, so each is turned off: the
site starts without it, the boot log and the Installing code health check name
it, and installing a version that says `"extension"` turns it back on. Older
bundle files are refused, with a message to build them again: format 8 is the
oldest read.

## One artifact: a bundle is an npm package

Every bundle is an npm package, with no exceptions: the Created view's
download, an environment's `site export --subtree`, a site directory's `site build`, and
anything published to the registry. Its `package.json` carries the **bundle
manifest** in its `crombolo` field, and the manifest declares the bundle's three
possible halves:

```json
{
  "name": "@acme/tasks",
  "version": "1.1.0",
  "keywords": ["crombolo-extension"],
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
| `schemaVersion` | the bundle contract the package is written for; absent means `1`. A package with code must say `6` (stories 323, 329), or it is refused at install and at boot, naming `crombolo extension migrate`, which takes 5 to 6; `6` lets an entry name a described screen ([`extensions.md`](extensions.md), "Screens") |

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

The tool reads **Extensions**. A bundle is the file format: what the builder
produces ([`content-transfer.md`](content-transfer.md)), whether an extension
or a site bundle. An extension is the kind other sites install, published to npm
under the `crombolo-extension` keyword; a site bundle is a whole site, or part of
one, moved between environments and never installed.

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

### The Bundle Editor

Creating or editing a bundle opens Crombolo's own editor, not Umbraco's package
builder (story `233`). Its manifest declares `overwrites:
['Umb.Workspace.PackageBuilder']` for the same `package-builder` entity type,
so the Created view's routes reach it and nothing reaches Umbraco's.

- **Why its own.** Umbraco's builder draws its form as the workspace editor's
  default content, which the editor stops showing as soon as any tab is added;
  a bundle that carries more than Umbraco knows needs tabs.
- **Its tabs** are workspace views on `Crombolo.Workspace.BundleEditor`:
  **Content** (a page and optionally the pages below it, media and optionally
  what is inside them, Library elements), **Types** (document, media and data
  types), **Code** (templates, partial views, stylesheets, scripts),
  **Language** (languages, dictionary items), and **Forms**, **Workflows** and
  **User groups** (story `226`). Another is one more registration.
- **The same definitions.** It is made of the inputs Umbraco's builder is made
  of, and loads, saves and downloads through Umbraco's own package repository,
  so a definition made before it opens and saves unchanged. It says "bundle"
  throughout, its toasts included.

#### Two kinds: an extension, or a site bundle

Story 312. A definition says what it builds, set beside its package name in
Created (`<backoffice>/crombolo/api/extensions/created/<id>/package`, `kind`;
migration 068). Every definition before it is an extension.

- **An extension, for other sites to install:** its schema, content,
  dictionary, styles and scripts are its payload. The templates and partial
  views it picks are its code (`server/src/created-extension.ts`):
  - they are written to `src/components/`, and a generated `src/index.ts`
    declares them as the factory's `components`, which `crombolo.server` names;
  - its schema and pages name them by its id, `<id>/<alias>`;
  - it asks for `templates`, so installing it asks for that grant;
  - where it is installed, they render in its own process
    ([`extensions.md`](extensions.md), "Components").
- **A site bundle, to move this site:** everything it picks, components
  included, as the payload of a site package (`bundleType: "site"`, private).
  It is applied with `crombolo site apply` or `push`, and never installed: what
  `site export` makes, from the back office.

#### Forms, approval workflows and user groups

Umbraco's definition has no fields for these, so the three tabs keep their
picks in the `bundle` table's `schema_picks` column (migration 058), through
`<backoffice>/crombolo/api/extensions/created/<id>/schema`. Each tab lists the
site's own files (`schema/forms/`, `schema/workflows/`, `schema/user-groups/`)
by name, from `<backoffice>/crombolo/api/extensions/schema`.

A pick brings what it needs (`carriedPicks`, `server/src/schema-picks.ts`):

| Pick | Brings |
| --- | --- |
| An approval workflow | the document types it covers, and the groups its stages name |
| A form | the document type its "save as content" step creates |

What a pick brings is ticked on its tab (a document type under **Added for
forms and workflows** on Types), saying which pick added it. Unticking one
leaves it out and warns that the pick needs it, which is right when the site
that installs the bundle already has it; the choice is kept as `excluded`.
The editor asks `…/bundles/schema/carried` what the current picks bring, so a
bundle not yet created shows it too. The page a "save as content" step creates
under is content, so it stays a reference: the step does nothing until that
page exists where the bundle lands.

The build carries the form, workflow and group files as the site holds them;
a brought document type goes through the same path as a picked one. Installing
copies them into `schema/` and syncs them, as any schema file. A site-directory
bundle (`crombolo site build`) carries every file under `schema/` anyway.

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
`package.json` names the package, carries the `crombolo-extension` keyword, and
declares a peer range of `>=` the release it was built by — the same range an
environment's export, an Umbraco import and a `site build` carry.
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

Every bundle says `formatVersion: 7`, whatever it carries, and format 5 and 6
bundles still load. A content-only bundle carries no `carries` key. An older node refuses
a newer bundle by name, with "upgrade crombolo to import it", rather than failing
an integrity check it cannot explain. A node refuses a bundle older than 5 with a
message saying to rebuild it (stories 193, 195, 283 and 284).

### Public files

A site's `public/` folder (story 284, `docs/rendering.md`, "Public files")
travels as files at `public/<path>`, carried by `site build`, a whole-site
export and so `push` and `pull`. A created package from the back office does
not carry it.

- **`public.json`** at the package root lists each file with its size and
  SHA-256, and the manifest's `publicManifest` says it is there. The bundle's
  hash covers that list and not the files, so a folder of images is never held
  in memory. `carries.public` is filled from the list as it is read.
- **Reading is strict.** A file that differs from the list, is missing, or is
  not listed refuses the bundle, as does a path that climbs out of the folder.
- **Why format 7.** A site on an older release discards a section it does not
  know, so without the bump it would drop these files silently. It refuses
  the bundle by name instead.
- **What is left out:** dotfiles, except under `.well-known/` and a `.gitkeep`,
  which travels so that git keeps the folder. It is never served.
- **Installing it** follows the other file sections, as bytes: a file that
  differs is not replaced without being asked, a revert puts it back, and a
  whole-site replace removes what the file does not carry, after `push
  --dry-run` has said so.
- **Size:** there is no limit beyond `CROMBOLO_REMOTE_MAX_UPLOAD_GB`. `bundle
  build` warns above 100 MB and names the largest files, and `push --dry-run`
  says how much `public/` adds.
- **A `crombolo.code` glob** never matches `public/`, which has its section.

### Library folders

A Library folder travels as a node of kind `element-folder`, with its key, name,
parent and sort order, and no values (story 283). `ELEMENT_FOLDER_TYPE`, from
`@crombolo/crombolo/transfer`, is what such a node names as its type.

- **Export:** an element brings the folders above it, and a folder chosen as a
  root brings what is inside it. A whole-site export carries them all.
- **Import:** folders are made first, keeping their keys, so an element lands in
  its folder and a picker's `startNodeId` resolves. A folder already here is left
  as it is: a rename or a move at the source does not follow. A folder of the same
  name under another key sits beside it.
- **Revert:** the folders an import made go to the recycle bin, unless something
  else now sits in them, and then they stay with their parents. An import brings
  back a folder from the recycle bin.

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
them, through `<backoffice>/crombolo/api/extensions/created/<id>/package`. Until
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
types, components, stylesheets, scripts, languages, dictionary items, and
`schema_picks`, the forms, workflows and user groups (story `226`). The lists are JSON text; they are read and written whole and never
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

- **Discovery** is a published keyword convention: `"keywords": ["crombolo-extension"]`.
  It is the only thing npm will index, so it is a publishing requirement, and
  `docs` and the package template say so. The marketplace also searches
  `crombolo-bundle`, the keyword before 0.57.0, so extensions published under it
  are still found.
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

**Only a bundle, and only with its grant** (stories 194, 308). Before `bun add`,
the install reads the registry's manifest for the version asked for: the exact
version, the highest a range admits, or the latest.
- A package that is not a valid bundle is refused, so the endpoint never
  installs an arbitrary package. Neither is a site package, nor a version written
  for bundle schema 3.
- A registry that cannot be read is refused too, because what the package
  carries cannot be checked.
- An extension that asks for permissions is refused with `needsGrant`, each
  permission with its sentence, its reason and its origins, unless the request
  grants exactly those (`grant`; `user.delegate` also records who granted it)
  ([Permissions](#permissions)).
- After `bun add`, the installed package's own manifest is checked again. A
  version that asks for more than was granted is removed, and the install is
  refused. This catches a `latest` that moved between the listing and the
  install. Otherwise the grant is recorded against the version that landed, for
  every extension, since a grant is what lets one run (story 309).

The Marketplace asks for the grant in the extension's own card:
- **Install** opens a panel listing each permission with its reason, and asks
  whom it acts for when it asks to. It names the publisher, with links to npm and
  the source, and says its screens act as whoever is signed in.
- The panel has an unticked "I trust this publisher, and grant what it asks for"
  box, and **Grant and install** stays disabled until it is ticked.

The audit log records each install and uninstall once: `system` / `Install` /
`Bundle`, naming `package@version`, with what was granted.
A bundle with screens says, after install, that they run in the browser of
everyone who uses the back office.

**No install scripts.** The install runs `bun add --ignore-scripts`, so a
package's lifecycle scripts never run on the server, whatever Bun's built-in
list of trusted packages or the site's `trustedDependencies` say.

**Then its content, unless declined.** A bundle that carries content has it
applied straight after `bun add`, through the same installer and overlay check
as `crombolo site apply` (`server/src/bundle-install.ts`), with the server's
own connection. The site turns this off with `applyBundleContentOnInstall: false`
(`CROMBOLO_APPLY_BUNDLE_CONTENT=false`), and the Marketplace card has a toggle
that declines it for one install. A refused check or a backup the site cannot
take leaves the dependency installed and says why; the import then waits on the
Changes dashboard, where its conflicts are answered and it is run
([`content-transfer.md`](content-transfer.md), "In the backoffice"). The install
that succeeded is not undone.

**The record and the roots are the install ledger** (story 326). An extension is
not a dependency of the site. It installs into a root of its own,
`extensions/<id>/`, with its own `package.json`, `bun.lock` and `node_modules`,
and the site records it in `crombolo.extensions.json`: its package name, exact
version, tarball integrity, and `linked` for one installed from a path on a
developer's machine. "Incorporate this into future deployments" is committing
the root's two files and the record; a deploy runs `bun install --frozen-lockfile`
in each root. The site's own `package.json` and `bun.lock` never change when an
extension is tried, and removing one deletes its root and its line.

- **Discovery** reads the record and each root first, then the site's dependencies
  as before, for the bundles the site's config wires as its own code.
- **One installed as a dependency,** the way before 0.61, is named at boot and in
  Installed, "installed as a dependency of the site, which this release no longer
  runs", and is neither started nor shown in the back office unless the config
  wires it. Nothing moves it: remove it from `package.json` and install it again.
- **A developer's link** is a dependency that links to a package elsewhere on the
  machine, a workspace's or one `bun link` made. It runs outside production, as
  before, and is refused in production with what to do instead.
- **A file install** is still kept in `bundles/` (story 245); its root names it as
  `file:../../bundles/<name>-<version>.tgz`.
- **A site package** always carries the record and each root's `package.json` and
  `bun.lock`, never a root's `node_modules`; an apply installs each root whose files
  changed from its own lockfile. A site file's `requires` names each recorded
  extension.
- **A host installs with the CMS's own install** (story 332): `installExtension`
  and `removeExtension` from `@crombolo/crombolo/host` prepare the root, run
  `bun add`, check what landed and write the line, so what a host installs is
  what the boot runs. `installExtension` is held to the site's signature policy
  unless the host passes its own, refuses what the Marketplace refuses, and grants
  nothing: the config's `extensions` entry or an administrator does that.
  `installBundleCode` installs the roots a site package's code carries, and
  `checkBundleCode` names a root that does not match its line and an extension the
  code lists as a dependency. `api.md` has the exports.

### From the command line (story 241)

The same installs, from a script, on the site's own machine or on a remote. One
implementation serves Settings → Extensions, the remote protocol and the CLI
(`server/src/bundle-admin.ts`), so all three refuse and audit alike.

| Command | Does |
| --- | --- |
| `crombolo extension list [--remote <name>]` | the installed bundles: version, whether their server features are on, what was granted and by whom, and whether installed changes wait for a restart |
| `crombolo extension install <name[@version] \| file.tgz> [--grant <p>…] [--delegate-to <user key>] [--apply-content] [--remote <name>] [--dry-run]` | `bun add`, as Install does, granting what it asks for; the content too with `--apply-content` |
| `crombolo extension uninstall <name> [--remote <name>]` | `bun remove` |
| `crombolo extension disable\|enable <id> [--remote <name>]` | a bundle's server features off or on, at once ([story 225](#permissions)) |

- **A grant names exactly what is asked.** A bundle with server code is
  installed only when `--grant` names every permission it asks for, and nothing
  else. A newer version that asks for more is refused until the script grants
  it, so a script never grants something new without someone changing it.
  `--dry-run` reads the registry and says what would be installed and granted.
- **A bundle from a file is kept in the site** (story 245). `extension install
  ./acme-crm-1.2.0.tgz` copies the file, byte for byte, to
  `bundles/<name>-<version>.tgz` (`@acme/crm` 1.2.0 is
  `bundles/acme-crm-1.2.0.tgz`), checks the copy's signature, and installs
  `./bundles/acme-crm-1.2.0.tgz`, the relative path Bun records with the file's
  sha512 in `bun.lock`. Commit the file with `package.json` and `bun.lock`, and
  every checkout, node and CI build installs the same bundle. A file already in
  `bundles/`, or the same bytes again, is used as it is; another file of the
  same version is refused, since one version is one file. A new version from a
  file, or an uninstall, removes the old file unless another dependency still
  names it. A site package carries each `bundles/*.tgz` its `package.json` names,
  so `site apply --structure` and `site deploy` install it on the remote from
  the lockfile; a named file that is missing stops the build. A remote takes
  registry names only, so a file reaches a remote this way.
- **Granting is installing (story 310).** An extension runs once granted, with
  nothing imported: `--grant` names what it asks for, or the site's config grants
  it under `extensions` ("Extensions run once granted"). `--wire` is gone.
- **Installed code waits for a restart.** Installing or removing a bundle with
  a server half records it in `.crombolo/restart-pending.json`
  (`server/src/restart-pending.ts`), which `extension list`, the remote's listing
  and Settings → Extensions → Installed show ("Installed changes take effect when
  the site restarts."), until `crombolo restart`. A server that boots clears
  it. So do granting one and turning one on, when its server half is not running on
  this node: an extension is built and started only at boot, so it runs after the
  restart, and the answer says so (story 346 starts it at once instead). On the
  command line, with no server to ask, it is always said. Turning one off needs no
  restart: its routes answer 503 at once.
- **On a remote** (`bundle-manage`, [`remote-protocol.md`](remote-protocol.md)):
  listing needs the level `read`; the rest need `all`. Installing and removing
  also need ApplyStructure and "Install code on this site"
  (`Crombolo.Remote.InstallCode`), which an administrator holds only when a
  group gives it to them, and a site that installs while it runs
  (`CROMBOLO_RUNTIME_INSTALLS`). Turning one off or on needs an administrator,
  or a CI rule that may apply structure.
- **On the site's own machine** the CLI works on the site directory and its
  database, with no server running, and always installs: there the site is a
  working copy to commit from, whatever it says about installs while it runs.
  The audit log names the person at the terminal, with source `cli`.

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
  An install writes `package.json`, applies the payload, and stops there. A
  package that installs but is not a valid bundle is reported as exactly that
  rather than as a success.
- **Where each part of an extension lands** (story 312). An extension's code,
  its server half and its components, stays in its package and runs in its own
  process ([`extensions.md`](extensions.md)). Its payload is data:

  | Part | Lands | Runs |
  |---|---|---|
  | its server code (`src/server/`): the server half and its components | stays in the package | in its own Deno process: routes, events and jobs as calls, components as `render` calls |
  | its back-office code (`src/backoffice/`) | built to `.crombolo/extensions/<id>/backoffice/`, and only that build is served (story 320) | in the back office, as the signed-in user, once `backoffice.code` is granted |
  | `schema/`, `nodes/`, `values/`, media, dictionary | applied into the site, then the site's own | nothing; it is data |
  | `styles/`, `scripts/` | copied into the site | in the visitor's browser |

  An extension's `bundle.json` may not list `components/`, `code/` or value
  migrations (`schema/migrations/*.ts`): each is refused, and nothing is written.
  A site package carries all of them, as the site's own code.
- **Content applied at runtime is this node's too.** It writes `schema/` and the
  component directories on the node that served the request. On a
  load-balanced site, turn `applyBundleContentOnInstall` off and let the content
  arrive with the deploy that commits it.
- **Uninstall** (story 328) is one step, an administrator's: stop its process, forget its grant
  and settings, delete its root, its build and its record line, and write one audit entry.
  Its data, its tables and its data folder, is kept, listed in Installed under "Data left
  by…" with a delete of its own, and an install of the same extension picks it back up.
  `--drop-data`, or "Also delete its data", drops the tables, schema and role with it, with
  no backup, naming a role the host made that the CMS cannot drop. `--drop-content` takes out
  the content its install applied (`--revert-content` before 0.61, still read for now). The
  command line asks first unless `--no-verify`, and refuses off a terminal without it. A
  bundle the site's config wires is its own code, and is refused.

Supply chain: the install runs third-party JS in the backoffice origin with the
user's session. It is gated on Settings access, as the Extensions tool is, the
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
- **Checking a signature first** (story 244). A host that installs bundles
  itself runs none of the CMS's install paths, and `CROMBOLO_BUNDLE_SIGNATURES`
  on a node guards only what that node installs. `verifyPackage` (a directory
  or `.tgz`) or `verifyProvenance` (a directory), then `provenanceProblem` with
  the site's policy and `describeProvenance` for the line to show, from
  `@crombolo/crombolo/host`, hold it to the rule the site would apply, in the
  back office's words. An `unchecked` answer means Sigstore's trusted root
  could not be had: try again later rather than installing.
- **Where installs happen.** With `runtimeInstalls` off,
  `installsElsewhere: { message, url }` (`CROMBOLO_INSTALLS_ELSEWHERE_MESSAGE`
  and `_URL`) replaces the Marketplace's "add it to `package.json` and deploy":
  the banner shows the message and a link, each package not installed shows the
  link instead of the `bun add` line, and a refused install says the message.
- **Output should import only what the host provides.** A bundle's back-office
  files are served as they are, so an import of a package the host has not put
  on the node fails in the browser. The import map covers the vendored client
  (`@umbraco-cms/backoffice/*`), and nothing else is promised.

### A site package with code

A site that is part application has server code of its own: the server
bundles its `crombolo.config.ts` wires, and their source. A self-hosted site
deploys that from its repository. A host that runs the server for its
customers needs it as one artifact, checked by the CMS's rules, and the
bundle is that artifact (story 192).

- **Which files.** The site's `package.json` names them, as globs in
  `crombolo.code` (`"code": ["src/**", "vendor/**"]`), and
  `crombolo site build --code <glob>…` overrides the list. Once there is
  code, `package.json`, `bun.lock` and `crombolo.config.ts` are always packed.
  These are never packed, whatever a glob matches: `node_modules`, `.git`,
  `.env` files, SQLite files, the folders the bundle already carries as
  sections (`schema/`, `components/`, `css/`, `scripts/`, `public/`, `content/`), and the
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
- **`crombolo site check-code <bundle>`** (`checkBundleCode`) lists every
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
- **`crombolo extension install <bundle> --code-into <dir>`** (`installBundleCode`,
  `bundle install-code` before story 241) checks the hash, then installs the
  code into an empty directory the same way.
  It never writes over a directory that already holds files. The directory has
  to sit where the host's `@crombolo/*` packages resolve from. Starting the
  site, or restarting it so its server bundles are wired, is the host's step.
- **An apply installs it** (story 241; story 192 left it to a host).
  `site apply` writes each file under `code/` to its site path, keeps what
  it replaces under the run, and runs `bun install --frozen-lockfile
  --ignore-scripts` when `package.json` or `bun.lock` changed
  (`server/src/bundle-code-install.ts`). Code the site already has is not a
  change. An overwrite needs `--replace-files`, as for a view; where runtime
  installs are off (`CROMBOLO_RUNTIME_INSTALLS`) it is refused, with the
  host's message. `site revert` puts the files back and installs again.
  The server loads code at boot, so installed code waits for `crombolo
  restart`, and the health check "Installing code" says so.
- **What a site package always carries.** Once the site has a `bun.lock`, a
  site package carries `package.json`, `bun.lock` and `crombolo.config.ts` even
  when `crombolo.code` names nothing, so a dependency `extension install` added and
  the config's `extensions` entry travel with `site apply --structure`.
- **`start --bundle`** leaves the code alone: the code a host starts is its
  own step.

Both functions are exported from `@crombolo/crombolo`, beside
`validateBundlePackage`, for a host to run in its own process.

---

## Signing a bundle

A bundle can say where it was built (story 060). Signing is optional: an
unsigned bundle installs and applies as it always has, unless the site asks
otherwise.

- **What is signed.** The package digest: SHA-256 over every file in the
  package, in path order, but `provenance.json` (`packageDigest` in
  `server/src/provenance.ts`). It covers what a bundle's own `integrity` does
  not: `package.json`, and an extension bundle's `src/`. The
  signature cannot sign itself, and nothing else is left out. `crombolo bundle
  digest <dir|tgz>` prints it.
- **How.** Sigstore, keyless, in GitHub Actions. The job's identity token gets
  a short-lived certificate naming the repository, the ref, the commit and the
  workflow, and the signature is entered in Sigstore's public log. No producer
  holds a key to lose. The signature is an in-toto statement over the digest
  (predicate `https://crombolo.dev/bundle-provenance/v1`).
- **`provenance.json`** sits at the package root: the digest, the Sigstore
  bundle, the source the certificate names, and links to the commit, the tag,
  the run and the log entry. It is checked against Sigstore's public trust root,
  with no call to GitHub.

A producer's job:

```yaml
permissions:
    contents: read
    id-token: write
steps:
    - uses: actions/checkout@v5
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - run: bunx crombolo site build --out dist/acme-bundle --sign
    # or, for a package packed some other way: bunx crombolo bundle sign dist/acme-bundle-1.2.0.tgz
    - run: npm publish dist/acme-bundle
```

Sign last: any change to the package afterwards makes the signature fail.

**A private repository.** Sigstore's public log keeps every signature for good,
and a GitHub Actions certificate names the repository and its owner, the
workflow file, the tag or branch, the commit and the run. The bundle, its code
and its package name are not published: the signed statement carries the
digest alone. Because the names are, `bundle sign` reads the job's repository
visibility and refuses for a private or internal repository, or one GitHub does
not say, unless given `--public-log` (also on `build --sign` and `deploy
--sign`). npm's own provenance refuses private repositories outright for the
same reason. Checking is the same for either: the certificate travels in the
bundle, and the commit and tag links open only for people who can see the
repository.

**What a signature claims, and what it does not.** It ties the bytes to a
build: *built from github.com/org/repo at v1.2.0 (abc1234)*. It says nothing
about whether anyone reviewed that source, so the wording is always *built
from*, never *verified* or *safe*; reviewed publishers are story 061. A tag can
move, so the commit is what the signature records and the ref is only its name
at signing time.

**What a site takes.** `crombolo bundle verify <dir|tgz|url|name@version>`
says what an install would. A signature that does not check out (the digest, the
signature, the certificate, the log entry, or a claim that disagrees with the
certificate) is always refused, never treated as unsigned. One whose signature
could not be checked at all, because Sigstore's trusted root could not be
fetched and none was cached, is `unchecked` (story 244): refused too, under
every policy, and shown as *Couldn't be checked right now*, since trying again
later may succeed.

| Setting | |
| --- | --- |
| `CROMBOLO_BUNDLE_SIGNATURES` | `optional` (the default) or `required`: refuse an unsigned bundle |
| `CROMBOLO_BUNDLE_SOURCES` | where a signed bundle must come from, comma separated: `org/*`, `org/repo`, or `org/repo@v*` for its tags |

### Site bundles: trusted signers

Story 316. A site bundle carries a site's content and code, so a site applies
one only from a signer it trusts. Extensions keep the rules above.

- **Keys.** Ed25519. A public key is one line, `crombolo-ed25519 <key> <name>`,
  known by its fingerprint, `SHA256:…` (`server/src/signing-keys.ts`):
  - **a user key** is a person's, made on their machine with
    `crombolo keys create <name>`, kept in their config directory, and listed by
    `crombolo keys list`. A CI job keeps one as a secret;
  - **a site key** is a site's own, made the first time it signs, its private
    half kept in the site's database, sealed with `CROMBOLO_SECRET_KEY`.
    `crombolo site key` prints its public line.
- **Signing.** Every site package a site makes is signed with its key: `site
  export` and the bundle `pull` brings, `content export`, `site build`, `site
  deploy`, and the Bundle Editor's site bundles. `site build --sign-with <key>`
  and `site deploy --sign-with <key>` sign with a user key instead. The signature
  is over the package digest above, its name and its version, in
  `provenance.json` as `key`, beside a Sigstore signature when both are made.
- **Trusted signers** (Settings → Trusted signers, administrators only): this
  site's own key, always trusted; the config's `trustedKeys` and
  `trustedSources`, and `CROMBOLO_BUNDLE_SOURCES`, locked; then what an
  administrator added, renamed or removed, each audited. An entry is a user
  key, a site key or a CI build (`org/repo@v*`, signed by Sigstore).
  `crombolo keys trust`, `keys untrust` and `keys trusted` do the same from the
  CLI (`server/src/trusted-signers-admin.ts`; migration 069).
- **Applying one** (`server/src/site-trust.ts`), wherever a site bundle is
  applied: `site apply`, `push`, `pull`, `site deploy`, a remote's apply and
  `start --bundle`:
  - a signature that does not check out is refused, always;
  - in production, one no trusted signer signed is refused; elsewhere it is
    applied, with a warning;
  - an older version than this site applied from the same signer is refused,
    naming both, unless `--allow-downgrade`, which the audit log records. Each
    run records its signer (`content_transfer_run.signed_by`).

**Ours are signed.** Every release signs, from its tag:
- `@crombolo/simple-redirects` and `@crombolo/entra`, after packing and before
  `npm publish` (`scripts/publish-packages.ts`);
- each distributed demo site, built as a bundle and attached to the GitHub
  release as `<id>-<version>.tgz`, such as `demo-harbourstone-0.45.0.tgz`
  (`scripts/release-demo-bundles.ts`);
- the product site's bundle, signed in a copy before it is sent to the platform.

The release then fetches each one back and checks it
(`scripts/release-verify-signatures.ts`), so a bundle that shipped unsigned
fails the release. A site that takes only our bundles sets
`CROMBOLO_BUNDLE_SOURCES=kineco-au/crombolo-cms@v*`.

## Installing one

A bundle's content installs through the bundle's own commands — there is no
second importer:

```
crombolo site apply <pkg> --dry-run   # read-only: what it would do here
crombolo site apply <pkg>             # apply it
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

`site apply` is the one command for a bundle's content, whether it came from
another environment, the registry or this site's own content files (story 167).
A bundle applies whatever it carries by default — that is the point of carrying
it — with `--no-schema` and `--no-files` to decline a half.

### The order is forced, and so is where the check happens

Content naming a type the bundle brings cannot pass a check until that type
exists. So the structure has to land before the content is checked — which means
a blocking schema change has to be caught **before the first file is written**,
or a refused install leaves a half-applied site behind.

That is why the check runs against an **overlay**: a copy of the site's
`schema/` with the bundle's files laid over it. The site's own directory is not
touched until it is known the schema can apply. An install whose schema would
need data work is refused with nothing written.

A check only reads (story `300`). The value migrations a bundle carries,
`schema/migrations/*.ts`, are modules, and importing one runs it, so the overlay
check loads the **site's own** migrations and never the bundle's. The report
lists each carried migration by name as running at install, and a change one of
them would have covered is still reported as needing data work, naming it.

Those migrations are **code**, held to the same rule as a bundle's `code/`: an
install that would add or change one is refused unless the site installs code
while it runs (`runtimeInstalls`) and whoever installs asked for code (over the
remote API, `Crombolo.Remote.InstallCode`). `site apply --local`, the site's own
content files built here, is unaffected.

**Templates are code too** (story `336`): the server imports and runs each one.
An install that would add or change one, in `components/`, is held to the same
rule:
- the site must install code while it runs;
- whoever installs must be allowed to install code. Over the remote API that is
  `Crombolo.Remote.InstallCode`; in the Transfer dashboard it is "Install code on
  this site" from a group. `crombolo bundle install` always installs code.

Templates the bundle carries unchanged, `--no-files`, and the site's own content
files are unaffected. Stylesheets and scripts are not code: they install under
ApplyStructure as before. Where installs are off, a bundle's code, migrations and
templates are all refused with one message: installing code while the site runs
is turned off on this site.

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

The content half is a transfer run, so `site revert <run>` takes it back as
any import. The files are not in that ledger — but they are not left to git
either. The swap keeps what each staged folder replaced under
`.crombolo/transfer/<runId>/previous/<section>`, with `swap.json` naming the
sections, and the dictionary as it was in `dictionary-before.udt`. `bundle
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

## Content files

A site's content files are its starting content kept in the repository
(story 163): its pages, its Library elements and its media, written by a
person, built into a bundle and applied through the import. A clone and one
command give a populated site, and content that belongs with the code (legal
pages, a docs section, fixtures) is reviewed and versioned with it.

The back office stays where content is edited. Content files are how content
is declared.

### Layout

```
content/
├── pages/
│   ├── home.toml          # a page; its URL segment is the file name
│   └── home/              # the pages under it
│       ├── about.toml
│       └── contact.toml
├── library/
│   └── hero-card.toml     # a Library element (at the top level only, for now)
├── media/
│   └── logos/             # a media folder
│       ├── mark.png       # a media item, typed by its extension
│       └── mark.png.toml  # its sidecar, optional
└── dictionary.toml        # the dictionary, optional
```

A site that still has the old `seed/` folder is refused, with the commands
that move it: `git mv seed content && git mv content/content content/pages`
(story 167).

### An item

```toml
type = "page"            # the content type alias; required
name = "Home"            # or { "en-US" = "Home", "fr-FR" = "Accueil" }; default: from the file name
key = "…"                # optional: otherwise derived from the path
order = 1                # optional: siblings sort by order, then name
template = "page"        # optional: default, the type's own
published = false        # optional: everything else is published by `site apply --publish`

[values]
title = "Welcome"

[values.fr-FR]           # values for one culture
title = "Bienvenue"
```

**Keys.** An item's key is a version 5 uuid of its kind and path
(`content/home/about`) under Crombolo's own namespace
(`packages/server/src/seed/keys.ts`). A rebuild therefore names the same
nodes, and two sites built from the same files share keys, which is what lets
pulls and pushes match them. Renaming a file makes a new page. `site apply`
says so, and stops, when a page of that name is already there under another
key, and `key = "…"` keeps the old one.

### Values

Values are given by property alias, in a shorthand for each editor:

| Editor | Shorthand | Stored as |
| --- | --- | --- |
| Text box, text area | a string | the string |
| Rich text | Markdown, or `{ html = "…" }` | `{ markup, blocks: null }`; Markdown's links to content paths become local links, and HTML is taken exactly as written |
| Content picker | a content path, `/home/about` | `umb://document/<key>` |
| Media picker | a media path, or a list of them | the picker's items, with each item's type |
| Element picker | a Library path, or a list | the element keys |
| Form picker | a Library form's path, `forms/contact-sales`, or a form's alias | the Library form's key, or the form's |
| Multi-URL picker | paths, URLs, or `{ path \| url, name, target }` | the links |
| Block list and block grid | `[{ type = "<element alias>", key = "…", values = {…}, settings = { type, key, values } }]` (grid: `columns`, `rows`, and `areas = [{ key = "<area key>", blocks = [ … ] }]`, its blocks written the same way) | layout, content data and settings data; a block's key is derived unless it gives one |
| Single block | one `{ type = "<element alias>", key = "…", values = {…}, settings = {…} }`, as a table rather than a list; more than one is refused (story 345) | the same, with one layout entry |
| Tags | a list of strings | the list |
| Date | a TOML date, or an ISO 8601 string | a date picker's `YYYY-MM-DD HH:mm:ss`, as a save stores it; with a time zone, the ISO 8601 string |
| Toggle | `true` or `false` | the boolean |
| Number | a number | the number |

- **A path** names an item in the files by its path (`/home/about`), or a page
  already on the site by its names. A uuid is taken as it is.
- **Any other editor** takes its value in the editor's stored shape, as does
  any value given as a table that is not one of the shorthands.
  `content export` writes that shape.

### Media

**The Library** is `content/library/`, where a folder is a Library folder, nested as deep as the
Library's (story 242), and its elements are the files in it. A folder's name comes from its
directory; `.folder.toml` in it gives a `name` or `key` the directory can't, and `content
export` writes one only then.

`content/dictionary.toml` holds the dictionary, in the format of
`docs/content-transfer.md`, "The dictionary as a file". It travels as the
bundle's `dictionary.udt` and applies by key, so an item a site already made in
the back office under the same name is left as it is. A language the site has
not got, or a value that is neither a translation nor a table, is a finding.

A file under `content/media/` becomes a media item:
- **Type:** the type its extension implies, as an upload's is.
- **Folders:** a directory becomes a Folder.
- **Sidecar:** `photo.jpg.toml` gives `name`, `type`, `key`, `order`,
  `focalPoint = { left, top }` and `[values]`, which is where an image's
  `altText` goes.
- **On a site never started:** an image in a folder applies from the first
  command, since opening the database lets Folder hold the built-in media
  types (story 180).
- **The bytes** travel in the bundle. The file is stored as an import stores
  it, at `/media/<the first 8 hex of its key>/<file>`, with its width, height,
  size and extension.

### Commands

| Command | Does |
| --- | --- |
| `crombolo site build --check` | builds the site's bundle and writes nothing; exits 20 with each finding as `file:line  message` |
| `crombolo site build [<dir>] [--template <id>] --out <dir>` | a bundle of a site directory: its schema, views, styles and content files, built with no database of its own (story 164) |
| `crombolo site apply [--publish] [--resolve …] [--dry-run]` | with no argument, or `.`, builds this site's content files and imports them; `--dry-run` is the import's check |
| `crombolo content export --root <page>… \| --source --all` | writes content files from a site: the pages named, or with `--all` every page, Library element and media item with its file, in shorthand where `site apply` reads it back (story 164) |
| `crombolo start --bundle .` | applies this site's content files before the site serves, once for each change to them |

- **What `site build --check` finds:** an unknown type or property, a value
  its editor cannot take, a path that names nothing, a language the site has
  not got, a type its parent does not allow, an element in the content tree or
  a page in the Library, a duplicate key, and a TOML syntax error.
- **Where it reads from:** `site build --check` makes a throwaway database
  from the directory's own schema, so it needs no site, in CI or anywhere
  else. `site apply` builds the files against this site's database, so a
  path there may name a page only this site has, and a renamed page is found;
  any finding stops it before anything is written.
- **Lines:** `Bun.TOML` gives no positions, so a finding's line comes from
  reading the file's tables and keys (`seed/lines.ts`).
- **A syntax error** is placed by parsing ever longer prefixes of the file.

### Applying, and applying again

`site apply` with this site's own files builds them and imports the result
as it would any bundle, content only: it backs up, checks, applies in one
transaction and records a run that `site revert` undoes.

**Applying again is three-way.** The import records what it applied to each
node (`content_applied`, `content-transfer.md`, "The import"). On the next
apply:

| Since the last apply | Result |
| --- | --- |
| changed only in the files | taken |
| changed only in the back office | kept, and reported |
| changed in both | a conflict for a person, answered with `--resolve` |
| nothing | nothing written, no new version |

Names, order and place follow the same rule.

**Identity.** The built bundle's id is derived from its content. That is how
`start --bundle .` applies it once for each change: a standing run for that id
means the site already has this version.

### A site in three commands

`crombolo site build` turns a site directory into one bundle, carrying its
schema, components, styles and content files. `crombolo start --bundle`
installs that into a bare site: the files are staged, the schema synced and the
content imported in one transaction, and the server boots again to load the
views. The demo sites start that way (story 164):

```bash
crombolo init --name "Harbourstone"
crombolo site build sites/harbourstone --out ./harbourstone-bundle   # or --template demo/harbourstone
crombolo start --bundle ./harbourstone-bundle --publish
```

A bundle's id is its content's, so a changed site re-applies on the next
`start --bundle`, three ways, and an unchanged one does nothing.

**In production**, a bare site's schema (`1.0.0`) changing to the demo's
without a version bump is refused, as any such schema change is across nodes.
Try a demo in development, or bump the version.

### Where the code is

| Code | What it does |
| --- | --- |
| `packages/server/src/seed/read.ts` | walks `content/` |
| `packages/server/src/seed/compile.ts` | checks the items and builds the bundle |
| `packages/server/src/seed/export.ts` | writes content files from a site |
| `packages/server/src/bundle-build.ts` | a bundle from a site directory |
| `packages/cli/src/commands/bundle/` | the commands: `build`, `apply`, `export` |

The compiler is in the server rather than `@crombolo/transfer`. It reads the
site's database, uses the media port's rule for which type takes a file, and
writes through the transfer package's pure writer (`writeBundle`).

### Not yet

- **Library folders:** Library elements sit at the top of `content/library`,
  and folders under it are reported, not read.
- **Segments:** segment variants of a value are given in the stored shape
  only.
- **Out of scope** (story 163): public access, users and members, and content
  templates.

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
| The marketplace and install | `server/src/marketplace.ts`, routed at `<backoffice>/crombolo/api/extensions/*` (`api/bundles/*` still answers) |
| The two native views | `backoffice-host/plugin/bundles-marketplace.js`, `bundles-installed.js` |
| The App_Plugins notice | `server/src/extensions-notice.ts` |
| Server-side bundles | `server/src/bundles.ts`, wired in `server.ts`, `bundles` in `config.ts`, matched to their packages at boot |
| The redirects bundle | `packages/simple-redirects` — `src/server/index.ts`, its screen described there (story 329) |

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

A server bundle is written against `@crombolo/extension`, the extension SDK, or
`@crombolo/crombolo/bundle`, which the CMS points at the same SDK when it builds
it ([`api.md`](api.md)). It peers on `@crombolo/crombolo`. Nothing in
`@crombolo/server` is a bundle's to import. It runs in a Deno process of its
own (story 311, [`extensions.md`](extensions.md)).

Part 2 said a bundle that needs to run in the server process is "a dependency
plus a deploy" and left it there. This is that, made into something a bundle can
be written against: `bundles.ts` in `packages/server`, and
`@crombolo/simple-redirects` as the first one.

## Extensions run once granted

Story 310. An installed extension's server half runs once it is granted what it
asks for, with nothing imported by the site. Until then, the import in
`crombolo.config.ts` was the gate; now the grant is (story 309).

- **At boot**, each dependency that declares a `server` half is built from the
  entry its package exports and started in a Deno process of its own, by the
  factory `crombolo.server` names, given its settings
  ([`extensions.md`](extensions.md)). That happens only where it is granted:
  - **by the site's code:** the config's `extensions` entry names, exactly, what
    it grants. That grant is "Developer installed", recorded and audited at boot;
  - **or by a grant recorded here:** the Marketplace's install panel, Installed's
    **Grant** button, `crombolo extension grant`, or a remote.

  Nothing of an extension that is not granted is built, let alone run. One that
  cannot start is left off, saying why in Installed, and the site starts.

```ts
export default defineConfig({
  extensions: {
    redirects: {
      grant: ['backoffice.code', 'redirects.read', 'redirects.write', 'content.read'],
      settings: { section: 'content' },
    },
  },
})
```

- **A version that asks for more** than the entry names is off until the entry
  names it too, or an administrator grants it. So a dependency bumped in `bun.lock`
  cannot widen what it may do unnoticed. `origins` are named beside `grant` when
  it asks for them. `user.delegate` is never granted from the config: it needs a
  person who granted it, and the boot stops naming who may (story 325).
- **An entry for an extension the site does not depend on** stops the boot,
  naming it.
- **Settings:** the manifest's `crombolo.settings` declares each setting, with a
  key, a label, a type (`text`, `number`, `boolean`, or `choice` with its `values`),
  a `default`, and `secret` for one kept sealed.
  - The config's `settings` lock a value.
  - Installed shows the rest, to edit, kept in `extension_setting` (migration 067).
    `crombolo extension settings <name> [key=value …]` does the same from the CLI.
  - An extension reads its settings when it starts, so a change takes effect at the
    next restart.
- **The old way:** a site that still imports an extension and lists it in `bundles`
  starts, warning that the import runs it inside the site, unconfined: importing a
  module runs it, so it is the site's own code. Its wiring grants what it asks
  for, as before. `extension install --wire` is gone.
- **Remotes:** a grant made on a remote, by someone holding "Install code on this
  site", turns the extension on there at its next restart.

The tests are `tests/extension-discovery.test.ts`, and `tests/server-bundles.test.ts`
for what a host passes in `bundles`.

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
that has it can mint tokens the others accept. The back office's content
security policy lets its screens reach the host's origin for these calls
(story 318).

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

### The layout

Story 320. An extension with code keeps each half in a folder of its own, and the
CMS holds it to that:

```
@acme/seo-tools/
├── package.json             crombolo.extensions, crombolo.server, exports
└── src/
    ├── server/              the server half: its entry, its components (312)
    │   └── index.ts
    └── backoffice/          its back-office code: what the manifest's entries name
        └── seo-dashboard.ts
```

- **`crombolo.schemaVersion: 5`.** An extension at 4 or before is refused at
  discovery, install and `extension check`, saying to run `crombolo extension
  migrate <dir>`.
- **The server half** is the entry its package exports, under `src/server/`. Its
  process reads `src/server/` and its build, and nothing else of the package.
- **Back-office code:**
  - every `element`, `js`, `api` and `loader` its manifest names, and every import
    map target, is a `.ts` or `.js` file under `src/backoffice/`;
  - absolute paths and URLs are refused;
  - an entry that names none, such as a menu item that is a label and an icon, runs
    no code.
- **Neither half imports the other's folder.** The build refuses it, naming the file.
- **`plugin/`, and any other folder under `src/`, is refused,** naming the folder.
- **The build:** granted back-office code is built with `Bun.build` when first
  asked for, and again when its files change:
  - one output per module the manifest names, into
    `.crombolo/extensions/<id>/backoffice/`;
  - TypeScript compiled, and its own imports and npm packages bundled;
  - `@umbraco-cms/*` left as imports, for the back office's import map.

  `/bundles/<package>/<path>` serves only that build, so `src/server/`,
  `package.json` and the rest of the package are never served. One that cannot be
  built is left out of the back office, saying why in Installed.

### Moving an extension to the layout

`crombolo extension migrate <dir> --reason "<why its screens need it>"` rewrites a
schema 4 package in place, and `--dry-run` says what it would do:

- **The server half:** its exported entry, the files it imports and the rest of
  `src/` move under `src/server/`.
- **The back-office half:** `plugin/`, each module the manifest names and what it
  imports move under `src/backoffice/`.
- **Imports and the manifest:** a relative import that crosses out of a moved folder
  is rewritten, and so are the manifest, `exports`, `main` and `files`.
- **The permission:** with back-office code, it asks for `backoffice.code` with the
  reason given, and never writes a placeholder.
- **What it refuses:** a file both halves import, or a schema 3 package, is named,
  and nothing moves.
- **Signatures:** `provenance.json` is removed, since moving files changes the
  digest. Sign it again before publishing.

### Permissions

Stories 222 and 308. An extension's package says what it may do with the site,
each permission with the reason it needs it, and it is held to that.

```json
"crombolo": {
  "bundleType": "extension",
  "id": "redirects",
  "server": "redirects",
  "schemaVersion": 5,
  "permissions": {
    "backoffice.code": "Shows the redirects screen in Settings",
    "redirects.read": "Lists the redirect rules on the Redirects screen",
    "redirects.write": "Saves the rules you add, change and remove there",
    "content.read": "Shows the address of the page each rule sends people to",
    "http.outbound": { "reason": "Checks each target answers", "origins": ["https://api.acme.com"] }
  }
}
```

- **A reason for each, shown beside its sentence:** 1 to 200 characters. A
  missing reason, an unknown permission, `users.write` and an origin that is not
  `https://host[:port]` (`http://localhost` on a development site) are refused,
  each by name.
- **The catalogue** (`BUNDLE_PERMISSIONS` in `@crombolo/backoffice-host`): every area
  asks to read and to write apart.

| Area | Read | Write |
| --- | --- | --- |
| Pages | `content.read` | `content.write` |
| Media | `media.read` | `media.write` |
| Members | `members.read` | `members.write` |
| Back-office users | `users.read` | never offered |
| Forms | `forms.read` | `forms.write` |
| Form entries | `formEntries.read` | `formEntries.write` |
| Dictionary | `dictionary.read` | `dictionary.write` |
| Content, media and member types, data types | `contentTypes.read` | `contentTypes.write` |
| Webhooks | `webhooks.read` | `webhooks.write` |
| Approval workflows | `workflows.read` | `workflows.write` |
| Redirects | `redirects.read` | `redirects.write` |
| Sign-in providers | `identityProviders.read` | `identityProviders.write` |

  Besides the areas:
  - `member.delegate` acts for the member calling a site route;
  - `user.delegate` acts for the person using it in the back office, across every
    area, from story 325: see "Acting for the person" below;
  - `events.content` is called for content events;
  - `http.outbound` sends to the origins it names;
  - `routes.public` answers routes anyone may call;
  - `templates` renders components into pages, from story 312;
  - `data.tables` keeps its own tables in the site's database, from story 321:
    see Part 4;
  - `backoffice.code` runs its back-office code, from story 320: see "Back-office
    code" below.

- **Levels** (story 324). The install panel, Installed and the command line say how
  far an extension reaches before anything else, as one of three levels computed from
  what it asks for, never declared:

  | Level | What puts it there | Who grants it |
  |---|---|---|
  | **Limited** | anything else | an administrator |
  | **Acts as you** | `user.delegate` | an administrator, for a package someone vouched for |
  | **Unrestricted** | `backoffice.code` | an administrator, for a package someone vouched for, unless the host keeps it to the config |

  - **Four groups** fold the catalogue: Sees, Changes, Sends to and Adds, with Acts as
    when it asks to (`groupsOf`). "Show each permission and why it asks" opens the list
    with each reason and origin.
  - **Vouched for** means one of three things (story 335):
    - signed by a signer this site trusts. That is a key, or a build from a GitHub
      repository, on Settings → Trusted signers: this site's own key, keys and sources
      in the config, and those added there. It is the same list site bundles are
      checked against;
    - vouched for by the host;
    - built on this machine (a linked or workspace package).

    A signature from anyone else, key or Sigstore build, only labels the extension. The
    panel and `bundle verify` say whether this site trusts its signer, and a refusal
    names the signer and says to add it in Trusted signers. An unsigned Limited
    extension installs, and the panel says "Nobody has vouched for who built this" in
    place of its build line.
  - **Checked at every start, and as a signer is removed.** Before extensions run, an
    Acts as you or Unrestricted grant recorded here that nobody this site trusts vouches
    for is withdrawn, audited and logged. It then needs granting again, under the same
    rule. That covers an upgrade from before 335. Taking a signer off Trusted signers,
    in Settings or with `crombolo keys untrust`, runs the same check at once, so what it
    vouched for stops then, not at the next start, and the answer names each extension
    switched off. A grant the site's
    code makes is the developer's, and kept. A signature that can't be checked at the
    time, offline say, is left alone.
  - **`bundle sign --key <name>`** signs a package directory or `.tgz` with one of your
    keys (`crombolo keys`), for a site that trusts that key.
  - **Administrators only:** installing, removing and granting an extension are an
    administrator's in the back office, at every level. Disabling and enabling stay
    open to Settings access. A remote reaches them with "Install code on this site".
  - **One refusal** (`grantRefusal`, `grant-policy.ts`) answers the panel, the API, the
    command line and a remote, with the panel's words. The grant is audited with its
    level: "granted Unrestricted: backoffice.code".
  - **`CROMBOLO_UNRESTRICTED_EXTENSIONS=config`** keeps Unrestricted to the site's config:
    the panel shows the `extensions` entry to add in place of the button, and every other
    way of granting it is refused. It is an environment setting because a commit that
    grants an extension should not also be able to lift the rule.
  - **Never offered:** `users.write`, `extensions.install` and `extensions.grant`, each
    refused by name.
  - **Installed** shows each row's level; a version asking for more is "Off · asks for
    more", and its detail names the level it moved to.

- **Back-office code** (story 320). Any back-office code needs `backoffice.code`:
  - Its screens run in the back office's page as whoever is signed in, with
    everything that person can do on the site. Unlike the server half, nothing
    keeps them apart from it: the grant makes the authority visible, and does not
    take it away.
  - **Required both ways:** an extension with back-office code that does not ask
    for it is refused, and so is one that asks for it with none.
  - **Granted, never implied:** until it is granted, none of its back-office code is
    built, served or in the back office's manifest.
  - **Said wherever it is asked for:** in the Marketplace's install panel and
    Installed, first and apart, as a warning (`BACKOFFICE_CODE_WARNING`). The warning
    names the publisher and what its signature shows, and its own box must be ticked:
    "I trust <publisher> to act as anyone signed in to this back office".
    - `extension install` and `extension grant` print it, and at a terminal ask
      y/N. From a script, `--grant backoffice.code` is the answer.
    - The boot logs it for each extension the config grants it.
    - A remote's grant check names it.
- **The areas through `api`:** one capability calls the Management API, and the
  CMS's own back-office API, in this process:
  `bundle.api.get('management/api/v1/document/<key>')`, `post`, `put`, `delete`.
  - Each permission reaches a set of paths and methods (`API_PERMISSIONS` in
    `server/src/bundle-api.ts`). A call no granted permission covers throws
    `ApiRefusedError` before it is made, naming what would have covered it.
  - The API's own validation, permissions, approval workflows and audit then
    apply. A typed SDK over it is story 315.
- **Least privilege:** acting as itself, an extension's principal holds only what
  its grant gives: the sections, document and media verbs on the whole tree, and
  languages, that its paths need. It is never an administrator, so its publishes
  meet the approval workflows, and the audit names it "Extension <name>".
  - **Acting for the person (story 325).** Under `user.delegate` it acts for whoever
    uses it in the back office: through `api` as their own principal, so the API holds
    it to their rights, and through the other capabilities with the areas of the
    sections they hold. A job or an event acts for whoever granted it, through `api`
    alone; a visitor on a public route borrows nobody. It may never install or grant
    extensions, reach the site as a remote, or change users and groups, for anyone,
    administrators included. Asking for it beside an area permission is refused, since
    it already reaches them. What it writes is in the audit log as the person, with the
    detail "<Extension>, for <person>". `actAs` is retired: a manifest asking for it is
    refused by name, and `extension migrate` rewrites it to `user.delegate`.
- **Requests out:** `fetch`, as a capability, and an event handler's `fetch`,
  reach only the origins `http.outbound` names, by the address rule of story 301.
- **At boot:**
  - each capability needs one of its permissions (`media` also `member.delegate`);
  - each permission must be used;
  - event handlers need `events.content`, and site routes `routes.public`;
  - tables need `data.tables`, and `data.tables` needs tables.
- **Schema 3,** names without reasons, is still read for an extension already
  installed: `documents.read` is read as `content.read`. A new install, or an
  upgrade, to a schema 3 version is refused, saying why.
- **The install** shows every permission with its reason and the origins. Granting
  is the whole list, exactly: in the panel, in `extension install --grant …`, and
  over a remote; `user.delegate` records who granted it, which a script without a
  person names with `--delegate-to <user key>`.
  There is no separate question about server code.
- **A grant is what lets it run (story 309).** An extension runs, its screens,
  files, routes, events and jobs alike, while its grant covers everything its
  installed version asks for: each permission, each `http.outbound` origin, and
  for `user.delegate` who granted it.
  - **States:** Installed shows one of four:
    - **on**;
    - **turned off** by an administrator;
    - **waiting for a grant**: its version asks for more, and the view names what;
    - **not granted**: never granted.
  - **Fewer permissions:** a version that asks for less stays on, its grant
    narrowed at the next boot and audited.
  - **Every call** to a capability is held to what was granted, not to what the
    manifest declares, and a call made as a member needs `member.delegate`.
- **Who grants:**
  - **The site's code:** wiring an extension in `crombolo.config.ts` grants what its
    installed version asks for at each boot of a node that writes. It is recorded in
    `bundle_grant` as the site's code, shown as **Developer installed**, and audited
    when it changes.
  - **An administrator:** the Marketplace's install panel, or **Grant** in
    Installed for one installed by a deploy or waiting after an upgrade.
  - **The CLI:** `crombolo extension grant <name> --grant … [--delegate-to <user key>]`.
  - **A remote:** someone holding "Install code on this site" (`bundle-manage`'s
    `installed/<name>/grant`).
  - **Exactly:** a grant is exactly what is asked for, or it is refused, saying
    what differs.
  - **No grant, no run:** an extension installed before 0.57 and not wired has no
    grant, and is off until granted.
- **Disabled by an administrator.** **Disable** on its card turns a bundle off,
  and **Enable** turns it on again, for anyone with Settings,
  audited (`Disable` or `Enable`). A disabled bundle is still mounted: its
  routes answer 503 saying it was disabled, its events are not delivered, its
  jobs wait, its screens are left out of the back office, the boot log names
  it, and `crombolo start` lists it. It stays disabled through new versions,
  one asking for more included, until it is enabled again (migration 056 keeps
  who disabled it and when).
- **Per environment.** Approvals and disabling are rows in each environment's
  own database, and do not travel in an export or a pull.

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
  public route. Powers a public route lacks come from the permissions it
  declares ([Permissions](#permissions)), checked in a job as in a route.
  Nothing acts as the site.
- **A disabled bundle** keeps its jobs waiting, and queues none of its
  schedules, until it is enabled again.

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

On the Settings landing page (story 234) each bundle's Settings dashboards and
Advanced menu items are cards in a group of their own, headed by the bundle's
`name`, after the built-in groups. Beside the name, a link with the package's
name opens the extension in the Extensions tool's Installed tab
(`section/settings/dashboard/extensions/installed?extension=<package>`), so an administrator can
see where the cards come from. A card is named by `meta.label` and described
by `meta.description`. The server stamps each extension it serves with
`cromboloBundle: { name, packageName }`, which is how the page knows.

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
moves with it — see `src/backoffice/redirects-client.js`.

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

- **The `crombolo-extension` keyword.** npm indexes keywords and not custom fields
  (Part 2), so an extension without it is invisible in the Marketplace however
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

The bundle hands it to its `ServerBundle` as `tables`. There is no capability
to ask for, and asking for the old `tables` capability refuses the boot. From
schema 4 the package asks for `data.tables` in `crombolo.permissions` (story 321),
so a host can tell before installing it that it needs a role and schema of its
own:

```json
"permissions": { "data.tables": "Keeps the task list" }
``` A step's `up` returns the builder's
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
- **An extension holds no connection at all** (story 311). Its Kysely sends each
  query to the CMS, which compiles it on the owner's handle and runs it only if it
  is one statement that reads or writes rows: no `ATTACH`, `PRAGMA`, role change,
  `set_config` or second statement ([`extensions.md`](extensions.md), "Its own
  tables").

`tests/custom-tables.test.ts` proves it on both engines by trying: a handle
naming a crombolo table, qualified or not, and another owner's table, fails.
For a bundle the site imports, which runs in the server process, that guards
against mistakes and injected input: deliberately hostile code could issue
`RESET ROLE` or `ATTACH DATABASE` (Bun's SQLite driver cannot forbid attaching).
An extension in its own process cannot: its statements are checked before they
run.

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
crombolo extension purge <id> [--yes] [--backup-taken]
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
- Confining a bundle the site imports. A bundle you import is code you run,
  exactly like any other dependency in the file. An installed extension the CMS
  starts runs in its own process ([`extensions.md`](extensions.md)); what each
  could reach is in [`extension-threat-model.md`](extension-threat-model.md).

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
`bun run build:template` rewrites the lot: the docs pages as content files
under `sites/crombolo/content/pages/home/docs/`, then the site's bundle, and
`tests/docs-site.test.ts` fails when a guide, a command or a setting has changed
without a rebuild.
