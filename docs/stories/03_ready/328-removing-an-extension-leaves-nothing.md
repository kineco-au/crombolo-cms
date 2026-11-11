# 328 — Removing an extension leaves nothing

**Epic:** I — Hardening · **Priority:** should · **Size:** M
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
- **Open:** whether Remove also takes out the content the install applied.

## Acceptance criteria

- [ ] Remove stops the process, revokes the grant, drops the tables, role and schema, deletes
      the folder and the record, in one step with one audit entry.
- [ ] With data kept, the tables and folder stay, show under Installed, and can be removed later.
- [ ] Nothing of the extension remains in the site's files, lockfile, database or settings.
- [ ] A role the CMS cannot drop is named in the result.
- [ ] Covering tests on both dialects; docs and release notes.
