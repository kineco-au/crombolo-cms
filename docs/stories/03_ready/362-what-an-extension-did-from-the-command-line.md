# 362 — What an extension did, from the command line

**Epic:** P — The command line · **Priority:** could · **Size:** S
**Depends on:** 349, 352

## Story

As an administrator, I want to read what an extension did from the CLI, so that
checking an extension's activity can be scripted.

## Context

Story 349, G15. Installed → an extension's activity (story 327) lists what it did,
newest first, by kind and by the person it acted for, with what its grant
refused, and exports it. `extension list` doesn't show it.

## What is there to build on

- **The store** is `ExtensionActivityLog` (`packages/data/src/extension-activity.ts`):
  - `page(extensionId, filter, { before, limit })`, newest first, with `next` as the
    cursor;
  - `counts(extensionId, since)` and `people(extensionId)`, for the screen's counts
    line and its Person picker;
  - the filter is `kind`, `person` (a user's key, or `itself`), `since` and `until`.
    The kinds are `ACTIVITY_KINDS`.
- **The screen's endpoint** is in `packages/server/src/server.ts`, under the
  extensions API: `installed/{id}/activity`, `…/activity/summary` and
  `…/activity.csv`.
  - It needs the Settings section, as every extensions call there does. It does not
    need an administrator, so neither does this command, whatever the story's "As an
    administrator" says.
  - It flushes the recorder (`core.activity.flush()`) first, so the last second's
    rows are in.
  - `readActivityQuery` and `activityCsv` (`packages/server/src/extension-activity.ts`)
    read the query and write the file. `since` and `until` are already taken, though
    the screen never sends them.
- **The words** are `activitySentence`, `countsLine` and `personWords`
  (`packages/backoffice-host/plugin/bundles-activity-words.js`). They are pure and
  already tested (`tests/extension-activity.test.ts`). The package doesn't export
  the plugin folder, so the CLI can't import them yet.
- **An extension is named by its id.** Rows carry the bundle's `id` (`[a-z0-9-]+`),
  not the npm `packageName` that `extension list` prints and `extension uninstall`
  takes. `BundleAdmin.setEnabled` already takes either. A removed extension's rows
  stay until they are pruned, so only its id finds them.
- **`-o` takes only `text` and `json`.** `BaseCommand.baseFlags.output`
  (`packages/cli/src/base.ts`) is global. So `-o csv`, as the criterion had it,
  isn't there to use; see D2.
- **`audit list` is the model** (`packages/cli/src/commands/audit/list.ts`,
  `support/audit.ts`): `--since`, `--until` and `--user`, a page at a time with
  `--limit` and `--before`, `next` in JSON, and "More: --before N" in text. Locally it
  reads the database; with `--profile` it uses the `audit` capability.
- **`bundle-manage` doesn't fit as it is.** The `extension` commands reach a hosted
  site through it (`support/bundles.ts`, `remoteBundles`), and `manageBundles` in
  `packages/server/src/remote.ts` answers `installed` and `installed/{name}/…`.
  - Its read rule is the remote Pull permission, which a CI identity can hold. It
    isn't the screen's Settings section.
  - `createRemote` gets the `BundleAdmin` but not the activity recorder, so it can't
    flush.
  - An older site lists `bundle-manage` but would answer `installed/{id}/activity`
    with a 405, or "not at this level", rather than anything the CLI could explain.
- **A CI identity holds no section** (`allowedSections: []`, `remote-ci.ts`). A Settings
  check refuses it on its own; the route still says why plainly.

## Decisions

- **D1: how `--profile` reaches a hosted site's activity.**
  - (a) a capability of its own, `extension-activity`, with routes
    `GET environments/{id}/installed/{ext}/activity`, `…/activity/summary` and
    `…/activity.csv`, answered before `manageBundles`. The rule is the screen's:
    Settings, as the signed-in person, with a CI identity refused.
    *Recommended:* it is 353's D1 pattern. The rule is the back office's, not the
    Pull permission. An older site is told apart by its discovery document, so the
    CLI can say it needs upgrading.
  - (b) the same routes inside `manageBundles`, under `bundle-manage`, with its
    rule (Pull, or a change permission). Less to document, but a CI job holding Pull
    reads who did what. An older site answers 405, and the CLI can only guess why.

  **Decided 2026-11-15: (a).**
- **D2: how the screen's export is asked for.**
  - (a) `--csv` on this command. It writes every row the filters match as the
    screen's file, to stdout, or to `--file <path>`. *Recommended:* only this command
    writes CSV, so it stays out of the global flag. The file is the server's own
    `activityCsv`, so the screen and the CLI give one format.
  - (b) `csv` added to the global `-o`. It matches the criterion's wording, but
    every command's help would then offer a format that only one of them writes,
    and the base would have to refuse it for the rest.

  **Decided 2026-11-15: (a).**

## Plan

1. **A shared core**, in `packages/server/src/extension-activity.ts`, used by the
   screen's endpoint, the remote routes and the local command:
   - `answerActivity(db, { flush, days }, id, part, search)`. It is what the
     `server.ts` branch does today (the query, the flush, then a page, the summary or
     the CSV), moved out so the endpoint calls it unchanged.
   - `--user` is resolved here, so a hosted site and this one agree. The `person`
     query takes a key, `itself`, an e-mail or a login, looked up through
     `UserRepository`, and an unknown one is answered "There is no user …".
2. **The command**, `extension activity <extension>`, in
   `packages/cli/src/commands/extension/activity.ts`, with `access: 'site'` and the
   Settings section, as `extension list` has. It is not `adminOnly`, as the screen
   isn't.
   - `<extension>` is the id or the package name. It is resolved through
     `installed()`, and failing that, read as an id, so a removed extension's
     remaining activity can still be read.
   - Flags:
     - `--kind`, in the screen's words: `changes`, `reads`, `requests`, `data`,
       `calls`, `screens` and `refused`, mapped to the stored kinds;
     - `--user <who>`, or `itself`;
     - `--since` and `--until`, read as `audit list` reads them;
     - `--limit` (default 50, as the screen) and `--before <cursor>`;
     - `--csv` and `--file` (with D2 (a));
     - `profileFlags`.
   - Text output:
     - first the counts line, `countsLine(summary.counts)` and "in the last 14 days";
     - then one line per row: when, `personWords`, `activitySentence`, and refused
       rows marked as refused;
     - "Nothing recorded." when there are none, and "More: --before N" when there
       is another page.
   - `-o json` gives `{ summary, items, next }`, with the stored kind and full dates.
   - Locally it reads the site's database through `ExtensionActivityLog`. It can't
     flush a running server, so up to a second of the newest rows may not be there
     yet; the description says so.
3. **The words**, shared with the screen: `./activity-words` is added to
   `@crombolo/backoffice-host`'s exports, pointing at
   `plugin/bundles-activity-words.js`, so the CLI words a row as the screen does.
4. **Remote routes** (with D1 (a)):
   - `RemoteOptions` gains `activity?: { flush(): Promise<void>; days: number }`,
     passed from `server.ts` (`core.activity`, `config.extensionActivityDays`);
   - the routes call `answerActivity`;
   - discovery lists `extension-activity` when it is given;
   - a CI identity is refused with "Reading what an extension did needs a person";
   - `packages/remote-conformance` checks the capability: a page, the summary and
     the CSV;
   - `support/bundles.ts` gains `remoteActivity(site)`. A site whose discovery lacks
     the capability is refused with "This site needs a newer crombolo to show what an
     extension did."
5. **Docs.**
   - `docs/extensions.md`, "Watching one": the command, its filters and the export;
   - `docs/remote-protocol.md`: the routes and the capability;
   - `bun run cli:spec`;
   - the release notes under Unreleased.
6. **Tests.**
   - `tests/extension-activity.test.ts` gains the shared core:
     - a page, the summary and the CSV, through `answerActivity`;
     - `person` by e-mail and by login, and an unknown one;
     - the existing endpoint still answering the screen unchanged.
   - `tests/extension-activity-cli.test.ts`, for the command, with rows recorded
     through `ExtensionActivityLog.record`:
     - locally: each `--kind`, `--user` by e-mail and `itself`, `--since`, two pages
       through `--before`, `--csv` matching the screen's file, `-o json`, and an
       extension named by its package name and by its id;
     - through a test server with `--profile`: the same page and CSV, a person
       without the Settings section refused, a CI identity refused, and a site
       without the capability told it needs upgrading.
   - `tests/remote-conformance.test.ts` runs the new checks.
   - SQLite only: no table or column changes, only reads through the existing store.
   - No browser tests. The screen is unchanged, and its endpoint is covered by the
     core's tests.

## Acceptance criteria

- [ ] `crombolo extension activity <id> [--kind <kind>] [--user <user>] [--since
      <time>]`, a page at a time, with `-o json`, and the screen's export as CSV through
      the flag D2 settles (`-o` takes only text and json today)
- [ ] It takes `--profile`, as the other `extension` commands do
- [ ] Tests locally and through a test server
- [ ] The CLI reference regenerated
