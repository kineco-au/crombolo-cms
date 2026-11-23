# 405 — User groups defined from outside the site

**Epic:** Users and access · **Priority:** should · **Size:** L
**Depends on:** 338, 389

## Story

As a directory that keeps one definition of each user group for every environment of a
site, I want to be the only one who defines a site's groups, so that each environment's
groups are the same everywhere and nobody changes one in a back office.

## Context

Story 389 manages users and who is in each group from outside the site
(`users.managedBy`), but a group's definition, its sections, levels and verbs (`338`),
start nodes, languages and per-item permissions, is still edited in the back office. A
host keeping one definition per group can't stop an environment drifting from it.

## The design

- **Its own setting:** `groups.managedBy` / `CROMBOLO_GROUPS_MANAGED_BY` (API client ids)
  and `groups.managedAt` / `CROMBOLO_GROUPS_MANAGED_AT` (an address with `{alias}` or
  `{key}`), beside 389's `users.*`, read at boot only. Either may be set without the
  other.
- **Only a managing client defines a group:** creating, updating and deleting one, every
  part of it (name, alias, icon, sections, each area's level and verbs, Custom's verbs,
  start nodes, languages, per-item permissions), through the Management API, the remote
  protocol and the command line alike. Anyone else is refused (403, "Managed outside this
  site"). Who is in a group stays 389's.
- **The back office shows groups read-only,** saying where they are managed, with a link
  to `groups.managedAt` for each group.
- **Items not here yet:** the managing client names start nodes and per-item permissions
  by item key.
  - A per-item permission is kept by key already, and takes effect when the item arrives.
  - A start node whose item is not here is held by key (`start_content_key`,
    `start_media_key`, `start_element_key`, a migration). Until the item arrives the group
    has no start there, so its people see none of that tree, never all of it. When the
    item arrives, the start node is set. The group's view says which are waiting.
- **A change, promotion or bundle that carries a group definition is refused** (409,
  "This site's user groups are defined outside it") while groups are managed, so a
  source leaves groups out. Its `check` refuses the same way.

## Acceptance criteria

- [x] With the setting, a managing client creates, updates and deletes groups; anyone
      else, the back office included, is refused
- [x] Every part of a group is set by the client, Custom's verbs included
- [x] The back office shows groups read-only, linking to `managedAt`
- [x] A start node naming an absent item is held: the group sees none of that tree, and
      the start node applies when the item arrives; its view lists it as waiting
- [x] A per-item permission naming an absent item applies when the item arrives
- [x] A change, promotion or bundle carrying a group definition is refused, its check too
- [x] Without the setting, nothing changes
- [x] The migration names the release it ships in; every test rewind undoes it
- [x] `docs/` (users and groups, configuration) says so

## Decisions (2026-11-23, the maintainer's)

- Its own setting, `groups.managedBy` and `groups.managedAt`, beside `users.*`.
- A start node naming an absent item is held by key and applied when it arrives.
- A change or bundle carrying group definitions is refused, not stripped.

## Implementation

- `groups` (`GroupsSetting`, `groupsManaged`) in `packages/server/src/config.ts`, from the
  config file or `CROMBOLO_GROUPS_MANAGED_BY` / `CROMBOLO_GROUPS_MANAGED_AT`, checked at
  boot; listed in `settings.ts`.
- `managedUserPorts` (`packages/server/src/managed-users.ts`) takes the groups' clients:
  a group's create, update and delete answer `ManagedOutside` for anyone else, wherever
  asked. `managedGroupHref` fills `managedAt`.
- Migration 095 (`AddGroupStartKeys`): `UserGroupRepository.save` with `holdStartNodes`
  keeps a start node whose item is missing by key; reading a group returns it with
  `waiting` while the item is absent. Access already resolves start nodes by key, so an
  absent one gives no start and an arrived one applies.
- The back office: `users-managed.js` excludes the group actions (`GROUPS_HIDDEN`) and adds
  "Open where this group is defined"; `<plugin>/api/users-managed` answers
  `groupsManaged`, `groupsLinked`, and `?group=<key>` its link and waiting trees.
- A bundle: `groupsManaged` in the check's options raises `groups-managed`. A change:
  `stage` refuses one carrying `schema/user-groups/` files (none do until story 162).
- Tests: `tests/groups-managed.test.ts`, `tests/users-managed.test.ts`.
