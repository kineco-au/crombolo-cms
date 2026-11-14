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

## Decisions

Taken 2026-11-14.

- **D1, changes while viewing: allowed,** as the groups would be allowed, so a
  workflow can be tried end to end. Each change is audited as the administrator,
  "while viewing as Editors, Writers".
- **D2, scope: the session.** Every request made with this back-office session sees
  the groups' rights, the back office's own Management API calls included, so what
  the screens show and what the server allows never disagree. A token of its own,
  a script's or CI's, is never affected, nor are the administrator's other sessions.
- **Where it is kept: on the session's row** (`user_login_session`), so it holds on
  every node and through a restart, and ends with the session.

## Plan

1. **A migration** adds two columns to `user_login_session`: the group keys being
   viewed as (JSON, null when not viewing) and when it ends. Its `release` is the
   version it ships in.
2. **Authorization from groups.** `loadAuthorization(userId)`
   (`packages/auth/src/store.ts`) becomes a wrapper over one built from a set of
   group ids, which the user's memberships give normally and the session's viewing
   groups give while viewing. `isAdmin` then comes from those groups only, so viewing
   as a group without the administrators group is not an administrator.
3. **One session, one override.** `resolveAccessToken` reads the session's viewing
   groups. Inside the hour, the identity is built from them. Past it, or for any
   other session or token, from the user as before. The identity carries
   `viewingAs: { groups, until, actualUserIsAdmin: true }`, which the server keeps on
   the principal.
4. **Start nodes and languages** come from the same groups: `loadAccess` (and
   `UserRepository.access`) take the group set too.
5. **Approvals** already check `principal.groupKeys`, so who may approve follows. An
   automatic self-approval looks up the requester's real memberships
   (`approvals.ts`, `selectFrom('user_group_member')`). While viewing, it uses the
   viewed groups, so the trial matches what a member would see.
6. **The endpoints**, `<plugin>/api/view-as`:
   - `POST {groups}` starts it, for an administrator only: checked against who they
     really are, never against a session already viewing;
   - `DELETE` switches back, allowed for that session whatever it is viewing as, so a
     view without Settings or Users can always end;
   - `GET` says whether this session is viewing, as which groups, and until when.
7. **The back office:**
   - "View as a group…" in the user menu, for administrators: a panel with the groups
     to tick, and Start;
   - the client reloads into the groups' sections and trees;
   - a banner across the top, "Viewing as Editors, Writers until 14:32" with **Switch
     back**, on every page while viewing.
8. **The audit:** "Started viewing as …" and "Switched back", against the
   administrator. Every entry written while viewing gets "while viewing as …" in its
   detail, through the request's audit context rather than at each call.
9. **Tests:**
   - unit tests of the identity, start nodes, languages, approvals and the hour, on
     both engines;
   - a refusal for a non-administrator;
   - another session unaffected;
   - the browser test, in CI only (below).

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
      switches back. It runs in CI only, in the browser suite on a push carrying
      `--browser-tests`, not locally while the story is built; the story is done once
      that CI run passes.
