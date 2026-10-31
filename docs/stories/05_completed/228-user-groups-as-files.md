# 228 — User groups a site declares in files

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 028

## Story

As a developer whose site has an approval workflow, I want the user groups its
stages name declared beside the workflow, so that every environment, a new
demo site included, has them without anyone making them by hand.

## Context

Found 2026-10-31, planning a magazine demo whose sub-editors and editors approve
articles. A workflow's stage names user groups by alias (`docs/workflows.md`),
and approval workflows are files in `schema/workflows/`. User groups are rows
only: made in Users, travelling only in a sealed export with `--with-users`.
So a site built from files, or a template, has workflows naming groups nobody
has made.

## Decisions (2026-10-31)

1. **They live in `schema/user-groups/*.toml`, synced as types are.** Beside
   `schema/workflows/`, which names them: applied at every boot by the schema
   sync, reviewed in a pull request, carried by bundles and site files. A
   group's alias is its identity. Not chosen: seed files, which an environment
   built without its seed never gets; the config, the one part of the content
   model outside `schema/`.

2. **A file holds what a group is, not where it starts.** Its alias, name,
   description, icon, sections, permission verbs and languages (or all). Start
   nodes and per-page permissions stay the Users section's on each environment:
   they name content, which differs between environments. Members are never in
   a file. Not chosen: everything but members, which refers to content that may
   not be there; the alias and name alone, which leaves a new site's groups
   unable to open a section.

3. **Edited as types are, field by field.** The fields the file owns (name,
   description, icon, sections, permission verbs, languages) are written back
   to the file by the Users section in development, and read-only there in
   production, where it says the group comes from the site's files. Start
   nodes, per-page permissions and members are the environment's: editable in
   Users everywhere, production included, and never written to the file.
   Groups made in Users without a file are unchanged. Not chosen: the file
   winning at the next boot, which silently undoes a production edit; the
   back office's edit standing, which stops the file describing the group.

## Plan

1. **The format** (`packages/schema`): `schema/user-groups/<alias>.toml`,
   `[user-group]` with `alias`, `name`, `description`, `icon`, `sections`,
   `permissions` (Umbraco's verbs and Crombolo's) and `languages` (ISO codes,
   or `"all"`); parsed and written back canonically, and refused on an unknown
   section or verb, or the built-in `admin`.
2. **The sync** (`packages/schema/src/sync.ts`, `UserRepository`): a declared
   group is created when missing and its file-owned fields set at every boot,
   by alias; its start nodes, per-page permissions and members are left alone.
   A group whose file is removed stays, as a user-made group, rather than
   taking its members' access away by surprise. The schema hash covers the
   files, so production's version bump rule applies to them.
3. **The Users section** (Management API user-group handlers): a group from a
   file says so (`fromFiles`); in production a change to a file-owned field is
   refused naming the file, the other fields saved; in development a save
   writes the file back through the schema writer, as the type editor does.
4. **Workflows:** `docs/workflows.md` points at it; a workflow naming a group
   no file declares and no row has is left to story 229's check.
5. **Tests** on both engines: parse, write, export round trip; a boot creating
   and updating a group and keeping its start node and members; production
   refusing a file-owned field and saving a start node; development writing
   the file back; a bundle and a site file carrying the group.
6. **Docs:** `docs/schema-as-code.md` (a row and a section), `docs/workflows.md`,
   the release notes.

## Acceptance criteria

- [x] A group declared in files exists on every environment the site boots in,
      with what the file says, and a workflow naming it works there.
- [x] Editing it follows the decision above, and the back office says when a
      file owns it.
- [x] No user or member is ever written to or read from those files.
- [x] `docs/workflows.md` and `docs/schema-as-code.md` document it; tests on
      both engines.

## What was built

- **The format** (`packages/schema/src/user-groups.ts`): `parseUserGroup` and
  `writeUserGroup`, `SchemaSet.userGroups`, loaded from `schema/user-groups/`
  and in the schema hash only when there are any, so no existing site's hash
  moves. `KNOWN_PERMISSIONS` in `@crombolo/core` is every verb a group can hold.
- **The sync:** `UserGroupRepository.syncDeclared` (create or update by alias,
  keeping start nodes and per-page permissions, writing only a change), called
  by the schema sync beside workflows; `SyncReport.userGroups`. A language the
  site does not have stops the sync. Removing a file leaves the group.
- **The Users section** (`packages/server/src/adapters/users.ts`): a declared
  group is not deletable and its alias not changeable; outside development a
  save that changes a file-owned field answers `DeclaredInFiles` (409, naming
  what to do); in development it saves and writes back to the file it came
  from (`declaredGroups` in `ports.ts`, gated on `schemaWritable`).
- **Carried:** bundles and site files take `schema/user-groups/` with the rest
  of `schema/`.
- **Tests:** `tests/user-groups-files.test.ts`.
- **Docs:** `docs/schema-as-code.md` (the table and "User groups"),
  `docs/workflows.md`, the release notes; story `162` narrowed to what is left.
- **Not built:** a notice on the group's screen in the vendored back office;
  the refused save's message and the hidden delete and alias controls say it.
