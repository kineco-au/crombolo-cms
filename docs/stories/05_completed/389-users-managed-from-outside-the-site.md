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

- **API users stay the administrator's (2026-11-21):** the rule covers people, so the
  directory's own client is set up, and its secret rotated, with the setting on.

## How it is built

- `config.users` (`UsersSetting`, `usersManaged`) in `packages/server/src/config.ts`, from
  the config file or `CROMBOLO_USERS_MANAGED_BY` / `CROMBOLO_USERS_MANAGED_AT`, checked at
  boot.
- A client-credentials token's `client_id` rides on the identity as `viaClient`
  (`packages/auth/src/service.ts`) and on the principal.
- `managedUserPorts` (`packages/server/src/managed-users.ts`) wraps the user and group
  ports `createUserPorts` returns, so the back office, the Management API, the remote
  protocol and the command line all meet it: create, invite, resend, update, delete,
  disable, enable, unlock, set groups, a group's users added or removed, and someone
  else's password, avatar or two-factor (`mayManage`) answer `ManagedOutside` (403,
  "Managed outside this site") unless the caller is a named client, or every user
  touched is an API user.
- `createExternalSignIn` takes `managed`: no account is created and no group follows a
  claim.
- `<plugin>/api/users-managed` says whether the site is managed and, with `?user=<key>`,
  fills `managedAt` for that person. `users-managed.js` hides the Users section's
  invite, create-person, delete, disable, enable, unlock, change-password, two-factor and
  set-group actions, and Save, putting back a Save shown only for an API user
  (`Crombolo.Condition.User.IsApiUser`), plus "Open where this person is managed".
- Tests: `tests/users-managed.test.ts`.

## Acceptance criteria

- [x] **With the setting on,** a named client creates, changes and disables users and
      sets their groups.
- [x] **An administrator's change to a user or their groups** is refused, in the back
      office and the API, with the reason.
- [x] **The Users section** is read-only and links to the address the site names.
- [x] **A user changes their own language and avatar** as before.
- [x] **A group's permissions** are edited as before.
- [x] **With the setting off,** nothing changes.
- [x] **Tests** on both dialects; `docs/configuration.md` describes the setting.
