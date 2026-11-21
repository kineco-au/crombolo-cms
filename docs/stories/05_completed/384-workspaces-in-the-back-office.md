# 384 — Workspaces in the back office

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 375, 376, 377, 379, 380, 381, 382

## Story

As someone working in the back office, I want to switch between workspaces at the head
of Content, start a new one from Shared, see what mine has changed and merge it, so that
working apart and bringing work together are as easy as editing a page.

## Context

Pages, types, components and, after `385`, media all sit under Content (`289`), and they
are everything a workspace holds. Users, members and settings sit elsewhere and are
never in a workspace. So the switch belongs at the head of Content: it shows exactly
where it has an effect.

## The design

- **A workspace switch at the head of Content,** over the row of `289`:
  - where you are: Shared, or the workspace's name in a colour of its own, carried on
    every screen under Content;
  - a list of your workspaces, most recent first, and Shared. Switching keeps you on the
    same page or type, in that workspace's version;
  - **New workspace:** a name, and you are in it;
  - **Move this edit to a new workspace,** for an edit begun in Shared;
  - **Merge into Shared,** with the number of changes, whenever there are any;
  - **Share:** add and remove the people who can see this workspace.
- **Where a workspace is required** (`375`), Shared is in the list to look at and is
  read-only, and someone who has chosen no workspace is shown as in their own, with
  Name this workspace to keep it as a piece of work.
- **The choice is kept per browser tab,** and sent with every call. Leaving Content and
  coming back returns to it.
- **Outside Content there is no switch,** and nothing there is in a workspace.
- **In the trees:** a mark on each item the workspace added, changed, or has a move or a
  delete waiting for, and a filter for only those.
- **A Changes panel:** every item the workspace touched, each with what differs from
  Shared, its class (`382`), and Drop this change.
- **On a page or a type:** compare with Shared, side by side.
- **Open at its address** (`379`), and make or withdraw a link for a reviewer.
- **The merge screen** (`380`): the list, the checks, each conflict with keep mine or
  keep theirs, the lossy changes to accept, and the approval step where a workflow
  applies.
- **A Workspaces view:** every open workspace you may see, with owner, members, number
  of changes, last activity and whether it conflicts with Shared; and the closed ones,
  which are the site's changes (`381`).
- **Who may:** anyone who may edit opens a workspace; merging is a permission of its
  own, set in the group editor's levels (`338`); a workspace is seen by its members.

## Decision to make before starting

- **Telling someone an item is changed in another workspace.** Opening an item that
  another open workspace has changed could say so, with who, before it becomes a
  conflict. It reveals that a private workspace touched the item, not what changed.
  Recommended: yes, with a setting per workspace to stay silent.

## Decisions (settled 2026-11-20)

- **A workspace's privacy is chosen by its owner when it is opened,** two settings kept
  with it and changed later only by the owner:
  - **who can see it:** its members only, or everyone who may edit (listed in the
    Workspaces view, its changes readable, editable only by members);
  - **whether others are told:** someone opening an item this workspace changed sees
    "Also changed in a workspace by <owner>", before it becomes a conflict at merge; it
    says that the item was touched and by whom, never what changed. On unless the owner
    turns it off.
  The two need columns on `workspace` (a migration, the next free number) and the
  workspace routes' `POST /` and `PATCH /{key}`.
- **In the plugin, not the fork:** the switch is drawn at the head of Content
  (`content-strip-items.js`), the choice kept per tab in `sessionStorage`, the
  `Crombolo-Workspace` header added by an `umbHttpClient` interceptor (as
  `own-workspace.js` does, which the switch replaces), and the open screen reloaded on a
  switch.
- **Built after the stories it shows:** `376`, `377`, `379`, `381` and `382`, so every
  screen is whole at once: types and files, the workspace's address and reviewer links,
  the closed workspaces as changes, and each change's class.
- **A workspace's colour comes from its key,** from a fixed accessible palette; nothing is
  stored or chosen.

## Acceptance criteria

- [x] **The switch lists a person's workspaces and Shared,** and switching keeps the
      item open.
- [x] **A new workspace** is made from the switch and entered at once.
- [x] **Every screen under Content** shows which workspace it is in; no screen outside
      Content does.
- [x] **An edit begun in Shared** can be moved to a new workspace before it is saved.
- [x] **The trees mark what the workspace changed.**
- [x] **The Changes panel** lists each change with its difference, and drops one.
- [x] **Merge into Shared** runs `380`'s merge from the screen, conflicts and all.
- [x] **The Workspaces view** lists open and closed workspaces.
- [x] **Someone without the merge permission** sees no Merge.
- [x] **A workspace is shared and unshared** from the switch.
- [x] **Its owner chooses who can see it and whether others are told** of an item it
      changed, when opening it and later.
- [x] **With a workspace required,** Shared opens read-only and an edit lands in the
      person's own workspace.
- [x] **With workspaces off,** none of this shows.
- [x] **Browser tests** for the switch, a change and a merge.

## Built (2026-11-21)

- **The switch** (`workspace-switch.js`) in the Content strip, which shows wherever workspaces
  are on; its pure parts (`workspace-client.js`: the tab's choice, `headerFor`, `colourOf`,
  `menuFor`) and its calls. `workspaces.js` sends the header, registers the trees' sign, the
  page's Info (`workspace-info.js`), "Save in a new workspace" (`workspace-move-action.js`) and,
  with a workspace required, Shared read only (`workspace-shared-guard.js`).
- **Server:** migration 090 `AddWorkspacePrivacy`; `POST /` and `PATCH /{key}` take
  `visibility` and `tellOthers`; a workspace shown to editors is listed and read by them;
  `GET /touched/{page}`; `DELETE /{key}/changes/{page}`; `/mine` says `enabled` and `mayMerge`;
  tree items read in a workspace carry `Crombolo.Workspace.Changed`.
- **Tests:** `tests/workspace-backoffice.test.ts`, `tests/browser/workspaces.browser.ts`; the
  browser suite's site has workspaces on.

## Left for later

- **A filter for only the changed items** in the trees: the Changes panel lists them.
- **Comparing a type** side by side: pages are compared on their Info.

