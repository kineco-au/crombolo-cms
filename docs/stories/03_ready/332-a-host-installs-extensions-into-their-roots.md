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
