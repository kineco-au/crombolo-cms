# 320 — An extension's back-office code is asked for, built and kept apart

**Epic:** I — Hardening · **Priority:** must · **Size:** L
**Depends on:** 311, 308

## Story

As an administrator installing an extension, I want to be told plainly, before I grant
it, that its back-office screens run as each signed-in user with everything that user
can do, so that I grant that knowingly, and an extension that hasn't asked for it runs
no code in my back office.

As someone writing an extension, I want its server code and its back-office code in
folders of their own, in TypeScript if I like, so that each half is built and served
for what it is.

## Context

An extension package today:
- **Server half:** in `src/`, built from the entry its package exports and run in a
  Deno process of its own, holding only what it was granted (311).
- **Screens:** in `plugin/` by convention. They're ES modules named by the manifest's
  `crombolo.extensions` entries (`element`, `js`, `api`), served as shipped at
  `/bundles/<package>/<path>`, and imported into the back office's page.

The screens are not confined. They run in the back office's page, its origin and its
JavaScript realm, so they act with the signed-in user's whole session. The grant
binds the server half and not them. Story 313's content security policy limits where
they can send data, not what they can do on the site. That is T8's open half in
`extension-threat-model.md`, which lists "its own back-office screen" among the things
that need no permission.

Two further gaps:
- **The file server serves any file in the package.** `resolveExtensionFile`
  (`backoffice-host/src/extensions.ts`) serves the server half's source and
  `package.json` as well as the screens.
- **The Deno process may read the whole package directory**
  (`extension-process.ts`), the screens included.

## Decisions (2026-11-10)

- **The layout is `src/server/` and `src/backoffice/`,** and the CMS enforces it.
- **The current layout is refused,** with no transition period. Bundle schema 5
  requires the new layout, and a schema 4 extension is refused by name, saying to move
  its files. Story 222 handled schema 2 the same way.
- **`src/backoffice/` may hold TypeScript.** The CMS builds it, as it builds the server
  half, and serves only what it built.
- **Back-office code is a permission, asked for and granted like any other,** and an
  extension that ships back-office code without asking for it is refused. The
  permission says up front, wherever it is shown, that this code runs as each
  signed-in user and can't be isolated the way the extension's server code is.
- **How screens could be confined later** (server-driven screens, trust tiers) is a
  separate question. This story makes the authority visible and granted; it doesn't
  take it away.
- **Existing bundles are rewritten, not hand-moved.** `crombolo extension migrate`
  rewrites a schema 4 package to schema 5. Its first users are this repository's own
  extensions and fixtures, and the refusal of a schema 4 package names it.
- **The warning names who to trust.** Wherever `backoffice.code` is shown, it says not
  to grant it to an extension from a publisher you don't trust, and names the
  publisher and what its signature shows.

## The design

### The layout

```
@acme/seo-tools/
├── package.json
└── src/
    ├── server/            the server half: its entry, its components (312)
    │   ├── index.ts
    │   └── components/
    └── backoffice/        the back-office code: what the manifest's entries name
        └── seo-dashboard.ts
```

- **`crombolo.schemaVersion: 5`.** A schema 4 package is refused at discovery, install
  and `extension check`, saying what moves where.
- **The server half:**
  - the package's export, which `crombolo.server` names the factory of, sits under
    `src/server/`;
  - the Deno process reads `src/server/` and its build only, not the whole package.
- **The back-office half:**
  - every `element`, `js` and `api` path in `crombolo.extensions` names a source file
    under `src/backoffice/` (`.ts` or `.js`);
  - an entry with none of the three, such as a menu item that is only a label and an
    icon, runs no code and needs nothing here.
- **Neither half imports the other's folder.** A package whose server entry reaches into
  `src/backoffice/`, or whose back-office build reaches into `src/server/`, is refused
  when it is built, naming the import.

### The permission: `backoffice.code`

- **Asked for in the manifest, with a reason,** as every permission is (308):

  ```json
  "permissions": {
    "backoffice.code": "Shows the redirects screen in Settings",
    "redirects.read": "Lists the rules you have added"
  }
  ```

- **Required:**
  - a package with any code under `src/backoffice/`, or any manifest entry naming
    `element`, `js` or `api`, is refused unless it asks for `backoffice.code`;
  - one that asks for it and has no back-office code is refused too, so the
    permission always means something.
- **Granted, never implied:** like every permission, it must be in the grant, whether
  that comes from the config's `extensions` entry, the Marketplace's install panel,
  Installed's Grant, `crombolo extension grant` or a remote. Until it is granted,
  none of the extension's back-office code is built, served or listed in the back
  office's manifest. A grant covers everything a version asks for (309), so its
  server half waits for the same grant.
- **A version that adds back-office code** asks for more, so it is off until granted
  again, as 308 has it.
- **Said plainly wherever it is shown.** The words, kept free of technical terms:
  - **Label:** "Runs in your back office as each person using it"
  - **Explanation:** "Its screens act as whoever is signed in, with everything that
    person can do on this site. Unlike the rest of an extension, this part can't be
    kept apart from the site."
  - **The warning:** "Don't install this from a publisher you don't trust. Published
    by <publisher>." Then what the signature shows, in `signatureWords`' words:
    "Signed: built from github.com/acme/seo-tools at v1.2.0", or "Nobody has signed
    this extension, so who published it can't be checked."
  - **Where the publisher isn't known** (a local package, or a registry that doesn't
    name one), the warning says so: "Who published this isn't known."
- **Where it's shown:**
  - **The Marketplace's install panel:**
    - it is listed first, set apart from the confined permissions, and marked as a
      warning;
    - it has a confirmation of its own, unticked: "I trust <publisher> to act as
      anyone signed in to this back office";
    - Install stays disabled until that is ticked as well as the existing "I trust this
      publisher, and grant what it asks for".
  - **Installed's grant view:** the same warning and the same confirmation.
  - **`crombolo extension install` and `extension grant`:** they print the warning,
    with the publisher and the signature, and ask "Grant back-office code to
    <package>? (y/N)", defaulting to no. Non-interactively, nothing grants it but
    `--grant backoffice.code`, and the warning is printed either way.
  - **The config:** naming it in the `extensions` entry's `grant` is the developer's
    confirmation. The boot logs the warning once for each extension granted it, as
    "Developer installed".
  - **A remote's grant check** names it, with the same warning.
- **The threat model** moves "its own back-office screen" out of what needs no
  permission. T8 records that the code is now asked for, granted and visible, and
  that it stays unconfined once granted.

### Built, and served from the build only

- **At boot and at install**, after the server half, each granted extension's
  back-office entries are built with `Bun.build`:
  - one output per entry the manifest names, into
    `.crombolo/extensions/<id>/backoffice/`;
  - TypeScript compiled, and npm dependencies bundled in;
  - `@umbraco-cms/backoffice/*` and the back office's import map's other names left
    as imports, resolved by the import map as now.
- **A build that fails** leaves the extension's back-office half off, saying why in
  Installed, and the site starts, as a server half that can't start does.
- **Served from the build only.** `/bundles/<package>/<path>` answers only with built
  output, so `src/server/`, `package.json` and the rest of the package are never served.
  The manifest the back office reads names the built files.
- **A rebuild** happens when the package's digest changes, as the server half's does.

### Moving what exists

- **Simple Redirects:** `src/index.ts` moves to `src/server/index.ts`, `plugin/*.js`
  moves to `src/backoffice/`, and it asks for `backoffice.code` with a reason.
- **The Bundle Editor's extensions** (`created-extension.ts`): the entry goes to
  `src/server/index.ts` and components to `src/server/components/`. A built extension
  has no back-office code, so it doesn't ask.
- **The demo sites' and the tests' extension fixtures** move with them.
- **`crombolo extension check`** reports each of the refusals above.

### Rewriting bundles to the new format

`crombolo extension migrate <dir>` rewrites a schema 4 extension package to schema 5
in place, and says what it did:

- **The server half:**
  - the package's exported entry and the files it imports (as `Bun.build` resolves
    them), and `src/components/`, move under `src/server/`;
  - `exports`, `crombolo.server`'s module and `files` follow.
- **The back-office half:** each file a manifest entry names in `element`, `js` or
  `api`, the files those import, and anything else in `plugin/`, move under
  `src/backoffice/`, keeping their paths relative to one another. The entries' paths
  are rewritten.
- **The permission:** with back-office code, it adds `backoffice.code`. A reason is
  required (308), so it takes `--reason "<why>"`, or asks for one. It never writes a
  placeholder.
- **What it can't decide, it refuses:** a file both halves import, or one imported
  from outside the package's own folders, is named, and nothing is moved. The author
  splits it and runs `migrate` again.
- **`crombolo.schemaVersion`** becomes 5, and the result is checked as
  `extension check` would.
- **Signatures:** moving files changes the package digest, so an existing
  `provenance.json` is removed, saying the package must be signed again
  (`crombolo bundle sign`) before it is published.
- **`--dry-run`** prints the moves and the manifest changes without writing anything.
- **The refusal names it:** a schema 4 package is refused with "this extension uses the
  layout before 0.59.0: run `crombolo extension migrate <dir>`, then publish it again".

In this repository, `migrate` does the moving, and its output is committed:

| Package | Back-office code | Reason it gives |
|---|---|---|
| `packages/simple-redirects` | `plugin/redirects-workspace.js`, `redirects-client.js` | "Shows the redirects screen in Settings" |
| `packages/entra` | `plugin/entra-workspace.js` | "Shows the Microsoft Entra sign-in settings screen" |

- **The Bundle Editor's extensions** (`created-extension.ts`) are written in the new
  layout, with no back-office code, so they don't ask.
- **The test fixtures:** `tests/support/bundles.ts` writes schema 5 packages in the new
  layout, and the tests that write their own follow:
  - `extension-grants`, `bundle-manage`, `marketplace`, `extension-permissions`;
  - `bundles`, `extension-discovery`, `server-bundles`;
  - the browser suite's `serve.ts`.

  A schema 4 fixture is kept in `extension-migrate.test.ts`, as input to `migrate`.

### Docs

- `bundles.md`: the layout, `backoffice.code`, and "where each part lands".
- `extensions.md`: what runs where.
- `extension-threat-model.md`: T8 and the permissions list.
- The release notes: the layout and schema 5. The upgrade notes say a schema 4
  extension is refused until its author runs `crombolo extension migrate` and
  publishes it again; until then a site keeps the version it has by not upgrading
  the CMS.
- `docs/cli/` regenerated for `extension migrate`.

## Plan

1. **The format** (`backoffice-host/src/bundle-package.ts`):
   - `BUNDLE_SCHEMA_VERSION` and `OLDEST_BUNDLE_SCHEMA_VERSION` become 5;
   - the layout rules, `backoffice.code` in the permission catalogue, and the refusals
     in both directions;
   - unit tests for each refusal.
2. **`extension migrate`** (`cli/src/commands/extension/migrate.ts`, with the moving
   in a pure planner the command applies):
   - tests over schema 4 fixtures: only a server half, only screens, both, a shared
     file refused, a signed package, and `--dry-run`.
3. **Rewrite this repository's bundles with it:** Simple Redirects, Entra, the Bundle
   Editor's output, the fixtures and the browser suite. Then `bun run check` and the
   SQLite suite.
4. **The back-office build** (`server/src/extension-backoffice.ts`, beside
   `extension-process.ts`'s server build):
   - `Bun.build` per entry, the import map's names left external, built into
     `.crombolo/extensions/<id>/backoffice/` and rebuilt when the digest changes;
   - `collectManifests` names the built files.
5. **Serving and reading:**
   - `resolveExtensionFile` serves only the build, for granted extensions;
   - the Deno process's `--allow-read` narrows to `src/server/` and its build.
6. **The grant:** `backoffice.code` gates the build, the serving and the manifest, and
   a version adding back-office code is off until granted again.
7. **The warning:**
   - the install panel and Installed, with the publisher, the signature and the second
     confirmation;
   - the CLI's prompt and `--grant`;
   - the boot's log line, and the remote's grant check.
8. **Docs and the threat model,** the release notes, and `bun run cli:spec`.
9. **Tests:**
   - unit tests for each criterion;
   - a browser test: the install panel's warning, Install disabled until both
     confirmations are ticked, and the extension's screen appearing only once granted;
   - the full SQLite suite, and the integration suite for the CLI.


## Acceptance criteria

- [x] A schema 5 extension with `src/server/` and `src/backoffice/` installs, its
      server half runs in its Deno process, and its screens appear in the back office.
- [x] A schema 4 extension, or one with files outside the layout's places, is refused
      by name at discovery, install and `extension check`, saying what moves where.
- [x] An extension with back-office code that doesn't ask for `backoffice.code` is
      refused, and so is one that asks for it with no back-office code.
- [x] Until `backoffice.code` is granted, none of the extension's back-office code is
      built, served or in the back office's manifest.
- [x] The install panel, Installed, `extension install` and `extension grant` show
      `backoffice.code` first, in the agreed words, as a warning, and the CLI asks for
      it to be confirmed.
- [x] `src/backoffice/` may be TypeScript and import npm packages; the served files
      are the build, and nothing else in the package is served.
- [x] The Deno process can't read `src/backoffice/`.
- [x] A server half importing `src/backoffice/`, or back-office code importing
      `src/server/`, is refused when built.
- [x] `crombolo extension migrate` rewrites a schema 4 package to schema 5: it moves
      each half, rewrites the manifest, adds `backoffice.code` with a given reason,
      refuses a file both halves use, drops a stale signature, and offers `--dry-run`.
- [x] Simple Redirects and Entra are rewritten by `migrate` and ask for
      `backoffice.code`; the Bundle Editor's extensions and every fixture use the new
      layout.
- [x] Wherever `backoffice.code` is shown, a warning says not to install the extension
      from a publisher you don't trust, naming the publisher and what its signature
      shows. The install panel and Installed need its own confirmation, and the CLI
      defaults to no.
- [x] The docs and the threat model say what the permission grants, and that it can't
      be confined.

## Implementation (0.59.0)

- **The format** (`backoffice-host/src/bundle-package.ts`):
  - `BUNDLE_SCHEMA_VERSION` and `OLDEST_BUNDLE_SCHEMA_VERSION` are 5. `SERVER_DIR`,
    `BACKOFFICE_DIR`, `backOfficeModules(field)` (every `element`, `api`, `js`,
    `loader` and import map target) and `exportedEntry(json)` are new.
  - `layoutProblems` refuses:
    - a module outside `src/backoffice/`, or absolute, or a URL;
    - an export outside `src/server/`;
    - `plugin/`, and any other folder under `src/`.
  - The `backoffice.code` check runs in both directions.
  - A wired bundle's package may export nothing: the config holds its code.
  - The site's config may still wire a server half from schema 3
    (`OLDEST_WIRED_SCHEMA_VERSION`), since it is the site's own code and the layout
    is not its concern. Its package is still discovered, and so must be schema 5.
- **The permission** (`bundle-permissions.ts`):
  - `backoffice.code`, with `BACKOFFICE_CODE_WARNING`.
  - `describePermissions` gives it a `warning`.
  - `bundle-grants.ts` counts it among the permissions no capability uses.
- **The build** (`server/src/extension-backoffice.ts`):
  - `buildBackOffice` runs `Bun.build` per module, with splitting, `@umbraco-cms/*`
    external, and `src/server/` refused.
  - `createBackOfficeBuilds` builds when first asked for, again when a file under
    `src/backoffice/` changes, one build at a time per version.
  - `server.ts`'s `readyExtensions()` feeds the manifest endpoint (`ManifestPort.list`
    is now asynchronous), the back-office pages' import maps and `/bundles/*`.
  - A failed build is in Installed's `couldNotStart`, and logged.
- **Serving:** `InstalledExtension.servedDir`; `resolveExtensionFile` serves only
  from it, and `extensionOf` maps `src/backoffice/x.ts` to `/bundles/<pkg>/x.js`.
- **The server half:**
  - `processReads` gives Deno `src/server/` and its build only.
  - `buildExtension` refuses an import from `src/backoffice/`.
- **`extension migrate`:** `cli/src/support/extension-migrate.ts`'s
  `planMigration`/`applyMigration` are pure, then applied through a staging folder.
  - Code moves; data a module reads, such as `package.json`, stays, and the import
    of it is rewritten.
  - `cli/src/commands/extension/migrate.ts` wraps them.
- **The warning:**
  - `plugin/bundles-backoffice-code-words.js` (pure) and `bundles-backoffice-code.js`.
  - The Marketplace's consent card and Installed's grant view each show the block
    and keep Install or Grant disabled until its box is ticked.
  - Installed's publisher is the package's `author`, which is all an installed
    package keeps.
  - `confirmBackOfficeCode` in the CLI's `support/bundles.ts`.
  - The boot's log line is in `core.ts`, and the remote's grant check lists it in
    `remote.ts`.
  - The Marketplace now says why a package is not an extension this site takes.
- **Rewritten by `migrate`:** Simple Redirects and Entra. The demo sites' configs and
  `site.json`, the browser suite's side panel, and the docs grant `backoffice.code`.
- **Fixtures:** `tests/support/bundles.ts`'s `toCurrentLayout` runs `migrate` over a
  fixture at schema 4. Marketplace's, bundle-manage's and bundle-signatures'
  registry fixtures are a menu entry that runs no code. Schema 3 fixtures are kept
  for the refusal tests.
- **Tests:**
  - `bundle-package` (the layout), `extension-migrate`, `extension-backoffice` (the
    build, a failed build, Deno's reads) and `backoffice-code-words`;
  - Marketplace's asking for `backoffice.code`;
  - `extensions` (serving only the build).
- **Not done:**
  - A browser test of the install panel's second confirmation: the browser suite has
    no registry to install from. The side panel's browser test runs a granted
    extension's built screen in the back office.
  - Schema 3's reading code (`SCHEMA_3_PERMISSIONS`, `isSchema3Field`) is left in
    place, though an installed schema 3 extension is now refused at discovery.
