# 326 — An extension installs into a root of its own

**Epic:** I — Hardening · **Priority:** should · **Size:** L
**Depends on:** 311

## Story

As someone running a site, I want an installed extension kept apart from the site's own
dependencies, so that its dependency tree never sits beside the CMS's, the site's lockfile
never changes when I try an extension, and removing one is deleting a folder.

## Context

An extension is a dependency of the site today: `bun add` writes it into the site's
`package.json`, `bun.lock` and `node_modules`, beside `@crombolo/*` and everything they
depend on. Bun's hoisting decides what sits at the root. Resolution integrity should hold,
but it is the kind of thing that fails quietly, and the extension's whole tree lands in the
site for a package that is only being tried. Install-time code is already covered
(`--ignore-scripts`, story 300); this is about where the files go.

## Decisions (2026-11-11)

- **An extension is not a dependency of the site.** It installs into `extensions/<id>/`,
  a root of its own with its own `package.json`, `bun.lock` and `node_modules`, and is built
  and run from there (story 311's build already reads only the package). The root's
  `package.json` and `bun.lock` are committed, as the site's own are, and its `node_modules`
  is ignored as any is; the build, back-office and data folders stay under
  `.crombolo/extensions/<id>/`. (Planned on 2026-11-11 as a root under `.crombolo/`, which git
  ignores; moved so each root's lockfile is committed and every node installs the same
  tree, the rule the site's own code already follows.)
- **The site records what it has installed** in one file, `crombolo.extensions.json`
  (name, exact version, integrity, grant hash), committed, so a deploy installs the same
  set. `bun install --frozen-lockfile` in each root reproduces it.
- **Nothing of the extension is reachable from the CMS's resolution**, and nothing of the
  CMS's `node_modules` from the extension's build but the SDK copy the build supplies.
- **A site bundle's `requires`** lists extensions from that file, not from `package.json`.
- **A site package always carries the record and the roots' two files**, under `code/`
  beside `package.json`, `bun.lock` and `crombolo.config.ts`, once the site has a lockfile:
  `crombolo.extensions.json` and each `extensions/<id>/package.json` and `bun.lock`. No
  root's `node_modules` is packed: `site apply` writes the files and runs
  `bun install --frozen-lockfile` in each root they changed, checked against the record's
  integrity. A grant still travels in the config's `extensions` entry or the database; the
  record's grant hash lets the apply refuse an extension whose asked permissions no longer
  match it.
- **An extension installed from a file** is still copied to the site's
  `bundles/<name>-<version>.tgz` (story 245) and carried by a site package. Its root names
  the file as `file:../../bundles/<name>-<version>.tgz`, so one file serves every checkout and
  the record's integrity is the file's sha512.
- **Removal deletes the root.** Story 328 says what else removal does.
- **Developer-linked extensions** (`file:` or a workspace path) are still allowed outside
  production, resolved into the same root as a symlink.

## Decisions (2026-11-11, planning)

- **No migration of the old way.** A dependency of the site that is an extension is reported,
  at boot and on Installed, as "installed as a dependency, which this release no longer
  runs: remove it from package.json and install it again". Nothing moves it; the maintainer
  fixes each site by hand. `extension migrate` stays the author's command for a package's
  layout.
- **The record is the index, the roots are the truth.** `crombolo.extensions.json` names each
  installed extension with its exact version, tarball integrity and grant hash; each root's
  `package.json` pins that version exactly and its `bun.lock` pins the rest. A root without a
  record line, or a record line without a root, is a boot problem naming both.
- **Development links stay.** A `file:` or workspace path installs into the root as Bun
  links it, outside production only, and the record marks it `linked` with no integrity.

## The plan (2026-11-11)

What assumes an extension is a dependency today, all of which changes: `discoverBundles`
(`packages/backoffice-host/src/bundle-package.ts`) reads `dependencies` and
`peerDependencies` and resolves each with `resolvePackageDir`; `installCommand` and
`bunInstaller` in `marketplace.ts` run `bun add --ignore-scripts` and `bun remove` in the
site directory, `rangeFor` reads the dependency's range, `added` and `uninstall` say "commit
package.json and bun.lock"; `keepInSite` copies a file install to `bundles/`; `buildExtension`
resolves the entry with `Bun.resolveSync(packageName, siteDir)`; `requiredPackages` in
`site-file.ts` fills a site bundle's `requires` from the dependencies; `bundle-code.ts`'s
check lists `@crombolo/*` under `node_modules`; the CLI's `extension install` and
`uninstall` describe `bun add` and `bun remove`; `siteDeclaring` in `tests/support/bundles.ts`
writes fixtures under the site's `node_modules`; and the docs' "`package.json` is the install
ledger".

### Slice 1: the record and the roots

- `packages/server/src/extension-roots.ts`: `rootOf(siteDir, id)` is `extensions/<id>/`;
  `readRecord` and `writeRecord` for `crombolo.extensions.json`, sorted by id, each line
  `{ name, version, integrity, grant, linked? }`; `recordProblems(record, roots)` names a
  root with no line and a line with no root; `grantHashOf(permissions, origins)` is a
  stable hash of what was granted, which the next story's clean removal and 324's "asks for
  more" compare against.
- `PackageInstaller` gains the root as its directory: `add` runs `bun add --ignore-scripts
  --exact <name>@<version>` in the root after writing a `package.json` of
  `{ "name": "<id>-root", "private": true }` there; `remove` deletes the root. A `file:` or
  path specifier is installed in the root the same way, which Bun links.
- `installCommand` loses the site directory; the test double in `bundle-manage.test.ts`
  follows.

### Slice 2: discovery

- `discoverBundles` reads the record and each root's `node_modules/<name>`, through
  `readBundlePackage` as now, and no longer reads the site's dependencies. A dependency of
  the site whose `package.json` carries `crombolo.bundleType: 'extension'` is a problem row
  with the message from the decisions, so Installed and the boot both show it.
  `peerDependencies` are still read for `@crombolo/*`'s own release declaration and nothing
  else.
- `extensionEntryProblems` says "install it" instead of "add it to package.json".
- `BundlePackage.directory` is the root's `node_modules/<name>`, so `extensionOf`, the
  back-office build and the components need no change.

### Slice 3: build and process

- `buildExtension` resolves the entry from the root (`Bun.resolveSync(name, root)`), so the
  extension's own dependencies resolve from the root's `node_modules` and the CMS's from
  the SDK copy, as now. The refusal of `@crombolo/*` imports stands.
- `processReads` adds nothing: the build bundles the dependencies into `server.js`, and the
  process still reads only `src/server/` and its build. A test proves the root's
  `node_modules` is not readable from the process.
- `ExtensionProcess.home` stays `.crombolo/extensions/<id>/`.

### Slice 4: the surfaces

- `marketplace.ts`: `added` installs into the root, verifies what landed as now, writes the
  record line with the tarball integrity from the registry's `dist` or the kept file, and
  says "Commit extensions/<id>/ and crombolo.extensions.json". `uninstall` removes the root
  and the line. `rangeFor` goes; `installedVersion` reads the record. `keepInSite` still
  copies a file install to `bundles/`, and the root's `package.json` names it as
  `file:../../bundles/<name>-<version>.tgz`.
- A site bundle: `requiredPackages` reads the record; `site build` always packs
  `crombolo.extensions.json` and each `extensions/<id>/package.json` and `bun.lock` with the
  code it always packs; `site apply` writes them and runs a frozen install in each root
  whose files changed, as `installCode` does for the site's, and marks the restart pending.
- The CLI: `extension install` and `uninstall` describe the root and the record;
  `extension list` shows "installed as a dependency" for a legacy row; `site check-code`
  runs its frozen install in each root too and lists a root that fails.
- `crombolo init`'s `.gitignore` template needs no change: `node_modules/` already covers
  each root's.

### Slice 5: tests and docs

- `tests/support/bundles.ts`: `siteDeclaring` writes each fixture into
  `extensions/<id>/node_modules/<name>` with a record line, and a `legacyDependency` helper
  keeps the old shape for the problem-row test.
- `tests/extension-roots.test.ts`: record read and write, problems for an orphan root and an
  orphan line, the grant hash.
- `tests/bundle-manage.test.ts` and `tests/marketplace.test.ts`: install writes the root and
  the line and touches neither `package.json` nor `bun.lock`; uninstall removes both; a file
  install is kept in `bundles/` and named from the root; a legacy dependency is a problem
  row and is not started.
- `tests/extension-isolation.test.ts`: the process cannot read the root's `node_modules`.
- `tests/site-file.test.ts` and `tests/bundle-code.test.ts`: `requires` from the record; a
  site package carries the record and the roots' two files; apply installs them.
- Docs: `bundles.md` "`package.json` is the install ledger" becomes "the record and the
  roots", "Runtime install", "A site package with code" and "What a site package always
  carries"; `extensions.md` "Starting one"; `packaging-and-upgrades.md` "A site whose code a
  host runs"; `release-notes.md` with the upgrade note: an extension installed as a
  dependency stops running until it is removed from `package.json` and installed again.

## Acceptance criteria

- [ ] Installing an extension writes nothing to the site's `package.json` or `bun.lock`.
- [ ] Each extension has its own root, built and run from it, with its own lockfile.
- [ ] A deploy from the record reproduces the same versions and integrity.
- [ ] A site bundle's `requires` names the installed extensions, and the package carries
      `crombolo.extensions.json` under `code/` whenever it carries `package.json`; applying
      it installs each extension into its root from the record.
- [ ] An extension installed from a file is carried as `bundles/<name>-<version>.tgz` and
      installs into its root from that file on the remote.
- [ ] An extension installed as a dependency before is found and named, at boot and on
      Installed, with what to do; it is not started and nothing moves it.
- [ ] The process cannot read the root's `node_modules`.
- [ ] Covering tests; docs and release notes with the upgrade path.
