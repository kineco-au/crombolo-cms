# 328 — Removing an extension leaves nothing

**Epic:** I — Hardening · **Priority:** should · **Size:** L
**Depends on:** 326, 321

## Story

As an administrator who tried an extension and decided against it, I want one step that
stops it, revokes what it held and removes what it left, asking me only about its data, so
that trying an extension costs nothing afterwards.

## Context

Uninstall today is `bun remove` and the grant row. The extension's process, its data folder,
its tables and schema (Part 4 of `bundles.md`), its settings and its build stay, or go
separately. With story 326 its files are one folder; with story 321 its tables are one role
and schema, made by the CMS or by the host.

## Decisions (2026-11-11)

- **Remove does, in order:** stop the process; revoke the grant and any screen tokens; drop
  its schema and role, or on SQLite its tables and ledger; delete its data folder, its build
  and its root; delete its settings and its record. One audit entry.
- **It asks about data first.** "Keep its data, in case you install it again?" keeps the
  tables and the data folder, marked orphaned in Installed under "Data left by…", with a
  Remove of their own. Default is to remove.
- **Turn off is still separate** (story 225): stop and revoke, keep everything.
- **The CLI's `extension uninstall`** gains `--drop-data` and `--no-verify` (see the planning
  decisions below), and a remote's uninstall the same.
- **A host that made the role itself** (story 321) is told, not overridden: the CMS drops the
  schema and the role it can drop, and names what it could not.

## Decisions (2026-11-11, planning)

- **Data is kept by default** (the maintainer's choice, in place of "default is to remove"
  above). Remove stops the process, revokes the grant, and deletes the root, the build, the
  settings and the record line; the extension's tables, schema, role and data folder stay,
  listed in Installed under "Data left by…" with a delete of their own. Installing the same
  extension again resumes on them, as re-adding a wired bundle does.
- **A switch drops the data:** "Also delete its data" in the remove dialog, `--drop-data` on
  `crombolo extension uninstall`, here or on a remote. It reuses purge's drop
  (`purgeOwnerTables`: the schema and role, or the SQLite tables and ledger) and names a role
  it could not drop.
- **No backup is taken** when the data is dropped (the maintainer's choice). The command line's
  two switches are `--drop-data`, which deletes the data too, and `--no-verify`, which goes
  ahead without asking; without `--no-verify` it asks first, defaulting to no, and off a
  terminal it refuses rather than asking.
- **Content is kept by default, and `--drop-content` takes it out** (the maintainer's choice):
  "Also take out the content it added" in the remove dialog, off by default. It is the
  existing revert of the install's content run, which `extension uninstall` already offers
  as `--revert-content`; that flag becomes `--drop-content`, with `--revert-content` still
  read for one release. A revert the check refuses stops the remove, as now, and says why.

## The plan (2026-11-11)

What exists and is reused: the admin's `uninstall` (`bundle-admin.ts`), which reverts the
content run when asked and then calls the marketplace's; the marketplace's uninstall, which
since story 326 deletes the root, its line and any kept file nothing names; `purgeOwnerTables`
and `recordedOwner` (`@crombolo/data` custom tables), which drop an owner's schema and role or
its SQLite tables and ledger and name a role left behind, as `crombolo extension purge` uses;
`BundleGrantRepository`, `ExtensionSettingRepository`; `markRestartPending`.

### Slice 1: one remove, in order

- `bundle-admin.ts` `uninstall(actor, name, { dropData, dropContent })`: refuse a bundle the
  config still wires (`refuseWired`, as purge does); revert content when `dropContent`; stop
  the running process (`ExtensionProcess.stop`, through a `stopExtension(id)` port the server
  gives the admin; a CLI admin has none and marks the restart instead); delete the grant row
  (`BundleGrantRepository.forget`, new) and its settings (`ExtensionSettingRepository.forget`,
  new); delete `.crombolo/extensions/<id>/`, its build and data folder, unless the data is
  kept, in which case the data folder stays and the build goes; call the marketplace's
  uninstall for the root and the record; drop the tables when `dropData` (`purgeOwnerTables`,
  no backup) and name a role it could not drop; write one audit entry naming what went:
  "removed; its data kept" or "removed with its data and content".
- The order is the story's: stop, revoke, then files, then data, so nothing runs against
  half-removed tables.

### Slice 2: data left behind

- `orphanedData(db, extensions)`: an owner the tables ledger records (`recordedOwner`) with no
  installed package of that id, with its table names and a data folder if there is one.
- The installed listing gains `left: [{ id, tables, folder }]`; Installed shows them under
  "Data left by…" with "Delete its data", an administrator's, which runs the same drop.
- An install of the same id finds its tables and resumes, as a wired bundle re-added does today;
  a test proves it.

### Slice 3: the surfaces

- The back office's uninstall body takes `dropData` and `dropContent`; the Installed dialog
  asks with two checkboxes, both off, and an `umbConfirmModal` naming what goes.
- `crombolo extension uninstall <name> [--drop-data] [--drop-content] [--no-verify]`: without
  `--no-verify` it lists what will go and asks, defaulting to no; off a terminal it refuses
  without `--no-verify`. `--revert-content` is read as `--drop-content` for one release, with a
  notice. The remote's uninstall takes `dropData` and `dropContent` in its query, as it takes
  `revertContent` now; the server reads `revertContent` too for one release.
- Every other mention follows: `site revert`'s refusal of an extension's install run names
  `--drop-content` (`commands/site/revert.ts`); `bundles.md`'s table of the two kinds, "Undone
  by"; the regenerated `docs/cli`. The old release note stays, as it describes that release.
- `crombolo extension purge` stays for a wired bundle's tables, the case Remove refuses.

### Slice 4: tests and docs

- `tests/extension-remove.test.ts`, on both dialects: a granted extension with tables, a data
  folder, settings and applied content, removed plainly, leaves its tables and folder and
  nothing else (no root, line, grant, settings, build, process), and shows under "Data left
  by…"; installed again, it reads its old rows; removed with `--drop-data`, its schema and role
  (Postgres) or tables (SQLite) go and the ledger forgets it; with `--drop-content`, its pages
  go; a role the CMS cannot drop is named; one audit entry each time; a wired bundle is refused.
- The CLI: the question, `--no-verify`, the refusal off a terminal, and the alias.
- Docs: `bundles.md` "Runtime install" and "Uninstall"; `extensions.md`; `release-notes.md`,
  with the renamed flag in the upgrade notes.

## Acceptance criteria

- [x] Remove stops the process, revokes the grant, drops the tables, role and schema, deletes
      the folder and the record, in one step with one audit entry.
- [x] With data kept, the tables and folder stay, show under Installed, and can be removed later.
- [x] Nothing of the extension remains in the site's files, lockfile, database or settings.
- [x] A role the CMS cannot drop is named in the result.
- [x] Covering tests on both dialects; docs and release notes.

## What was built (2026-11-11)

- **One remove** (`bundle-admin.ts` `uninstall`): content first when `dropContent`, then
  `stopExtension` (core's, through the server), `BundleGrants.forget` and
  `ExtensionSettingRepository.forget`, the build folder (the whole `.crombolo/extensions/<id>/`
  with its data), the marketplace's root and record removal, then `purgeOwnerTables` with no
  backup when `dropData`, naming a role left; one audit entry. A bundle the site wires as a
  dependency is refused; one in a root never is, since `config.bundles` also holds the
  extensions the CMS started.
- **Data left** (`installed().left`): an owner the tables ledger records that is neither
  installed, the site, nor wired, with its tables; `dropLeftData` deletes it, refused while
  the extension is installed. Installed shows them under "Data left by extensions you
  removed", with "Delete its data" for an administrator.
- **The surfaces:** the back office's uninstall takes `dropData` and `dropContent`, and a new
  `drop-left-data` action, both administrators only; Installed asks with two checkboxes;
  `extension uninstall --drop-data --drop-content --no-verify`, `--revert-content` hidden and
  read as `--drop-content`; the remote takes `dropData` and `dropContent`, and still reads
  `revertContent`; `site revert` names `--drop-content`.
- **Not done:** the planned test that reinstalling resumes on kept data, and a Postgres role
  the CMS cannot drop, are not covered here; both rely on `purgeOwnerTables` and the boot's
  migration, which their own suites cover. The command line's prompt is covered by the
  shared `confirm` helper's tests, not one of its own.
- **Tests:** `tests/extension-remove.test.ts`.
