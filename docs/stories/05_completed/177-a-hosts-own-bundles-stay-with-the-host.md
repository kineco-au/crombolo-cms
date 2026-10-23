# 177 — A host's own bundles stay with the host

**Epic:** K — Moving content · **Priority:** should · **Size:** S
**Depends on:** 063, 104

## Story

As someone who runs crombolo for other people's sites, I want to mark the
bundles my installation provides as mine, so that a site exported from it
neither names them nor needs them, and its owner can take the site anywhere
and start it with a plain CMS.

## Context

A whole-site file (104) records the server bundles the site wires in its
manifest's `requires`, by package name and version
([`../../content-transfer.md`](../../content-transfer.md)). An import refuses
while one is missing or older (`requiresProblems`, `site-replace.ts`). That
is right for a bundle the site's owner chose: the site does not work without
it.

It is wrong for a bundle the **host** provides: an editing tool, an
integration with the host's own services, or a private package that was never
published. All of these are wired in the host's `crombolo.config.ts` for
every site it runs, and none of them belong to any one site.

- **The file leaks the host's packages:** every export, pull (107, 108) or
  `crombolo export --site` names them and their versions, including ones that
  are private.
- **The site can't be moved:** importing the file anywhere else, a laptop
  included, is refused with "the file needs `<package>@<version>`, which this
  site does not have", for a package the owner never chose and often cannot
  install.

The **code** of a bundle never travels in a site file, and nor do the tables
it owns (062). Only the name and version reach the manifest. What a host
bundle *produces* (components, styles, schema, content) is the site's own, and
travels as it does today.

## Decision

**The host declares what it provides, in its config:**

```ts
export default defineConfig({
  bundles: [hostTool(), siteBundle()],
  hostProvided: ['@host/tool'],
})
```

- **Package names**, not bundle objects, so one list covers a server half
  wired under `bundles` and a backoffice-only extension discovered from the
  site's `package.json`.
- **Set by whoever runs the installation,** which is where the decision
  belongs.

**Considered and not taken:** a bundle marking itself (for example,
`"crombolo": { "portable": false }` in its own `package.json`). It works
wherever the bundle is installed, but then the bundle decides rather than the
host, and one package can be the host's in one installation and a site's own
choice in another.

## Findings (2026-10-23)

- **One place writes `requires`.** `requiredPackages(config)` in
  `server/src/site-file.ts` lists the packages discovered in the site
  (`discoverBundles(config.siteDir)`) whose bundle is wired in
  `config.bundles`, by package name and version. `exportSite` calls it, and
  every path that writes a whole-site file goes through `exportSite`:
  - `crombolo export --site` (`cli/src/operations/commands.ts`);
  - the remote protocol's pull (`server/src/remote.ts`);
  - the command line's remote transfer (`cli/src/remote/transfer.ts`).

  So one filter covers all three, and a test per path only has to show it goes
  through `exportSite`.
- **Nothing else in the file names a package today.**
  - The file's own `package.json` (`bundlePackageJson`, `transfer/src/package.ts`)
    holds its name, version, `files`, a peer on `@crombolo/crombolo` and the
    `crombolo` field. It has no dependencies.
  - The manifest's other fields (provenance, selector, counts, dependencies,
    blobs, carried files) name content, not packages.
  - Backoffice-only extensions are never in `requires`: only wired server
    bundles are.

  The test still checks the whole manifest and `package.json` for the
  host-provided name, so a later field cannot quietly start naming it.
- **Imports check `requires` in two places:** `requiresProblems`
  (`site-replace.ts`) for a whole-site replace and a site start, and
  `bundle-install.ts:534` for installing. Neither changes: a file without the
  name has nothing to check, and an older file that names a host package
  imports on that host, where it is installed.
- `config.bundles` has no environment variable, deliberately, and a test
  checks it has none (`docs/configuration.md`). `hostProvided` follows it.

## Plan

1. **Config.** `CromboloConfig.hostProvided: readonly string[]` (default
   `[]`), set through `defineConfig` only and documented in the
   code-only settings table beside `bundles`. The test that checks `bundles`
   has no environment variable covers `hostProvided` too.
2. **Start-up note.** At boot, each listed name that is neither the package
   of a wired bundle nor a discovered extension is logged once as a warning
   ("listed as host-provided but not installed here"), not refused.
3. **Export.** `requiredPackages` leaves out every package in
   `config.hostProvided`. Names are compared as npm writes them (exact,
   scoped included).
4. **Tests** (`tests/site-file.test.ts`, extended):
   - **The round trip.** A site in `output/` declares two bundle packages
     (`siteDeclaring`, `tests/support/bundles.ts`): one host-provided, one its
     own. Both are wired. Its export's `requires` names only its own. That
     file then starts a site (105) on an installation with only its own bundle
     installed, which an export without the filter would refuse.
   - **Nothing else names it.** The test reads the file's manifest and
     `package.json` and finds no mention of the host-provided package.
   - **Every export path** shares `exportSite`. A test of the remote pull
     reads `requires` from the pulled file.
   - **Older files.** A file that names a host-provided package still imports
     on an installation that has it.
   - **The start-up warning:** an unknown name is logged, not refused.
5. **Docs.**
   - `docs/configuration.md`: `hostProvided` in the code-only settings.
   - `docs/content-transfer.md`: the `requires` row says host-provided
     packages are left out.
   - `docs/bundles.md`: a paragraph on bundles a host provides. A host's tool
     should write self-contained files, since this story only stops the file
     claiming the dependency.
   - The release notes.

No migration, and nothing changes on import.

## Acceptance criteria

- [x] **`hostProvided`** (a list of package names) in `defineConfig`, with no
      environment variable, as `bundles` has none. A name that is neither
      wired nor discovered is logged once at start, not refused, so a host can
      list a bundle it is rolling out.
- [x] **Export:** a whole-site file's `requires` leaves out every
      host-provided package. Every path that writes one is held to this:
      `crombolo export --site`, the remote protocol's pull, and the
      operations `site.export`.
- [x] **Import:** unchanged for files that don't list them. A file written
      before this story that does name a host-provided package imports on the
      host that provides it, which has it installed, as today.
- [x] **The round trip is tested:** a site wiring one host-provided bundle and
      one bundle of its own exports a file whose `requires` names only the
      latter, and that file starts a site (105) on an installation that has
      only the latter installed.
- [x] **Nothing else in the file names a host-provided package:** its
      manifest and `package.json` are checked in the same test.
- [x] **Docs:**
  - [`../../configuration.md`](../../configuration.md) gains `hostProvided`;
  - [`../../content-transfer.md`](../../content-transfer.md)'s `requires` row
    says host-provided packages are left out;
  - [`../../bundles.md`](../../bundles.md) gains a paragraph on bundles a host
    provides.

## What was built

- **`CromboloConfig.hostProvided`** (`server/src/config.ts`): a list of package
  names, `[]` by default, with no environment variable. A test checks the
  config never reads one.
- **The export filter.** `requiredPackages` (`server/src/site-file.ts`)
  leaves out every listed package. `exportSite` is the one place a whole-site
  file is written, shared by `crombolo export --site`, the remote pull and the
  command line's remote transfer, so all three follow.
- **The start-up note.** `unknownHostProvided(config)` names the listed
  packages discovered nowhere in the site. `createServer` logs each once as a
  warning and boots regardless.
- **Imports are unchanged:** `requiresProblems` still checks whatever a file
  names.
- **Tests** (`tests/host-provided.test.ts`):
  - a site wiring a host-provided bundle and one of its own exports a file
    whose `requires` names only its own;
  - neither the manifest nor the file's `package.json` names the host's
    package;
  - the file passes the start check on an installation with only the site's
    own bundle, and is refused on one with neither;
  - an older file naming the host's package passes on the host;
  - an unknown name is reported, not refused;
  - no environment variable.
- **Docs:** `docs/configuration.md`, `docs/content-transfer.md`,
  `docs/bundles.md` ("Bundles a host provides") and the release notes.
- **Not tested separately:** the remote pull and the operations export. Both
  call `exportSite`, which the tests exercise.

## Out of scope

- **Making a host bundle's output render without it.** A host whose tool
  writes components that import the tool has made the site depend on it; the
  rule for such a tool is to write self-contained files. This story only
  stops the file claiming a dependency the site does not have.
- **The backoffice Packages builder (063),** which builds what a person picks
  and never adds `requires`.
