# 404 — A managed user's external login, linked by its directory, and nothing else writes users

**Epic:** Users and access · **Priority:** must · **Size:** S
**Depends on:** 031, 389

## Story

As a directory that manages a site's users (`389`) and signs its people in through an
external provider (`031`), I want to link each user I make to their provider login, so
that they can sign in the first time without the site creating or regrouping anyone.

## Context

With `users.managedBy` set, a provider signs in only users that exist and are linked to
the login (`389`): it makes no user (`autoCreate` is forced off) and moves no group from
its claims. A directory that creates each user through the Management API has no way to
link that user to their login, so the person is refused ("No account here is linked to
your … sign-in"), or, with `linkByEmail` off, refused as an account that already exists.

## The design

- **`PUT <backoffice>/crombolo/api/users/{key}/logins`** `{ provider, subject }` links an
  external login to an existing user: `provider` is the provider's id as the site's
  identity providers name it, `subject` the provider's subject for the person. Answers
  the user's links.
- **`GET`** lists a user's links; **`DELETE …/logins/{provider}`** removes one.
- **Only a managing client** (`users.managedBy`) may link or unlink, while users are
  managed; without the setting, an administrator may. Anyone else is refused (403,
  "Managed outside this site"). A sign-in token in `Authorization`, as the other
  directory routes take.
- **A login already linked to someone else** is refused (409), naming neither.
- **Sign-in is unchanged:** it finds the link and signs the person in; it still never
  creates a managed user or moves their groups.
- **Audited** as the directory's change to the user.
- **A bundle carrying users is refused** while users are managed (409, "This site's users
  are managed outside it"), as story 405 refuses one carrying group definitions: a site
  import or bundle apply with users (`--with-users`, a site file's people) is refused at
  its check, before anything is written. A bundle carrying members and no users applies
  as before; one carrying users goes ahead with `--exclude-people`, which leaves its people
  out. Found 2026-11-23: a bundle's people
  are applied straight to the database (`applyPeople`), past the ports 389 guards.

## Acceptance criteria

- [x] The managing client links a login to a user it made; that person then signs in
      through the provider, with the groups the client set
- [x] It lists and removes a user's links
- [x] Anyone but the managing client is refused while users are managed; an
      administrator may when they are not
- [x] A login linked to another user is refused
- [x] An unknown provider or user is refused (404)
- [x] While users are managed, a site import or bundle apply carrying users is refused
      (409) at its check, writing nothing; a bundle carrying members only, and one carrying
      users applied with `--exclude-people`, go ahead
- [x] `docs/` (users and identity providers) says so

## Implementation

- `createUserLogins` (`packages/server/src/user-logins.ts`), at
  `<plugin>/api/users/{key}/logins` in `server.ts`, bearer only: the directory's clients
  while users are managed, an administrator otherwise; links through
  `ExternalLoginRepository`, audited.
- `usersManaged` in the bundle check's options (`transferOptions`,
  `packages/server/src/bundle-install.ts`); `checkBundle` raises a blocking
  `users-managed` finding for a bundle carrying users (`packages/transfer/src/check.ts`),
  and `groups-managed` for story 405.
- Tests: `tests/users-managed.test.ts`.
