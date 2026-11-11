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

- **An extension is not a dependency of the site.** It installs into
  `.crombolo/extensions/<id>/`, with its own `package.json`, lockfile and `node_modules`,
  and is built and run from there (story 311's build already reads only the package).
- **The site records what it has installed** in one file, `crombolo.extensions.json`
  (name, exact version, integrity, grant hash), committed, so a deploy installs the same
  set. `bun install --frozen-lockfile` in each root reproduces it.
- **Nothing of the extension is reachable from the CMS's resolution**, and nothing of the
  CMS's `node_modules` from the extension's build but the SDK copy the build supplies.
- **A site bundle's `requires`** lists extensions from that file, not from `package.json`.
- **A site package always carries the record**, under `code/` beside `package.json`,
  `bun.lock` and `crombolo.config.ts`, once the site has a lockfile. The roots under
  `.crombolo/extensions/` are never packed: `site apply` reads the record and installs each
  extension into a fresh root with `bun install --frozen-lockfile`, checked against the
  record's integrity. A grant still travels in the config's `extensions` entry; the record's
  grant hash lets the apply refuse an extension whose asked permissions no longer match it.
- **An extension installed from a file** is still copied to the site's `bundles/<name>-<version>.tgz`
  (story 245) and carried by a site package. Its root records the file by a path relative to
  the site root, resolved from `.crombolo/extensions/<id>/`, so one file serves every
  checkout and the record's integrity is the file's sha512.
- **Removal deletes the root.** Story 328 says what else removal does.
- **Developer-linked extensions** (`file:` or a workspace path) are still allowed outside
  production, resolved into the same root as a symlink.

## The design

- `bundle-code-install.ts`: install into the root with `bun add --ignore-scripts
  --cwd .crombolo/extensions/<id>`; write the record; refuse an install that would touch the
  site's `package.json`.
- Discovery (`extension-discovery.ts`) reads the record and the roots, not `package.json`'s
  dependencies. A dependency that is an extension, left from before, is found and reported
  as "installed the old way", with `crombolo extension migrate` moving it across.
- `buildExtension` resolves from the root. The Deno process's `--allow-read` is the root.
- The CLI's `extension install`, `uninstall`, `list` and the back office's Installed follow.
- Docs: `bundles.md` "Runtime install", `extensions.md`, `packaging-and-upgrades.md`.

## Acceptance criteria

- [ ] Installing an extension writes nothing to the site's `package.json` or `bun.lock`.
- [ ] Each extension has its own root, built and run from it, with its own lockfile.
- [ ] A deploy from the record reproduces the same versions and integrity.
- [ ] A site bundle's `requires` names the installed extensions, and the package carries
      `crombolo.extensions.json` under `code/` whenever it carries `package.json`; applying
      it installs each extension into its root from the record.
- [ ] An extension installed from a file is carried as `bundles/<name>-<version>.tgz` and
      installs into its root from that file on the remote.
- [ ] An extension installed as a dependency before is found, named, and moved by `extension migrate`.
- [ ] Covering tests; docs and release notes with the upgrade path.
