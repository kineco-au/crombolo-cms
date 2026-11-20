# 389 — Users managed from outside the site

**Epic:** D — Members and identity · **Priority:** should · **Size:** S
**Depends on:** 031, 034

## Story

As someone running several sites whose people are kept in one directory, I want a site
to take its back-office users and their groups only from that directory, so that nobody
has access on one site that the directory does not know about.

## Context

An external identity provider (`031`) signs a person in and creates their user, and an
API client (`034`) can create, change and disable users through the Management API. A
directory outside the site can therefore already provision users. Nothing stops a
change made by hand in the Users section from disagreeing with it afterwards.

## The design

- **A setting** (`users.managedBy`) names one or more API clients. With it set, only
  those clients may:
  - create, invite, change, disable, enable or delete a user;
  - change which groups a user is in.
- **Everyone else is refused,** administrators included, in the back office and through
  the Management API, with problem details saying users are managed outside the site.
- **The Users section** lists users and their groups read-only. Where the site names an
  address for it (`users.managedAt`), each user links to that address.
- **Still a person's own:** their language, their avatar and their two-factor set-up
  (`032`).
- **What a group may do is not covered:** its sections, permissions and start nodes are
  edited as before. Only who is in it is managed.
- **Sign-in is unchanged.** A user the directory has disabled is refused as any
  disabled user is.
- **The setting is read at boot,** from `crombolo.config.ts` or the environment and
  nowhere else, so nothing at runtime changes it.

## Decisions (2026-11-20, the maintainer's)

- **Config and environment only:** `users.managedBy` / `CROMBOLO_USERS_MANAGED_BY` (client
  ids) and `users.managedAt` / `CROMBOLO_USERS_MANAGED_AT`. Nothing to lock.
- **A provider signs in only users that exist** (`031`): with the setting on it makes no new
  user and changes no groups from its claims.
- **`users.managedAt` is an address with `{email}`, `{key}` or `{userName}`,** filled in
  for each user's link.
- **Unlocking, resetting a password and resetting two-factor for someone else** are the
  directory's, refused like the rest; each person still manages their own two-factor.

## How it is built

- A principal authenticated with a client-credentials token carries `viaClient` (the
  token row's `client_id`), which the rule checks.
- The Management API's user writes (`PostUser`, invite, `PutUserById`, delete, disable,
  enable, unlock, password reset, `PostUserSetUserGroups`, a group's users added or
  removed) are refused for anyone else; the same rule in `user-admin.ts` covers the remote
  protocol's user routes and the command line's `users` commands.
- Still a person's own: `PutUserCurrentProfile`, their avatar, their password and their
  two-factor set-up. Groups themselves are edited as before.
- The Users section hides create, invite, delete and enable/disable, and links each user to
  `users.managedAt`.

## Acceptance criteria

- [ ] **With the setting on,** a named client creates, changes and disables users and
      sets their groups.
- [ ] **An administrator's change to a user or their groups** is refused, in the back
      office and the API, with the reason.
- [ ] **The Users section** is read-only and links to the address the site names.
- [ ] **A user changes their own language and avatar** as before.
- [ ] **A group's permissions** are edited as before.
- [ ] **With the setting off,** nothing changes.
- [ ] **Tests** on both dialects; `docs/configuration.md` describes the setting.
