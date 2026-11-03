# 245 — A bundle installed from a file is kept in the site

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 241

## Story

As a developer installing a bundle from a `.tgz` file rather than the registry,
I want the file copied into the site's `bundles/` folder, so that it is
committed with the site and every machine, node and CI build installs the same
bundle.

## Context

Found 2026-11-02. `crombolo bundle install ./x.tgz` (story 241,
`marketplace.installFile`) runs `bun add <path>` on the file where it sits, so
`package.json` and `bun.lock` record a `file:` path to that place, such as
`~/Downloads/acme-crm-1.2.0.tgz`. The file is not copied:

- another machine, another node or a CI build cannot resolve it;
- a file in a temporary folder breaks the site's next `bun install`;
- a site bundle sent with `bundle apply --structure` or `bundle deploy` carries
  `package.json` and `bun.lock` (story 241) but not the file they name, so the
  remote's install from the lockfile fails.

A registry install is unaffected: the lockfile names the registry. A remote
install takes registry names only.

## Decided

- **`bundles/` in the site** is where a bundle installed from a file lives, as
  `bundles/<name>-<version>.tgz`, with a scoped name's `@` dropped and its `/`
  made `-` (`@acme/crm` 1.2.0 is `bundles/acme-crm-1.2.0.tgz`). The dependency
  is the relative path `./bundles/<name>-<version>.tgz`, which is how Bun
  records a tarball `bun add` was given (confirmed: `bun.lock` pins its sha512,
  and a fresh checkout installs it with `--frozen-lockfile`), so it resolves
  wherever the site is checked out.

## Plan (2026-11-02)

No decision outstanding; the CLI on the site's own machine is the only caller
(`localBundleAdmin` → `marketplace.installFile`), since a remote install takes
registry names.

1. **`marketplace.ts`, `installFile`.** Read the name and version as it already
   does (`declaresIn`), then work out `bundles/<name>-<version>.tgz`:
   - the file already is that path: use it in place;
   - that path holds the same bytes: nothing to copy;
   - that path holds other bytes: refuse, naming both, before anything is
     installed;
   - otherwise copy it there, creating `bundles/`.
   The signature check (060) and `bun add ./bundles/<file>` then run on the
   copy, so what is checked is what is installed and committed. A copy made
   for an install that is refused or fails is removed again.
2. **The old file.** Before `bun add`, note the dependency's current range
   (`rangeFor`). After a successful install of a new version, or a successful
   `uninstall`, a previous range that pointed into `bundles/` has its file
   removed, unless another dependency in `package.json` still names it.
3. **The outcome's message** says to commit `bundles/<file>` with `package.json`
   and `bun.lock`; `bundle install`'s output names the file.
4. **`transfer/src/code.ts`, `selectCodeFiles`.** Besides `CODE_ALWAYS`, the
   `dependencies` and `devDependencies` of the site's `package.json` whose range
   is `./bundles/<file>.tgz` or `file:bundles/<file>.tgz` add that file; a named
   file that is missing is a problem, as a missing `bun.lock` is. The remote's
   code install (241) writes it and installs from the lockfile unchanged.
5. **`init`.** Its `.gitignore` already ignores neither `bundles/` nor `*.tgz`; a
   test holds that.
6. **Docs:** `docs/bundles.md` ("From the command line"), the product site's
   bundles guide, the release note.

**Tests** (SQLite and Postgres, the fake installer the marketplace tests use):
the copy and the `./bundles/` specifier given to `bun add`; installing from a
path already in `bundles/`; the same bytes again changing nothing; other bytes
refused with nothing installed; an upgrade and an uninstall removing the old
file, and keeping one another dependency names; a refused install leaving no
copy; a site bundle built from a site naming `./bundles/x.tgz` carrying it, and
one naming a missing file refused; the scaffold's `.gitignore`.

## Acceptance criteria

- [x] `bundle install <file.tgz>` copies the file into `bundles/` byte for byte
      (so its signature, story 060, still checks), checks the copy, and installs
      `./bundles/<file>`. The command says to commit `bundles/<file>` with
      `package.json` and `bun.lock`.
- [x] Installing the same name and version again is idempotent when the bytes
      are the same, and refused when they differ, naming both: one version
      means one file.
- [x] Installing a new version from a file replaces the dependency and removes
      the old version's file from `bundles/`; `bundle uninstall` removes the
      file too. A file in `bundles/` that something else still names is left.
- [x] A site bundle carries the `bundles/*.tgz` its `package.json` names as
      `./bundles/…` or `file:bundles/…`, with `package.json` and `bun.lock` (story 241's
      `CODE_ALWAYS`), so an apply or a deploy installs on the remote from the
      lockfile.
- [x] `crombolo init`'s `.gitignore` does not ignore `bundles/`, and a test
      holds that a scaffolded site commits a `.tgz` placed there.
- [x] `docs/bundles.md` ("From the command line") and the product site's
      bundles guide say where a bundle from a file goes and that it is
      committed. Release note.
- [x] Tests: the copy and the relative dependency; same bytes idempotent,
      different bytes refused; an upgrade and an uninstall removing the old
      file; a site bundle carrying the file it names.

## Out of scope

- Installing a file on a remote: remote installs stay registry names; a file
  reaches a remote in a site bundle, by apply or deploy.
- Where a bundle keeps its own stored files (story 188), which is a prefix in
  the media store, not this folder.

## Implementation (2026-11-02)

- `transfer/src/code.ts`: `LOCAL_BUNDLES_DIR`, `localBundleFileName`,
  `localBundlePath` (a range as `./bundles/x.tgz` or `file:bundles/x.tgz`),
  `localBundlesNamed`; `selectCodeFiles` adds every named file, and a missing
  one is a problem.
- `server/src/marketplace.ts`: `installFile` keeps the file in `bundles/`
  (`keepInSite`: in place, the same bytes, other bytes refused, or copied),
  checks the copy's signature, installs `./bundles/<file>`, removes a copy it
  made when the install is refused or fails, and the old version's file
  afterwards (`removeUnnamed`); `uninstall` removes the file too. The outcome
  carries `file`, and its message says what to commit. `declaresIn` reads the
  version.
- `tests/local-bundles.test.ts`: the copy and specifier, in place and the same
  bytes, other bytes refused, a failed install leaving no copy, an upgrade and
  an uninstall, a file still named elsewhere, a site bundle carrying the file,
  a missing one refused, both range forms, the scaffold's `.gitignore`.
- Docs: `docs/bundles.md`, the product site's remotes guide, release notes.
