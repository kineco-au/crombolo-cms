# 302 — A group's owners decide who is in it

**Epic:** I — Hardening · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an administrator, I want to decide what each group grants myself, and to let the
members of other groups decide who is in it, so that I can hand out the running of a
team without the Users section becoming a way into every page, every permission and
every language.

## Context

Today, as in Umbraco, someone with the Users section who is not an administrator can:
- create a group, and is added to it (`adapters/users.ts:985`);
- edit or delete any group they belong to (`isMember`, `:998`, `:1019`);
- add users to and remove them from any group they belong to (`addUsers`,
  `removeUsers`, `:1029`);
- put a user into any group they belong to (`mayAssignGroups`, `:169`), from the
  user screen (`update`, `setGroups`, `create`, `invite`).

Creating or editing a group (`validate`, `:851`) checks only their sections, and that
the content and media start nodes are within their own. It does not check the element
start node, root access, permissions (default, per page, per property, or remote), or
languages. So a Users-section user can give their own group root access, every
permission and every language. Where the site's remote takes structure and code, that
includes `ApplyStructure` and `InstallCode`.

Holding each of those fields to what the editor has is the obvious fix, but the
per-page permission rules make it intricate. It would also leave a way to give out
permissions nobody designed. Delegating membership instead of grants removes the
risk rather than containing it: only an administrator decides what a group grants,
and an administrator says who else may decide who is in it.

This is stricter than Umbraco, which lets the Users section manage groups.

## The design

- **Groups are an administrator's.** Only an administrator creates, edits or
  deletes a group, sets its sections, start nodes, permissions and languages, and
  sets its owners. Anyone else gets `Unauthorized`.
- **Owners.** A group may name any number of other groups as its **owners**, or none.
  It may name itself, so that its members can bring in teammates.
- **What owning gives.** A non-administrator in any of a group's owner groups may
  add users to that group and remove them. That can be done from the group's user
  list, or from a user's groups, on create, invite and update. Doing it still needs
  the Users section, which is where those screens are.
- **Ownership replaces the old rule.** Belonging to a group no longer lets someone
  put others in it. On a user's group list, each group added *or removed* must be
  one the caller owns; a group they don't own stays as it was. Removal is checked
  too, which it is not today.
- **Groups no one may own:**
  - the admin group;
  - any group holding a `Crombolo.Remote.*` permission.

  So putting someone in either is always an administrator's act. Naming an owner
  for such a group is refused, and so is giving a remote permission to a group that
  has owners.
- **An owner can add themselves.** Ownership doesn't stop that, since two owners
  could add each other. So naming an owner means its members can hold the group's
  permissions; an administrator chooses owners knowing that.
- **What doesn't change:**
  - A user's own start nodes are held to the caller's, as now (`mayGrantStartNodes`).
  - Users in the admin group are an administrator's to manage (`mayActOn`).
  - A user must keep at least one group.
- **Storage.** A `user_group_owner` table (group key, owner group key), in a new
  migration. A group is deleted with its rows on both sides.
- **Group files (story 228):** `owners = ["editors", "team-leads"]` in
  `schema/user-groups/<alias>.toml`, by alias, as part of what a group is. It is
  synced like the other fields, once every group exists. An alias that names no
  group stops the sync, naming it, as an unknown language does. A file without
  `owners` leaves them to Users.
- **The back office:**
  - The group screen gets an owners picker (several groups) for an administrator,
    under the line "Owners can manage group members".
  - For anyone else the group screens are view-only, where the client allows that;
    otherwise a save says only an administrator can change groups.
  - A refusal to add or remove a group the caller doesn't own says why, in plain
    words.
- **Upgrade.** No group has owners after the migration, so Users-section users who
  aren't administrators lose what membership used to let them do. The release
  notes say so, and say to set owners on the groups they should run.

Not in scope: which users a Users-section user may edit at all. Today that is anyone
outside the admin group, password resets included, which reaches users in groups the
caller doesn't own. That deserves a story of its own.

## Acceptance criteria

- [x] A non-administrator with the Users section can't create, edit or delete a
      group, nor set its owners.
- [x] An administrator can name several owner groups for a group, the group itself
      included, and they are kept, shown and audited.
- [x] A member of an owner group can add users to that group and remove them, from
      the group and from the user screen, on create, invite and update.
- [x] Someone in a group but not in its owners can't add users to it nor remove
      them; nor can they take a user out of a group they don't own.
- [x] The admin group, and a group holding a remote permission, can't be given
      owners. A remote permission can't be given to a group that has owners.
- [x] Deleting a group removes it as an owner and its own owner rows.
- [x] A group file's `owners` is synced, and an unknown alias stops the sync.
- [x] The group screen has the owners picker, and is view-only, or says
      it can't be changed, for anyone but an administrator.
- [x] The release notes' upgrade notes say ownership replaces membership.
- [x] An administrator is unaffected.

## Implementation

- **Data:**
  - Migration 074 `AddUserGroupOwners` (release 0.63.0) adds `user_group_owner`
    (`user_group_key`, `owner_group_key`), keyed by group key as the permission
    tables are.
  - `UserGroupRepository`:
    - gains `owners` on each record, `ownedBy(groupKeys)` and `setOwners`;
    - `save` leaves owners alone, so the vendored client's own save can't lose them;
    - `delete` removes the group's rows on both sides;
    - `syncDeclared` sets the owners a file names, in a second pass.
- **Rules** (`packages/server/src/adapters/users.ts`):
  - `validate` returns `AdministratorsOnly` for anyone else, `CannotBeOwned` for
    the admin group or a remote verb with owners, and `OwnerNotFound`.
  - `mayAssignGroups` requires every group added to or taken from a user to be
    owned. It covers create, invite, update and set-user-groups, and answers
    `NotGroupOwner`.
  - `addUsers`/`removeUsers` require ownership.
  - `get` lets a member or an owner see a group. `filter`, which the group picker
    uses, offers a non-administrator only the groups they own.
  - The group response carries `owners` and `canManageMembers`.
- **API:**
  - `owners` is read from a group's body when it is sent; leaving it out keeps
    what the group has.
  - New problems: `AdministratorsOnly` 403, `NotGroupOwner` 403, `CannotBeOwned`
    400 and `OwnerNotFound` 404.
  - `isRemotePermission` is in `@crombolo/core`.
- **Files:** `owners` in `schema/user-groups/*.toml`, refused on a group with a
  remote verb. It is written back in development when the file names owners.
- **Back office,** fork commit `c0fb2163` on `umbraco/crombolo`:
  - The group model reads and sends `owners`.
  - The workspace context is read-only unless the current user is an
    administrator.
  - Save, Delete, bulk Delete and Create need `Umb.Condition.CurrentUser.IsAdmin`.
  - The details view shows a read-only notice, read-only inputs and an Owners
    box ("Owners can manage group members"), or why the group can't have owners.
  - The people box is read-only unless `canManageMembers`.
  - The permission editors, which have no read-only state, are shown inert.
  - On the user screen, groups the current user doesn't own show a lock instead of
    Remove, with a line saying they can change only groups they own.
- **Tests:**
  - `tests/users.test.ts`: the old delegation test reworked for ownership, and a
    "group owners (story 302)" block.
  - `tests/user-groups-files.test.ts`: parsing, syncing and write-back of `owners`.
  - The migration rewinds in all five places.
