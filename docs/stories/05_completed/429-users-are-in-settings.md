# 429 — Users are in Settings

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 234, 385

## Story

As someone running a site, I want its users and user groups among its settings, so that
the menu at the top is for content, approvals and members, and what is set up once is in
one place.

## Context

Asked for by the maintainer on 2026-11-25.

Users is a section of its own (`Umb.Section.Users`, `section/user-management`), with a
tab in the header and a sidebar of Users and User groups. Settings is opened by the
header's gear, shown to whoever holds `Umb.Section.Settings`, and is a page of cards
(`settings-cards.js`). Holding Users is a grant apart from holding Settings, and stays
one: a group may have either without the other.

## The design

- **No Users tab in the header.**
- **A card in Settings,** "Users and groups", to whoever holds Users, opening the users,
  with their groups beside them as now.
- **Addresses under Settings:** `section/settings/users/...`, for the lists, a user, a user
  group, and every link made to one (the audit log, a user's reference, one's own profile).
- **The old addresses forward,** `section/user-management/...` with the rest of the path
  and the query, as Media's and Packages' do (`moved-sections.ts`). Links kept in the
  database by migration `user-start-nodes-dropped` still open.
- **A group holding Users needs Settings too:** the group editor says so and offers to turn
  it on, and the API and group files refuse one without.

## Decision (2026-11-25, the maintainer's)

**Users needs Settings.** Users stays a grant of its own, so holding Settings alone opens
no users; no group holds Users without Settings. Migration 100 gives Settings to each group
that did, which also opens the other tools there to its people.

## Acceptance criteria

- [x] The header has no Users tab; Settings has its card, for whoever holds Users.
- [x] Every user and user group screen opens, is linked to, and reloads under Settings.
- [x] Each old address opens the same screen at its new one.
- [x] A group holding Users without Settings is refused; one that did before gains Settings.
- [x] Someone with Settings and not Users sees no card, and is refused by address, as now.
- [x] `docs/backoffice-hosting.md` and the release notes say where Users is.

## Implementation

- The fork: `settings/users` as the section's pathname, no tab, `user-management` forwarded.
- `settings-cards.js`, `settings-section.js`: the card. `sections.ts` (`placesRefusal`) and the
  group editor: Users needs Settings. Migration 100 `PutUsersInSettings`.
- Tests: section grants, settings cards, permission levels; `settings-header.browser.ts`.
