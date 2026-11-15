# 360 — Search and sharing settings from the command line

**Epic:** P — The command line · **Priority:** could · **Size:** S
**Depends on:** 349

## Story

As a site owner, I want to set the site-wide search and sharing values from the
CLI, so that a scripted site starts with its title, description, robots file
and not-found page in place.

## Context

Story 349, G13. Settings → Search & sharing holds the values every page falls
back to, the robots file and the page shown for an address that doesn't exist.
Each starts from the site's configuration, and a value saved there overrides it.
The CLI sets none of them.

## What is there to build on

- **The settings live in `packages/server/src/seo.ts`**, inside `createSeoHost`:
  - `settings()` resolves each field: a saved value, then `seo` in
    `crombolo.config.ts` (or its environment variable), then the default. It
    answers the effective values, the overrides and each field's source
    (`backoffice`, `config` or `default`);
  - `parseSettingsBody` checks what a save sends, and is what refuses a
    malformed value;
  - the `PUT settings` branch of `handle` merges the changes into what is
    saved, a `null` removing a field, and writes it.

  Both read and write only `db` and `config`, but they sit inside a host that
  also needs the published cache, so the CLI cannot call them as they are. They
  move out as two exported functions the host then calls (below).
- **The fields** are `indexable`, `sitemap`, `siteName`, `titleSuffix`,
  `defaultImage`, `notFoundPage` and `robotsTxt`, the names `crombolo.config.ts`
  uses. The screen (`packages/backoffice-host/plugin/seo/dashboard.js`) sets:
  - the sharing image as a media item's key, though the server takes any address;
  - the not-found page as one page used everywhere. Rules per hostname or
    language come only from the configuration, and choosing a page there
    replaces them, which the screen says.
- **Where they are kept:** JSON in `key_value` under `Crombolo.Seo.Settings`.
  A node trusts what it read for ten seconds, so a running site picks up a
  change the CLI writes within that, as it does another node's.
- **A saved value does not travel.** No site package, bundle, push or pull
  carries `key_value`. Site data (story 189) is the site's and its bundles' own
  tables. Only a database backup and restore takes it along. So `seo set`
  changes this site's database only. A value every copy of a site should start
  with belongs in `crombolo.config.ts`, which is committed. The docs say so, and
  `seo set` is still the way to change a live value without a deploy. This is why
  360 is local only (story 349, D2): a hosted site is changed in its back office
  or by its configuration.
- **`pages.notFound` in the configuration wins over `notFoundPage`**
  (`server.ts`, the not-found path). The screen doesn't say so. `seo show`
  should, or a saved page appears to do nothing.
- **Audit.** The back office's save is audited by the generic plugin-route
  entry (`auditPluginWrite` with `pluginAuditPlan`, `adapters/audit.ts`):
  category `settings`, action `Save`, entity `SeoSettings`. A command's
  `static audit` (`base.ts`) writes the same entry, naming the signed-in person
  through `signedIn()`.
- **Access.** The routes need the Settings section (`hasSection(principal,
  'settings')`), not an administrator, so each command is `access: 'site'`,
  `section: 'settings'`.
- **Resolving names.** `resolveNodeRef` (`@crombolo/data`) turns a page or media
  path, or a key, into its node, as `content show` and `media move` use it.
- **Tests to build on:** `tests/seo-server.test.ts`, "site-wide settings" and
  "addresses nothing answers", already drive the screen's routes and check the
  head and `/robots.txt`.

The first criterion is extended: a value can also be the default, neither
configured nor saved, and `seo show` says which of the three it is.

## Decisions

None. The command follows the screen. The field names are the configuration's.
The not-found page is one page, as on the screen. Any rules per hostname or
language stay in the configuration.

## Plan

1. **Settings without the host**, in `packages/server/src/seo.ts`:
   - `readSeoSettings(db, config)`: what `settings()` answers today, the
     effective values, the overrides and each field's source;
   - `saveSeoSettings(db, config, changes)`: parses `changes` with
     `parseSettingsBody`, merges them into the saved overrides as the `PUT` does
     (a `null` removes one), writes them, and answers `readSeoSettings`;
   - `createSeoHost` calls both, keeping its ten-second memo, so the screen and
     the CLI share the same rules and refusals.
2. **`crombolo seo show`**, `access: 'site'`, `section: 'settings'`:
   - each field on a line, with its value and "saved", "from the configuration" or
     "default";
   - the sharing image and the not-found page named by their path as well as
     their key; a page or image that no longer exists says so;
   - `pages.notFound` set in the configuration: "The site's configuration
     chooses the page for addresses that don't exist, so this one is not used";
   - rules per hostname or language listed as the configuration gives them;
   - the robots file in full, under its own heading;
   - `-o json`: `{ effective, saved, sources }`.
3. **`crombolo seo set <field> [<value>] [--file <path>]`**, the same access, `static
   audit = { category: 'settings', action: 'Save', entityType: 'SeoSettings' }`,
   with the field as the entry's key:
   - the configuration's field names, any case. The kebab-case forms are taken too
     (`site-name`, `robots-txt`);
   - `indexable` and `sitemap` take on/off, yes/no or true/false;
   - `defaultImage` takes a media path or key, stored as the key as the screen
     does, or an address beginning with `/` or `http`;
   - `notFoundPage` takes a page path or key, stored as one rule for everywhere.
     When the configuration has rules per hostname or language, it says these
     are replaced, as the screen does;
   - `robotsTxt` takes the value or `--file`, and `--file` is refused for any
     other field;
   - it goes through `saveSeoSettings`, so a malformed value is refused in the
     server's words, and prints the field as it now stands.
4. **`crombolo seo unset <field>`**: saves `null` for it, says what applies now
   (the configuration's value or the default), and changes nothing when nothing
   was saved (`changedNothing`, no audit entry).
5. **Words.** "Saved here", "From the site's configuration", "Default", as the
   screen says them. No "override" or "key_value".
6. **Docs.**
   - `docs/seo.md`, "Site settings": the commands, and that a saved value
     stays with the site's database while the configuration travels with the code;
   - `docs/operations.md`, the command access table (Settings);
   - `bun run cli:spec`;
   - the release notes under Unreleased.
7. **Tests.**
   - `tests/seo-settings.test.ts`, for `readSeoSettings` and `saveSeoSettings`:
     sources across saved, configured and default, a `null` removing one, and a
     malformed value refused;
   - `tests/seo-cli.test.ts`, for the commands:
     - `seo show` with a configured, a saved and a default field, and `-o json`;
     - `seo set` on each field, including `--file`, an image and a page by path,
       and a bad value refused;
     - `seo set notFoundPage` over configured rules, and `pages.notFound` reported;
     - `seo unset` back to the configuration, and again when nothing is saved;
     - the audit entry, naming the signed-in person;
     - at `sign-in`, a person without Settings refused;
     - against a test server started after the change: the page head carries the
       saved title suffix and site name, `/robots.txt` the saved rules, and an
       unknown address the saved page with a 404. The server is started after the
       write, or its ten-second memo would hide the change.
   - The existing `tests/seo-server.test.ts` still passes, since the screen's
     routes now go through the moved functions.
   - SQLite only: no table or column changes, only a `key_value` row that
     already exists.
   - No browser tests: the screen is unchanged.

## Acceptance criteria

- [x] `crombolo seo show` lists each value, and whether it comes from the
      configuration, was saved, or is the default
- [x] `seo set <field> <value>` saves the same override the screen saves, `--file`
      reading the robots file from a file
- [x] `seo unset <field>` removes the override, so the configuration applies again
- [x] `-o json`; audited
- [x] Tests for each, and that the page head and `/robots.txt` follow
- [x] The CLI reference regenerated

## Built

- `readSeoSettings(db, config)` and `saveSeoSettings(db, config, changes)` in
  `packages/server/src/seo.ts` hold what `settings()` and the `PUT settings` branch
  did; `createSeoHost` calls both, keeping its ten-second memo, and after a save
  keeps the settings the save answered. The screen and its routes are unchanged;
- the commands are `seo show`, `seo set` and `seo unset`
  (`packages/cli/src/commands/seo/`), over `packages/cli/src/support/seo.ts`, each
  `access: 'site'`, `section: 'settings'`, on this site's database only;
- `docs/seo.md`, "From the command line", the access table in
  `docs/operations.md`, the CLI reference and the release notes;
- tests: `tests/seo-settings.test.ts` (the two functions), `tests/seo-cli.test.ts`
  (the commands, the audit entry, sign-in, and a server started after the
  change) and an addition to `tests/cli-access.test.ts`. **The tests are written
  but not yet run:** the maintainer runs the full suites once, at the release.
  `bun run check` passes.

Where it differs from the plan, or fills it in:
- **JSON names the sources `saved`, `config` and `default`,** matching its `saved`
  object, rather than the routes' `backoffice`. `seo set` and `seo unset -o json`
  give `{ field, value, source }`, the field as it now stands.
- **A path beginning with `/` for `defaultImage` is tried as a media item first;**
  when none is there it is kept as an address, with a warning saying so. A value
  that is neither a media item, nor `/…` nor `http…`, is refused as not found.
- **A bad on/off word reaches `saveSeoSettings` as given,** so it is refused in the
  server's words ("indexable must be true or false."), as a usage error; any other
  refusal from the save is a usage error too.
- **`seo set` audits even when the value is unchanged;** only `unset` with nothing
  saved writes no entry.
- **The replaced-rules notice goes to stderr,** so `-o json` stays clean.
