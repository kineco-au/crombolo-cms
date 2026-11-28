# 451 — A workspace shared with user groups

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 384, 386

## Story

As the owner of a workspace, I want to share it with one or more user groups as well as
with people, so that everyone in those groups, now or later, can see and work in it
without my adding each of them by name.

## Context

A workspace is shared with people one by one (`workspace_member`, story 384). Who can see
it is a toggle of two: **Admins** (its owner, the people it is shared with, and the
administrators) or **Admins and Editors** (every editor may look at it). The back office
shares by email, in a dialog, and the workspace's page links to that dialog from its
"Shared with" card.

## Decided (2026-11-28)

1. **Groups are stored on the workspace, not expanded to their people.** Access follows
   membership: someone added to a group later can see and work in the workspace, and
   someone removed from it no longer can.
2. **One or more groups**, and people alongside them.
3. **The toggle gains Custom:** Admins | Admins and Editors | Custom. Custom shares with
   the groups and people chosen; choosing Admins or Admins and Editors again stops sharing
   with them.
4. **Chosen in autocomplete boxes**, one for groups from the site's user groups and one
   for people from its users, in the New workspace dialog, the Share dialog and on the
   workspace's page.
5. **Email sharing leaves the back office** for now. The command line keeps it (`386`).
6. **The "Change who it is shared with" link goes** from the "Shared with" card: the
   Custom choice is where sharing is changed.

## The design

- **Storage:** a table `workspace_group` (`workspace_id`, `group_key`, `added_at`; primary
  key both ids, an index on `group_key`), added by a migration. Deleting a workspace
  deletes its rows, as `workspace_member`'s.
- **Access:** `mayUse` counts a principal as a member when one of their group keys is a
  group the workspace is shared with. `forUser` lists those workspaces too, so a group's
  people see it in their list, the switch and its tree marks.
- **The API** (owner only, as sharing with people is):
  - `POST /{key}/groups { groupKey }`, refused for a group that doesn't exist;
  - `DELETE /{key}/groups/{groupKey}`;
  - `GET /{key}/members` also answers `groups: [{ key, name }]`;
  - a workspace's view gains `groupKeys`;
  - each share and unshare is audited, as a person's is.
- **The back office:**
  - the toggle's **Custom** shows two autocomplete boxes, Groups and People. Each chosen
    one is a tag that can be removed, and each choice is saved as it is made;
  - the toggle shows Custom while the workspace is shared with any group or person;
  - choosing Admins or Admins and Editors from Custom un-shares the groups and people,
    saying who it no longer is shared with;
  - the New workspace dialog shares with what was chosen once the workspace is open;
  - the "Shared with" card counts groups as well as people.

## Acceptance criteria

- [x] **A workspace shared with a group** is listed for, entered by and editable by
      everyone in that group, including someone added to the group afterwards; someone
      removed from the group loses it.
- [x] **Groups and people** are chosen in autocomplete boxes under Custom, on the page and
      in both dialogs; a choice is saved as it is made and can be removed.
- [x] **The toggle** reads Custom while anything is shared; switching away un-shares it.
- [x] **No email box** in the back office; the "Change who it is shared with" link is gone.
- [x] **Only the owner** shares or un-shares, a group that doesn't exist is refused, and
      each change is in the audit log.
- [x] **Tests:** the repository and `mayUse` with groups, on both dialects; the routes;
      the toggle's reading (`audienceOf`); the browser journey for workspaces updated.
- [x] **Docs:** `docs/workspaces.md` (sharing), `docs/changes.md` for the migration, and
      the release notes.

## Built (2026-11-28)

- **Data:** migration 107 `AddWorkspaceGroups`, table `workspace_group`;
  `isWorkspaceMember(workspace, userKey, groupKeys)`, and `forUser(userKey, groupKeys)`
  listing what a person's groups are shared with. Discarding a workspace, or deleting a
  user group, removes its rows.
- **Server:** `mayUse` counts the principal's group keys. The workspace cookie, a link's
  maker and the preview hand-off use the same check. `POST /{key}/groups`,
  `DELETE /{key}/groups/{groupKey}`, `groups` in `GET /{key}/members`, `groupKeys` on a
  workspace's view, and `GET /share-options` (approved back-office logins, and every
  user group, sorted by name).
- **Back office:** `audienceEditor` and `tagPicker` in `workspace-switch.js`, on the
  workspace's page and in both dialogs; `audienceOf` in `workspace-client.js`.
- **Tests:**
  - `tests/workspace-groups.test.ts`, on both dialects;
  - `audienceOf` and the "Shared with" card in `tests/workspace-backoffice.test.ts`;
  - the Custom steps in `tests/browser/workspaces.browser.ts`.
