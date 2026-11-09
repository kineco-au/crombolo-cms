# 306 — A site package says what it is

**Epic:** I — Hardening · **Priority:** must · **Size:** L
**Depends on:** —

## Story

As someone moving a whole site, or restoring one, I want a site package to be
plainly a site package and never mistaken for an extension, so that I know
applying one replaces the site's code, config and dependencies, and nobody can
offer one to me as an extension.

## Context

`crombolo bundle build` packs the whole site: its schema, components and content,
and under `code/` its `package.json`, `bun.lock` and `crombolo.config.ts` (story
241). It writes `private: true`, so `npm publish` refuses it. Nothing else marks it.
The back office, the CLI and the docs call it a bundle, the same word as an
extension. The CMS tells the two apart only by whether `bundle.json` lists a `code/`
section. See `extension-threat-model.md`, T15.

Overwriting the config is what a site package is for: a backup restored, or a site
deployed to its next environment. That stays allowed, but it must be visible.

## Decisions (2026-11-09)

- **Called a site package** in the back office, the CLI and the docs. "Bundle" is
  kept for extensions.
- **The marker is `bundleType`, and every bundle must have one:**
  - `"crombolo": { "bundleType": "site" }` or `"extension"` in `package.json`, and
    the same in the `bundle.json` manifest when the bundle has one.
  - A bundle with no `bundleType`, or any other value, is refused.
  - An extension has to say `"extension"` explicitly; nothing is assumed.
- **Everything made from a site is a site package:** `site build`, `site deploy`,
  `site apply --remote`, `site export` and its subtree form, and `push` and
  `pull`, which use it. Extensions are what the Bundle Editor builds and what is
  published to a registry. The CLI can build an extension too.
- **New `site` commands, and the old ones removed:** no aliases.
- **Template seeds are site packages:** `sites/crombolo/bundles/demo-crombolo`,
  `.scaffolds/basic` and `.scaffolds/demo-bunbraco` are a template's own content,
  and `start --bundle` applies them to a new site, components included.
- **`import` becomes `site import`, and `bundle export --source` becomes `content
  export`.**
- **`site runs` lists every run,** each labelled "site package" or "extension".
  `site revert` reverts a site package's run. An extension's content is undone by
  `bundle uninstall --revert-content`, and `site revert` given an extension's run
  says so.
- **Versions are checked up front:** a remote names the bundle formats it reads,
  and the CLI checks before building, saying which side to upgrade. No older format
  is read.

## The design

### The marker

- **Both places, and they must agree.** `package.json` is what a registry shows
  before anything is downloaded. Two that disagree are refused at read
  (`loadBundle`, `validateBundlePackage`).
- **The integrity hash covers the whole bundle.**
  - Today `bundleIntegrity` skips `bundle.json` and never sees `package.json`, which
    is written after it. And `loadBundle` checks the hash only when it is not empty.
  - From this story it runs over every file of the package but `provenance.json`:
    `package.json`, and `bundle.json` with its `integrity` value blanked before
    hashing, as well as the node files.
  - An empty or missing `integrity` is refused.
  - `formatVersion` goes up, so a bundle hashed the old way is refused as "built by an
    earlier version: build it again", not as edited.
- **What the hash does not do:** it has no key, so whoever edits the marker can work
  out the hash again. It catches an accidental edit, not a deliberate one.
  - Only a signature (story 060), whose digest covers both files, makes the marker
    unforgeable. A site that needs that sets `CROMBOLO_BUNDLE_SIGNATURES=required`,
    which `site apply` honours as installs do.
  - The rules below are built so that a forged marker gains nothing.
- **What a site package may carry:** everything a site has, `code/` included, with
  its config, `package.json` and `bun.lock`.
- **What it may not carry:**
  - `server`, `extensions`, `permissions` or `importmap` in its `crombolo` field. A
    site's own extensions travel as dependencies in the `package.json` under `code/`.
  - Any lack of `private: true`. Without it, `writeBundlePackage` refuses to write one.
- **An extension**, with `bundleType` `"extension"`:
  - a `code/` section is refused (story 312 keeps its components in its package);
  - changing a site package's marker to `"extension"` makes it an extension, so it
    can do less, never more. Removing it makes it nothing, and it is refused.
- **Required everywhere:** `validateBundlePackage` and `loadBundle` refuse a bundle
  without it, with "this bundle does not say what it is: it needs `bundleType`,
  `site` or `extension`". That covers a site package's `package.json` and
  `bundle.json`, an extension's `package.json`, and an extension's `bundle.json`
  when it carries content.
- **Bundles made before this release:**
  - **Files and directories** (old site bundle files, old downloads of created
    packages): refused when checked or applied, saying to build them again. A site
    package is rebuilt with `site build` or `site export`. A created package is
    downloaded again, which builds it fresh, marked.
  - **Installed extensions without it:** the site still starts, but each one is
    turned off and is not loaded. Installed, `bundle list` and the health check say
    "turned off: it does not say it is an extension; install a version that does".
    Nothing else about the site changes.
  - **Our own:**
    - `@crombolo/simple-redirects` and `@crombolo/entra` are marked `"extension"`,
      and the Bundle Editor's download and `bundle build` write it.
    - The template seeds (`sites/crombolo/bundles/demo-crombolo`,
      `.scaffolds/basic`, `.scaffolds/demo-bunbraco`) are rebuilt as site packages.
      So are the bundles `crombolo init` writes from them.
    - Each test fixture is marked as what it stands for.
  - **Third-party extensions** need a new version from their author. The release
    notes say so, as a breaking change, with the one line to add.

### Never from a registry

Refused, saying "this is a site package; apply it with `crombolo site apply`":
- **The Marketplace:** read from the packument's `crombolo.bundleType` before
  `bun add`, and again on the landed manifest. One found in a search is listed as
  refused.
- **`bundle install`**, by name or from a `.tgz`: installing is for extensions.
- **A remote's `bundle-manage`**, installs and uninstalls alike.
- **`installBundleContent` by package name:** a dependency that is a site package.

Accepted, as a file or a directory only: `site apply` (here or `--remote`), `push`,
`pull`, `start --bundle`, `--code-into`.

### One way in for each kind

- **Site packages:** `site apply` (here or `--remote`), `site deploy`, `push`, `pull`
  and `--code-into` take only a site package. Given an extension, they refuse it:
  "this is an extension: install it with `crombolo bundle install`".
- **Extensions:** `bundle install` (here or `--remote`) and the Marketplace take only
  an extension. Given a site package, they refuse it, as above.
- **The remote API:** its apply endpoint (`environments/<env>/bundles`) takes only
  site packages, and its bundle-manage endpoints take only extensions.
- **No copying without installing:** an extension's content is applied only by
  installing it, so it stays listed, its grant is recorded, and its components stay
  in its package (story 312). Copying content between one's own sites is a site
  package made with `site export --subtree`.

### Visible where it is applied

- **The check report** (CLI `site check`, `site apply --dry-run`, the remote's dry
  run) opens with:
  - "Site package: replaces this site's code, config and dependencies";
  - then the config and `package.json` changes, each flagged, and a "dependencies
    added and removed" summary read from the two `package.json` files;
  - then the code files, then the rest.
- **The back office:** the Changes dashboard's pending transfers and the remote runs
  name a site package as one, with the same first line.

### The CLI

The old commands are removed: running one says which command replaced it, and does
nothing.

| Old | New |
|---|---|
| `export --site` | `site export` |
| `import` | `site import` |
| `bundle export <subtree>` | `site export --subtree <path>` |
| `bundle export --source` | `content export` |
| `bundle build` | `site build` |
| `bundle apply` (and `--remote`, `--dry-run`) | `site apply` (and `--remote`, `--dry-run`) |
| (the dry run) | `site check` |
| `bundle deploy` | `site deploy` |
| `bundle runs`, `bundle revert` | `site runs` (every run, labelled by kind), `site revert` (a site package's run) |
| `bundle check-code` | `site check-code` |
| `push`, `pull` | unchanged, documented as moving a site package |

`bundle` keeps what is about extensions: `install`, `uninstall` (with
`--revert-content` to undo the content its install applied), `list`, `enable`,
`disable`, `purge`. `sign`, `verify` and `digest` work on either kind, and stay
under `bundle`, saying which kind they were given.

**Building an extension:** `crombolo bundle build <name>` builds a Bundle Editor
definition into a `.tgz`, the same package the back office's download gives, with
`bundleType` `"extension"`. `--out` names the file. `--check` only validates. And
`crombolo bundle check <dir|tgz>` validates any extension package, hand-written
ones included: `validateBundlePackage`, refusing `code/` and a `site` marker.

### Versions across a remote

- **The bundle format moves to 8**, the oldest read, so a CLI and a remote on
  different releases cannot exchange site packages.
- **Discovery says what a remote reads:** `GET /.well-known/crombolo-remote` gains
  `"bundleFormats": [8, 8]` (oldest, newest).
- **The CLI checks before building:** `push`, `pull`, `site apply --remote` and
  `site deploy` refuse when the formats do not overlap, saying which side to upgrade:
  "the remote reads bundle formats 7 to 7; this CLI writes 8: upgrade the remote
  first".
- **A remote that names no formats** is an older release, and is refused with the
  same advice. `remote-protocol.md` documents the field.

### Words

- The back-office text that calls a site package a bundle:
  - "Install bundles and the code a bundle carries" in the CI access words;
  - the Changes dashboard's transfer headings;
  - the remote runs.
- `bundles.md` Part 1: "Created packages" are extensions. The site bundle sections
  move to a "Site packages" part.
- `content-transfer.md`, `remote-protocol.md` and the CLI help.
- The remote API's paths stay as they are. They are not shown to anyone.

## Implementation plan

1. **The marker** (`packages/transfer`):
   - `BundlePackageInfo.bundleType`, written by `bundlePackageJson` and into the
     manifest by `writeBundle`.
   - `loadBundle` reads both, refusing a missing one or a mismatch.
   - `bundleIntegrity` covers `package.json` and `bundle.json` (with `integrity`
     blanked). `writeBundlePackage` computes it once `package.json` is known. An
     empty value is refused.
   - `BUNDLE_FORMAT_VERSION` is raised, and `OLDEST_BUNDLE_FORMAT_VERSION` raised to
     match, so an older bundle is refused as built by an earlier version.
   - `writeBundlePackage` refuses a site package without `private`.
2. **Validation** (`backoffice-host/src/bundle-package.ts`):
   - `bundleType` is a required field of `CromboloField`;
   - the site package rules;
   - `code/` refused for an extension, in `validateBundlePackage` and in
     `carriedSections`.
   - At boot, an installed extension that fails only for want of `bundleType` is
     turned off with its reason, rather than stopping the boot. `discoverBundles`
     reports it, and the server, Installed and the health check show it.
3. **Every site output sets it:** `buildBundleFromDirectory`, `exportSite`, the
   subtree `contentExport`, and the remote apply's packing.
4. **Refusals** in `marketplace.ts` (the packument and the landed manifest),
   `bundle install` (`localBundleAdmin`, `installFile`), `remote.ts`'s bundle-manage,
   and `installBundleContent` by name.
5. **Versions:** `bundleFormats` in the discovery document (`remote.ts`), and the
   check in the CLI's remote client before any build.
6. **Runs:** `TransferRun` records the `bundleType`. `site runs` shows it, and
   `site revert` refuses an extension's run. `bundle uninstall --revert-content`
   reverts the install's run.
   - A migration adds a nullable `bundle_type` column to `content_transfer_run`. Its
     `release` is the next release, per `AGENTS.md`. Runs from before it read as
     "earlier".
   - It is undone in every test rewind helper. The Postgres suite runs, as the data
     layer changes.
7. **The report:** `ContentCheckResult.sitePackage` with the config and dependency
   changes. The CLI's `printSections` and the back office's transfer view show it
   first.
8. **The CLI:**
   - `commands/site/` gains export, import, build, apply, check, deploy, runs, revert
     and check-code, moved from `bundle/`, `export.ts` and `import/`.
   - `content export` takes `bundle export --source`.
   - Their old files become stubs that name the new command.
   - `bundle build` and `bundle check` are new.
   - `cli-spec` and the CLI integration tests are updated.
9. **The back office:** the words above. Changes dashboard tag "Site package".
10. **Docs:** `bundles.md` split, `content-transfer.md`, `remote-protocol.md`,
   `building-a-site-from-the-cli.md`, the README's CLI table if it lists them,
   release notes (the CLI renames as a breaking change).

## Tests

- **Transfer:**
  - a site build writes `bundleType` in both places;
  - a mismatched pair is refused;
  - an extension with `code/` is refused;
  - a package with no `bundleType`, or an unknown one, is refused, saying what to
    add;
  - editing `bundleType` in `bundle.json`, or anything in `package.json`, without
    rehashing fails the integrity check; an empty `integrity` is refused; a bundle of
    the previous format version is refused as built by an earlier version;
  - an installed extension with none is turned off at boot, and the site still
    starts.
- **Install:**
  - the Marketplace refuses a packument marked `site`, and a landed manifest
    marked `site`;
  - `bundle install ./site.tgz` and a remote's bundle-manage refuse one.
- **Apply:** `site apply --dry-run` of a site package lists the config and
  `package.json` first, with dependencies added and removed.
- **Seeds:** `start --bundle` applies each template seed as a site package, its
  components landing; `crombolo init` writes marked seeds.
- **Runs:** `site runs` labels both kinds; `site revert` of an extension's run
  refuses, naming `bundle uninstall --revert-content`, which reverts it.
- **Versions:** a remote whose `bundleFormats` do not include the CLI's is refused
  before anything is built, saying which side to upgrade; so is one that names none.
- **CLI:**
  - each old command names its replacement and changes nothing;
  - `bundle build <name>` writes the same package as the back-office download,
    marked `extension`;
  - `bundle check` refuses a hand-made package carrying `code/`.

## Implemented (0.57.0)

- **Format 8,** and the oldest read. `bundleType` sits in `bundle.json` straight
  after `id`, and in `package.json`'s `crombolo`. `writeBundlePackage` fills the
  manifest's from the package when `writeBundle` was not told, and refuses the two
  disagreeing.
- **The hash:** after the files, `bundleIntegrity` takes `bundle.json` with its
  `integrity` blanked, then the package's identity: `name`, `version` and
  `crombolo`, keys sorted. That is not `package.json`'s bytes, which a packer may
  normalise. The streamed whole-site writer ends its hash the same way
  (`updateTrailer`).
- **Refusals:** in `marketplace.ts` (the packument, the landed manifest, a `.tgz`),
  `discoverBundles` (a site package as a dependency), and `readBundle` (by
  dependency name, and through `expects`, which each caller sets).
- **Older extensions:** an installed extension whose only fault is a missing
  `bundleType` is reported as `untyped`. The boot drops it from `config.bundles` with
  a warning, and the Installing code health check names every unusable dependency.
- **Versions:** `bundleFormats` in the discovery document, and
  `bundleFormatProblem` in the CLI, checked by `push`, `pull` and
  `site apply --remote` (and so `site deploy`).
- **Runs:** migration 065 adds `content_transfer_run.bundle_type`. `site runs` says
  "site package", "extension" or "earlier". `site revert` and the remote's revert
  refuse an extension's run, and `bundle uninstall --revert-content` reverts it,
  sections and all, before removing it.
- **The report:** `ContentCheckResult.sitePackage` (`sitePackageChanges`) is printed
  first by `site apply --dry-run`, `site check` and the remote dry run. The Changes
  dashboard tags a pending transfer from a directory as a site package.
- **The CLI:** `site check` is `site apply --dry-run`. The old commands are hidden
  stubs (`support/moved.ts`). The command reference's Sites, extensions and remotes
  page now carries the `site` topic, and the import page went with `import`'s
  last command. `@crombolo/cli` depends on `@crombolo/backoffice-host` for
  `bundle check`.
- **Differences from the plan:**
  - A site package a registry search finds is left out of the Marketplace's
    listing, not listed as refused. Installing one by name is refused, with the
    words above.
  - The kind of a pending transfer on the Changes dashboard is read from where it
    came from (a directory is a site package), not from its manifest.
- **Tests:** `tests/site-packages.test.ts`, a Marketplace refusal in
  `tests/marketplace.test.ts`, and the fixtures across the suite marked as what they
  stand for.

## Acceptance criteria

- [x] `site export`, `site build` and a subtree export write a package marked
      `"bundleType": "site"` in `package.json` and `bundle.json`, and `private: true`.
- [x] A site package named to `bundle install`, the Marketplace or a remote's
      install is refused, saying it is a site package.
- [x] An extension given to `site apply`, `site deploy`, `push` or a remote apply is
      refused, saying to install it with `bundle install`.
- [x] A package with `code/` that is not marked `site` is refused at check and install.
- [x] The integrity hash covers `package.json` and `bundle.json`. An edit to either
      fails it, and an empty hash is refused.
- [x] A bundle with no `bundleType`, of either kind, is refused, naming the field. An
      installed extension without it is turned off and named, and the site starts.
- [x] Simple Redirects, Entra, the templates and the Bundle Editor's downloads are
      marked `"extension"`.
- [x] The old commands name their replacements and do nothing, `import` and
      `bundle export --source` included.
- [x] The template seeds are site packages, and new sites from every template start
      with their components.
- [x] `site runs` lists every run with its kind; an extension's content is reverted by
      `bundle uninstall --revert-content`.
- [x] A CLI and a remote that read no common bundle format are refused before
      anything is built, saying which to upgrade.
- [x] `bundle build <name>` builds a Bundle Editor definition as an extension, and
      `bundle check` validates an extension package.
- [x] A check of a site package lists the config and `package.json` first, flagged.
- [x] No back-office text calls a site package a bundle.
- [x] `bundles.md` and the CLI help describe site packages apart from extensions.
