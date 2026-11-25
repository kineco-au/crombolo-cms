# 428 — Workspace controls beside the Content menu

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 384, 419

## Story

As an editor, I want to open a new workspace, share the one I am in and delete it from
buttons I can see, so that I do not have to open the list of workspaces to find them.

## Context

Asked for by the maintainer on 2026-11-25. The workspace switch at the start of the
strip under Content (`384`, `419`) is a list: Shared, each workspace, then "New
workspace", the changes, the merge, "Open at its address", "Share" and "All
workspaces". Opening a new one and sharing were items in that list, and nothing in the
back office deleted a workspace, though its route has been there since `375`
(`DELETE workspaces/{key}`).

## The design

As agreed from a drawing on 2026-11-25, after a first cut with worded buttons and an Info
page.

- **Four icons at the end of the strip,** their words as tooltips: New workspace, Merge
  into Shared, Share, Delete. The last three are off in Shared, and each says why when it
  is off. The workspace switch follows them.
- **The strip keeps the back office's colour;** a workspace's colour is the dot beside
  its name in the switch.
- **The switch's list** holds Shared in a section of its own, the workspaces, and what to
  do with the one the tab is in. It loses "New workspace", "Share" and "All workspaces",
  and closes on a press outside it.
- **Workspaces, the last place in the menu:** the workspaces listed in the sidebar, the
  one the tab is in marked, and the one chosen shown beside it, where it is renamed,
  described, entered, merged, shared and deleted, and who sees it is chosen.
- **Delete** asks first, in the back office's own confirmation, saying how many changes
  go with it and that it cannot be undone. It is off for a person's own workspace where
  every edit goes in one.
- **A workspace has a description** (migration 099), said as it opens.
- **Who sees a workspace** is one of two, "Admins" or "Admins and Editors".
- **Someone opening an item another workspace changed in the last seven days is told;**
  nobody chooses that any longer.

## Acceptance criteria

- [x] The strip shows the four icons and then the switch at its right, where workspaces
      are on, each icon with its words as a tooltip.
- [x] In Shared, Merge, Share and Delete are off; New workspace is not.
- [x] The list of workspaces has no "New workspace", "Share" or "All workspaces", holds
      Shared apart, and closes on a press outside it.
- [x] Workspaces lists them in the sidebar and shows the one chosen beside it; choosing
      one does not move the tab.
- [x] Its owner renames and describes a workspace and chooses who sees it there.
- [x] Deleting asks first, and leaves the tab in Shared.

## Implementation

- `workspace-client.js`: `controlsFor`, `menuFor` (sections; no `new`, `share`, `all`),
  `workspaceRows`, `workspaceFacts`, `VISIBILITY`, `workspacesApi.discard`, `.describe`,
  `.rename`.
- `workspace-switch.js`: the switch; `crombolo-workspace-controls`; the dialogs for a
  new workspace, sharing, changes and merging, and `deleteWorkspace`, as functions.
- `content-strip.js`: the Workspaces item, the controls and the switch at the end.
- `workspaces-list.js`, `workspaces-page.js`, `workspaces-state.js`,
  `workspaces-section.js`: the Workspaces place.
- Migration 099 `AddWorkspaceDescription`; `WorkspaceRepository.setDescription`,
  `touching` held to seven days; the routes take and answer `description`, and no longer
  `tellOthers`.
- Tests: `tests/workspace-backoffice.test.ts`, `tests/workspaces-api.test.ts`,
  `tests/content-strip.test.ts`, `tests/browser/workspaces.browser.ts`.
