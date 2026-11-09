# 314 — An administrator sees the back office as a group does

**Epic:** D — Members and identity · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an administrator setting up user groups, I want to switch my own back-office
session, for a while, to what one or more groups may do, and switch back in one
click, so that I can see exactly what their members see without signing in as
one of them or asking them.

## Context

What a back-office user may do comes from their groups: sections, permissions per
node, start nodes, languages. Today the only way to check a group is to make a test
user, put it in the group, and sign in as it in another browser.

A session resolves to its user's identity on every request: `AuthService` takes the
token to its session, then `identityOf` builds sections, group keys, permissions and
languages from the user's groups (`packages/auth/src/service.ts`). Start nodes come
from `loadAccess`. So an identity built from other groups can come from the same
place, for one session, without anything else changing.

## The design

- **Who:** administrators only. A non-administrator is never offered it, and its
  endpoint refuses them.
- **Starting it:** from the user menu, "View as a group…". This opens a panel listing
  the groups, to tick one or more, and a Start button.
- **While it is on**, for this session only:
  - **What applies:** the identity is built from the chosen groups, as if the
    administrator were a member of exactly those. That covers sections, permissions,
    start nodes, languages and approval workflow stages. The administrator's own
    rights, the administrators group's included, do not apply.
  - **It only ever narrows:** the chosen groups never add to what an administrator
    could do. Their other sessions and devices are unchanged.
  - **The back office reloads into it,** so the menus, trees and actions are the
    group's. A banner across the top says "Viewing as Editors, Writers", with
    **Switch back**.
  - **It ends by itself** with the session, or after an hour, whichever is first. The
    banner says when.
- **Switching back:** one click on the banner. The back office reloads as the
  administrator.
- **The audit:** "started viewing as …" and "switched back" are recorded against the
  administrator. Anything they change while viewing is audited as them, "while
  viewing as Editors".
- **Not offered:** viewing as one named user, whose own settings and start nodes
  differ from their groups'. Viewing as a member, on the site, is the preview as a
  member (story 264).

## Decisions to take

- **D1, changes while viewing:**
  - **Recommended:** allowed, as the groups would be allowed, so a workflow can be
    tried end to end, and audited as above.
  - **The alternative:** read-only, saying "you are viewing as a group: switch back to
    change this".
- **D2, the Management API:** the simulation applies to every request with the
  session's token, the back office's own API calls included. A script holding a token
  of its own is never affected. This is to confirm.

## Acceptance criteria

- [ ] An administrator can view as one or more groups. A non-administrator can't, and
      the endpoint refuses them.
- [ ] While viewing, sections, tree access, actions, start nodes and languages are
      exactly the chosen groups', and the administrators group's are not.
- [ ] The banner names the groups and switches back in one click. It also ends with
      the session or after an hour.
- [ ] Other sessions of the same administrator are unaffected.
- [ ] Starting, switching back and changes made while viewing are audited, naming the
      groups.
- [ ] A browser test views as a group with no Settings, sees no Settings section, and
      switches back.
