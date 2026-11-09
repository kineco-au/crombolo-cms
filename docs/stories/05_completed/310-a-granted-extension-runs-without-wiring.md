# 310 — A granted extension runs without wiring

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** 309

## Story

As someone installing an extension, I want it to run once I have granted it, with
no import to add to the site's code, so that installing one is one step and its
options are set where I can see them.

## Context

An extension's server half runs only when `crombolo.config.ts` imports its factory
and lists it in `bundles` (story 225). `bundle install --wire` writes those lines,
and a remote never does. The config import was the only real gate, and story 309
makes the grant the gate.

## Decisions (2026-11-09)

- **The config names what it grants:**
  `extensions: { redirects: { grant: ['redirects.read', 'redirects.write', 'content.read'] } }`.
  - That grant is "Developer installed" (story 309).
  - A version asking for more than the config names is off until the config is
    changed and deployed, or an administrator grants it. A dependency bumped in
    `bun.lock` therefore cannot widen what it may do unnoticed.
  - `http.outbound` origins and the `actAs` choice are named the same way:
    `{ 'http.outbound': ['https://api.acme.com'], actAs: 'installer' }`.
- **Starting at once is story 311's:** there an extension is a process started and
  stopped while the site runs. Until then, a grant made while the site runs marks a
  restart pending, as installing code does now.
- **Settings edited in the back office are kept in the database:** every node reads
  the same values, and a change applies at once and is audited. A value the config
  sets wins, and is shown locked.

## The design

- **Discovery:**
  - At boot, each dependency whose manifest declares a server half and is granted
    (story 309) is started.
  - The CMS imports the entry its manifest names (`crombolo.server`) and calls it with
    the extension's settings. It answers the `ServerBundle` it registers today:
    routes, events, jobs, forms, media and tables.
  - Nothing in the site imports it.
- **Settings:**
  - The manifest's `crombolo.settings` declares each one: a key, a label, a type
    (`text`, `number`, `boolean`, or `choice` with its values), a default, and
    whether it is a secret, stored sealed like a webhook's header.
  - The config sets values under `extensions.<id>.settings`, which lock them.
  - The back office edits the rest, under the extension's entry in Installed.
  - The extension reads them at start, and again when they change.
- **The config's entry:** `extensions.<id>` holds `grant` and `settings`, plain data
  checked at boot. An entry for an extension the site does not depend on is a boot
  error, naming it.
- **Remotes:** a grant made on a remote, by someone with "Install code on this
  site", turns the extension on there (story 309). That replaces "only a reviewed
  config change".
- **Retired:** `--wire`, `wireIntoConfig`, and `config.bundles` for installed
  extensions.
  - `config.bundles` stays for a bundle a host provides in code ("Bundles a host
    provides").
  - A site that still imports an extension and lists it in `bundles` starts, for one
    release. The boot warns that the import is no longer needed, and treats the
    entry as a developer grant of what it asks for.
- **Simple Redirects:** `redirects()` and its `section` option become a `section`
  setting, a choice of `settings` or `content`. Entra does the same with its
  options.

## Implementation plan

1. **The manifest:** `crombolo.settings` in `bundle-package.ts`, validated.
2. **Config:** `extensions` in `CromboloConfig`, checked at boot against what is
   installed, and the grants it names given to story 309's grant as "the site's
   code".
3. **Discovery** (`core.ts`): granted server halves are imported and their bundles
   built. The rest goes through `createServerBundles` as now. Host-provided
   `config.bundles` are merged in.
4. **Settings:** a migration adds an `extension_setting` table, keyed by bundle id
   and key, with secrets sealed. There is a repository, and Installed gains a
   Settings form generated from the manifest, with the locked values read-only.
5. **The CLI:**
   - `bundle install` loses `--wire`, and says the extension runs once granted and
     the site restarts.
   - `bundle settings <name> [key=value …]` reads and sets settings.
6. **The transition:** wired `config.bundles` entries for discovered extensions are
   recognised, warned about and deduplicated.
7. **Simple Redirects and Entra:** they export their entries, declare their settings,
   and the sites and templates in this repo list them in `extensions`.
8. **Docs:** `bundles.md` Part 3 rewritten around discovery, and the release notes
   cover the `extensions` entry and the retired `--wire`.

## Tests

- A granted extension answers its routes after a restart with no import, and an
  ungranted one does not.
- A config entry naming fewer permissions than the version asks for leaves it off,
  saying what is missing, and naming them turns it on.
- A setting the config sets is locked in the back office; another, edited there,
  reaches the extension.
- A site with the old import still starts, warns, and runs the extension once.
- `bundle install --wire` says the flag is gone.

## Acceptance criteria

- [x] An installed, granted extension answers its routes after a restart, with no
      change to `crombolo.config.ts`.
- [x] A value set in `extensions` is locked in the back office; others can be edited
      there, kept in the database.
- [x] The config's `extensions.<id>.grant` grants exactly what it names; a version
      asking for more is off until it names that too.
- [x] A site that still imports an extension starts, warning that the import is not
      needed.
- [x] `bundles.md` describes discovery, and no longer describes `--wire`.

## Implemented (0.57.0)

- **Discovery** (`packages/server/src/extension-discovery.ts`): before the boot,
  `readRecordedExtensions` reads the grants and saved settings. `startExtensions`
  imports each granted extension's server half from the site's own
  `node_modules`, calls its factory with its settings, and the boot merges what it
  returns into `config.bundles`.
- **The config:** `extensions.<id>` takes `grant`, `origins`, `actAs` and
  `settings`. `entryCovers` grants by code only when the entry names everything
  the installed version asks for. An entry for an extension the site has not got
  stops the boot (`extensionEntryProblems`). An import of a server half still
  works, with a warning (`wiredByImport`).
- **Settings:** `crombolo.settings` declares text, number, boolean and choice
  settings (`readSettings`). Migration 067 adds `extension_setting`. A value is
  the default, then the saved one, then the config's, which locks it; secrets are
  sealed with the site's key and never shown again. Installed has a Settings form,
  the `bundles/settings` endpoint saves it, and `crombolo bundle settings` sets
  them from the CLI.
- **Retired:** `bundle install --wire` and `support/wire.ts`. The Harbourstone sites
  and the templates grant through `extensions`. Simple Redirects and Entra declare
  a `section` setting.
- **Differences from the plan:**
  - Saved settings take effect when the site restarts, which the back office says.
    Starting an extension without a restart is part of 311.
  - `crombolo bundle settings` works on the local site only.
- **Tests:** `tests/extension-discovery.test.ts`, with the templates and sites tests
  updated and migration 067 undone in every rewind.
