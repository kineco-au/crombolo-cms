# 332 — A host installs extensions into their roots

**Epic:** I — Hardening · **Priority:** should · **Size:** M
**Depends on:** 326

## Story

As a host that installs a site's extensions itself, I want the CMS's own way of putting an
extension into its root and recording it, so that what I install is exactly what the CMS
boots, without copying its file format.

## Context

Story 326 moved each extension into `extensions/<id>/`, recorded in
`crombolo.extensions.json` with its exact version, integrity and grant hash. The CMS does
this itself in two places: the Marketplace and `crombolo extension install`, and `site apply`
for a site package with code. A host that installs extensions its own way has neither:
- **A host-chosen set of extensions**, installed on its nodes from a list the host keeps,
  has to prepare each root, run the install, and write the record line the boot checks.
  The helpers that do that (`rootOf`, `prepareRoot`, `recordExtension`, `readRecord`,
  `recordProblems`, `grantHashOf`) are internal to `@crombolo/backoffice-host`.
- **A site package with code installed by `installBundleCode`** (story 241's host path)
  installs the site's own `package.json` and `bun.lock`, but not the roots the package now
  carries under `code/`. `site apply` installs them; the host function does not.
  `checkBundleCode` does not say when the code's `package.json` lists an extension as a
  dependency, which the boot will name and not run.

## Proposed

- **`@crombolo/crombolo/host` exports the roots:** `ROOTS_DIR`, `RECORD_FILE`, the
  `RecordedExtension` and `ExtensionRecord` types, `rootOf`, `readRecord`, `recordProblems`,
  `grantHashOf`, and `INSTALLED_AS_DEPENDENCY`.
- **And one function to install an extension**, as the Marketplace does it:
  `installExtension(siteDir, { name, version, integrity?, file? }) → { id, root, line }`.
  It prepares the root, runs `bun add --ignore-scripts --exact` there (or the kept file),
  checks what landed against the integrity, and writes the record line. Its companion
  `removeExtension(siteDir, id)` deletes the root and the line, and nothing else (data and
  grants stay the host's to decide, as story 328 says for an administrator's removal).
- **`installBundleCode` installs the roots** a package carries, as `site apply` does: the
  record and each root's `package.json` and `bun.lock`, then `bun install --frozen-lockfile
  --ignore-scripts` in each root whose files changed, checked against the record's
  integrity. Its result names the roots it installed and any that failed.
- **`checkBundleCode` names an extension listed as a dependency** of the code's
  `package.json` as a problem, in `INSTALLED_AS_DEPENDENCY`'s words, so a host can refuse
  the code before it deploys rather than find the extension not running after.

## Acceptance criteria

- [ ] The roots helpers and types are exported from `@crombolo/crombolo/host`, and
      `docs/api.md` lists them.
- [ ] `installExtension` installs into the root and writes the line the boot accepts; a
      wrong integrity is refused and leaves no root; `removeExtension` removes both.
- [ ] `installBundleCode` installs each carried root from its lockfile, and reports a root
      that fails.
- [ ] `checkBundleCode` reports an extension listed as a dependency of the code.
- [ ] Covering tests: a host-installed extension boots and is listed in Installed; a code
      package with a root installs and boots it; a dependency extension is reported.

## Decisions (2026-11-11)

- **The extension signature policy applies by default.** `installExtension` checks the
  package's signature against the site's `CROMBOLO_BUNDLE_SIGNATURES` and
  `CROMBOLO_BUNDLE_SOURCES`, as the Marketplace and `crombolo extension install` do, and
  refuses what they refuse. A host may pass its own `policy` in their place; there is no
  way to skip the check without passing one. A signature that does not check out is
  refused under any policy.
- **It refuses what the Marketplace refuses**, by the same checks: a package that is not an
  extension, a site package, a bundle schema before 6, or one whose manifest has problems.
  What landed and turns out to be one of these is taken out again, root and line.
- **It grants nothing and runs nothing.** The host has no database or audit log to hand:
  granting stays with the site's config (`extensions.<id>.grant`) or an administrator, and
  an install's content is applied, if at all, by the site.

## Implementation plan

1. **One install path, shared** (new `packages/server/src/extension-install.ts`):
   - Out of `marketplace.ts`, the steps both need: read what a registry version or a kept
     file declares (`declaresAt`, `declaresIn`), check its signature (`provenanceAt`
     against the policy), install into the root (`prepareRoot`, `bun add --ignore-scripts
     --exact`), compare what landed with the integrity, write the record line, and undo
     (root and line) on any failure after the root is made.
   - The Marketplace calls it and keeps what is its own around it: consent, levels, grants,
     content, the audit entry, invalidating the bundles.
2. **`installExtension(siteDir, { name, version?, integrity?, file?, policy?, registry? })`**
   → `{ ok: true, id, root, line, provenance } | { ok: false, problems }`, from
   `@crombolo/crombolo/host`:
   - `version` absent takes the latest; `file` installs a kept `.tgz` (`bundles/`), as
     `installFile` does.
   - `integrity`, when given, must match the registry's and the installed `bun.lock`'s;
     when not, the registry's is recorded.
   - The policy defaults to the one `loadConfig(siteDir)` resolves, so the env settings
     apply without the host reading them.
3. **`removeExtension(siteDir, id)`** → `{ removed: boolean }`: deletes `extensions/<id>/`
   and its line. Data, tables, grant and settings stay (story 328's default); the host
   decides about those with the site.
4. **`@crombolo/crombolo/host` exports** `ROOTS_DIR`, `RECORD_FILE`, `RecordedExtension`,
   `ExtensionRecord`, `rootOf`, `readRecord`, `recordProblems`, `grantHashOf`,
   `INSTALLED_AS_DEPENDENCY`, `installExtension` and `removeExtension`. `writeRecord`,
   `recordExtension` and `prepareRoot` stay internal, so a host writes the record only
   through `installExtension`.
5. **`installBundleCode`** (`bundle-code.ts`): after the site's own install, each root the
   code carries (`extensions/<id>/package.json` and `bun.lock`) is installed with
   `--frozen-lockfile --ignore-scripts`, then its package checked against the record's
   integrity. The result gains `roots: { id, ok, problem? }[]`; a failed root is also a
   problem, and the others are still installed.
6. **`checkBundleCode`**: in its scratch copy it installs the roots too, then reports:
   - `recordProblems` (a root without a line, a line without a root);
   - a root whose installed package does not match its line's version or integrity;
   - an extension listed in the code's `package.json` dependencies, in
     `INSTALLED_AS_DEPENDENCY`'s words;
   - and lists root extensions' server bundles in `serverBundles` beside the rest.
7. **Docs:** `docs/api.md` lists the new exports with a host's install loop as an example;
   `bundles.md` "The record and the roots" says a host installs with `installExtension`.
   Release notes under Unreleased.

## Tests

- **`tests/host-extensions.test.ts`** (new), with a local registry stub and the packed
  fixtures `tests/support/bundles.ts` makes:
  - `installExtension` installs into the root and writes the line; a server booted on the
    site lists it in Installed, and with a config grant it runs.
  - A wrong `integrity` is refused and leaves no root and no line.
  - With `CROMBOLO_BUNDLE_SIGNATURES=required` an unsigned package is refused; a passed
    `policy: { signatures: 'optional' }` installs it.
  - A site package and a schema-5 bundle are refused.
  - `removeExtension` removes the root and the line, and leaves the extension's tables.
- **`tests/bundle-code.test.ts`**: a code package carrying a root installs it and boots it;
  a root whose lockfile will not install is named in `roots` and the problems; a code
  package listing an extension as a dependency is reported by `checkBundleCode`.
- **Marketplace tests** run unchanged, on the shared path.
