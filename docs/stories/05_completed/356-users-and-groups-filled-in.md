# 356 — Users and groups filled in

**Epic:** P — The command line · **Priority:** should · **Size:** S
**Depends on:** 349, 350, 352

## Story

As an administrator, I want to change a user's details, end their sessions and
set a group's start nodes and owners from the CLI, so that the user commands
cover what the Users section does.

## Context

Story 349, G7, G8 and G9. `users` invites, disables, enables, unlocks and
resets, but can't change a user's name, e-mail, groups or language, or remove
them. Signed-in devices (story 107) are only in a person's profile. A group's
content and media start nodes, and its owners (story 302), are back-office only.

Each command here takes `--profile` (story 352) to act on another site, through the remote protocol, as the person signed in to it. A hosted site needs a new capability for these routes, checked by `packages/remote-conformance`. A CI identity is refused, since these act for a person (story 349, D2). Ending another person's session needs an administrator.

## What is there to build on

- **The ports.** `createUserPorts` (`packages/server/src/adapters/users.ts`) gives
  the `users` and `groups` ports the Management API calls. Each rule the Users
  section and story 302 apply is in them, keyed on the `Principal` passed in:
  - `users.update(principal, key, input)` takes the whole user (name, username,
    e-mail, UI language, group keys). It refuses an administrator's account to a
    non-administrator (`mayActOn`), and a group added or taken away that the caller
    doesn't own (`mayAssignGroups`, `NotGroupOwner`). It needs at least one group.
    Start nodes sent to it are ignored: since story 339 a user works where their
    groups do, so `users update` has no start-node flags.
  - `users.delete(principal, keys)` refuses yourself (`CannotDeleteSelf`), an
    administrator to a non-administrator, and **anyone who has ever signed in**
    (`CannotDeleteUserWithLoginHistory`), as Umbraco does. Such a user is
    disabled instead.
  - `groups.update(principal, key, input)` takes the whole group. Only an
    administrator may change one (`AdministratorsOnly`). Start nodes stay with the
    database (story 228, which settled this for user groups before 162). Owners
    are the group's file's when the file names them, and the database's otherwise.
    A file field changed where the files can't be written, as on a production
    site, is `DeclaredInFiles`.
- **"The last administrator" is not a rule the ports keep.** Only the group's own
  user list refuses to empty the admin group (`removeUsers`,
  `AdminGroupCannotBeEmpty`). `users.update` and `setGroups` let the last
  administrator drop the admin group, and `users.delete` doesn't check it:
  - an administrator can't delete themselves, so in the back office this is
    reached only by taking the admin group off oneself;
  - from the command line with nobody signed in, the command line is an
    administrator that isn't any user, so it could delete the only other one.

  The plan adds the rule to the ports, so the back office refuses it too.
- **The `users` commands act as the command line, not as you.** Each one opens the
  ports through `openPeople` (`packages/cli/src/support/people.ts`) and passes
  `OPERATOR`, an administrator who is nobody in particular, even when a person is
  signed in. The gate (story 350) checks only the Users section. So today a signed-in
  person who isn't an administrator can disable an administrator from the CLI. And
  `users groups new|update|remove` can change what a group grants, which story 302
  keeps for administrators. See D1.
- **`users groups new|update` edit the group's file** (story 251, through
  `updateUserGroup` in `packages/schema/src/site-edit.ts` and
  `commitDefinitionEdit`), with `--dry-run` and `--no-apply`, and refuse a group
  made in the back office (`ownGroup`). Start nodes aren't in the file, so the new
  start-node flags go through `groups.update`. They work on a group made in the back
  office too, as the group screen does.
  - A hosted site's files aren't the CLI's to write, so through `--profile`
    `users groups update` changes only what the database keeps. `users groups new`
    makes a file, so it takes no `--profile`. The criteria say so now.
  - `users remove`'s criterion now names every refusal the ports give, since a user
    who has signed in is never removed, only disabled.
- **A group has three start nodes**: content, media, and the Library's elements
  (`elementStartNode`, `elementRootAccess`). Each is a place or the whole tree
  (`…RootAccess`). The story named only two. `--library-start-at` is added, so the
  command covers the group screen.
- **Signed-in devices** (story 107) are device sign-ins: rows in
  `device_authorization` joined to their open `user_login_session`, listed by
  `DeviceStore.signedIn(userId)` (`packages/auth/src/device.ts`). They are revoked by
  `AuthService.revokeDevice`, for your own only, through
  `…/security/back-office/devices` (`packages/auth/src/routes.ts`), and shown by
  `backoffice-host/plugin/signed-in-devices.js` in your profile. Browser sign-ins
  are `user_login_session` rows too, with when, last used and the address. They
  aren't listed anywhere, and are ended only all at once (a disable or a password
  change, `AuthStore.endAllSessionsForUser`). Nothing lets an administrator see
  another person's. See D2.
- **Audit.** The Management API audits a user's save and delete, and a group's
  save, by operation (`packages/api-management/src/audit.ts`), with keys and no
  personal data. A CLI command declares `static audit`, written by
  `recordCommand` as the signed-in person.
- **The remote protocol** (`packages/server/src/remote.ts`) has no people routes. The
  routes here follow `content/query`: they check the section, then answer as the
  person through the same ports.

## Decisions

- **D1: who the existing `users` commands act as.**
  - (a) every `users` and `users groups` command passes the signed-in person to the
    ports, and `OPERATOR` only when nobody is signed in. `users groups new|update|remove`
    become `adminOnly`, as story 302 makes groups an administrator's. All in this
    story. *Recommended:* the new commands need the same plumbing, the change is a
    line or two per command, and fixing only the new ones leaves the old commands'
    gap beside the fix.
  - (b) only the new commands and flags act as the person. The existing ones are
    left for a story of their own.

  **Decided 2026-11-15: (a).** The release notes say that `users groups new|update|remove`
  are for administrators once someone is signed in.
- **D2: what `users sessions` lists.**
  - (a) every open sign-in: browsers, with when, last used and the address they
    signed in from, and terminals, by the name the device gave. Any of them can be
    ended. *Recommended:* the reason to look is a sign-in left open or not yours, and
    that is as often a browser as a terminal. Ending one session is
    `AuthStore.endSession`, which exists, and needs no table or column. The profile
    screen could list browsers in a later story.
  - (b) terminals only, as the profile's Signed-in devices does. Less to build, but a
    browser left signed in can still only be ended with all the others.

  **Decided 2026-11-15: (a).**
- **D3: where `--owner` keeps a group's owners.**
  - (a) as the back office does: in the group's file when the file already names
    owners, and with this environment's database otherwise. `users groups new --owner`
    sets them in the database once the new group is applied. *Recommended:* the same
    rule as the group screen, and it works the same through `--profile`, where the
    files can't be written.
  - (b) always in the group's file, so owners travel with the site. Through
    `--profile` this is refused like the file's other fields. And a file that names
    owners takes them out of Users' hands in every environment.

  **Decided 2026-11-15: (a).**

## Plan

1. **The rule for the last administrator**, in the ports (`adapters/users.ts`):
   - `users.update`, `setGroups` and `delete` refuse what would leave the admin group
     with nobody in it: `AdminGroupCannotBeEmpty`, which `removeUsers`
     already answers;
   - `users.delete` refuses the built-in administrator (`SUPER_USER_KEY`), whom the
     back office never shows to anyone else;
   - the back office's words for the new refusal are the existing ones for
     `AdminGroupCannotBeEmpty`.
2. **Acting as you** (with D1 (a)):
   - `support/people.ts` gains `actingPrincipal()`: `signedInPerson()`, or `OPERATOR`
     when nobody is signed in. `openPeople` returns the `groups` port beside `users`.
   - Every `users` command passes `actingPrincipal()`, and `users list` filters with it
     as the Users section does, so a non-administrator doesn't see administrators.
   - `users groups new|update|remove` declare `adminOnly`.
   - `checkStatus` gains words for `Forbidden` ("Only an administrator can change an
     administrator's account."), `NotGroupOwner` ("You can only add people to, or take
     them out of, groups you own."), `AdminGroupCannotBeEmpty` ("That would leave the
     site with no administrator."), `CannotDeleteSelf`, `AdministratorsOnly`,
     `DeclaredInFiles` and `CannotDeleteUserWithLoginHistory`. The last one says
     "<name> has signed in before, so they can be disabled but not removed", with the
     hint `crombolo users disable`.
3. **A shared core**, `packages/server/src/user-admin.ts`, used by the commands
   locally and by the remote routes:
   - `changeUser(ports, principal, key, { name?, email?, addGroups?, removeGroups?,
     uiLanguage? })` reads the user and builds the whole input `users.update` takes. When
     the site uses e-mail as the username and the username was the old e-mail, the
     username follows it;
   - `removeUser(ports, principal, key)`;
   - `signIns(db, principal, userKey?)` and `endSignIn(db, principal, id)`, with D2.
     Yours need nothing more. Someone else's need an administrator: "Only an
     administrator can see or end someone else's sign-ins." A non-administrator can't
     name an administrator either way;
   - `placeGroup(ports, principal, key, { content?, media?, library?, addOwners?,
     removeOwners? })` reads the group and saves it through `groups.update`, so
     validation, owners and the file rule are the group screen's. Each place is a node
     key, `root` (the whole tree) or `none`.
4. **Commands.**
   - `users update <user> [--name] [--email] [--group <alias>]... [--remove-group
     <alias>]... [--ui-language <iso>]`: `access: 'site'`, `section: 'users'`,
     `static audit` `{ category: 'user', action: 'Save', entityType: 'User' }`. It says
     what changed, and "no change" when nothing did.
   - `users remove <user>`: `access: 'site'`, `section: 'users'`, audit `Delete`.
   - `users sessions [<user>]`: `access: 'site'`, no section, since your own are in
     your profile:
     - with nobody signed in (`cliAccess: open`), `<user>` is required;
     - one line each: a short id (eight characters), browser or terminal and its
       name, when it signed in, last used and, with D2 (a), the address;
     - the sign-in this command line is using is marked "this terminal".
   - `users sessions end <id>`: the same access, audit `{ category: 'user', action:
     'EndSession', entityType: 'User' }` keyed by whose it was, with no address in the
     entry. Ending this terminal's own sign-in is allowed, and says to use `crombolo
     logout` next time.
   - `users groups new|update` gain `--start-at <page|root|none>`,
     `--media-start-at <folder|root|none>`, `--library-start-at <folder|root|none>`,
     `--owner <alias>`... and `--remove-owner <alias>`...:
     - pages and folders are named by path or key, as `content` and `media` name them;
     - with D3 (a), owners named in the file go through `updateUserGroup`, which
       gains `addOwners` and `removeOwners`; the rest through `placeGroup`;
     - the file is changed and applied first, then `placeGroup`. With `--no-apply`,
       the database flags are refused, since there is no group yet to place;
     - `update` with only database flags works on a group made in the back office, and
       `ownGroup`'s refusal applies only when a file field is changed;
     - `--dry-run` says what would change, database fields included;
     - `users groups show` shows the start nodes, owners, and where each is kept.
5. **Remote routes**, under `environments/{id}/`, each with the Users section except
   sign-ins:
   - `PATCH users/{key}` (the `changeUser` change) and `DELETE users/{key}`;
   - `GET users?find=<email or username>`, for the CLI to name a user;
   - `GET sign-ins[?user={key}]` and `DELETE sign-ins/{id}`;
   - `PATCH user-groups/{alias}` (the `placeGroup` change).

   They answer as the signed-in person through the same core, and refuse a CI identity
   with "Changing people needs a person". Each write is audited as the Management API
   audits the same change, with the person and their address. Discovery lists `users`.
   `packages/remote-conformance` checks that a user is found, that a change with no
   fields is answered without changing anything, and that `sign-ins` lists the
   caller's own, when the capability is listed.
6. **`--profile`** on `users update|remove|sessions|sessions end` and
   `users groups update`, through `hostedOrHere` and `connectSite`:
   - on a hosted site, `users groups update` takes only the database flags. A file
     field is refused: "A group's name, sections, permissions and languages are in the
     site's files: change them in the site and deploy it";
   - `users groups new` takes no `--profile`, since a group is made in the site's files;
   - a site whose discovery lacks `users` is refused with "This site needs a newer
     crombolo to change its users".
7. **Docs.**
   - `docs/operations.md`, the users section: updating and removing a user, sign-ins,
     a group's start nodes and owners, and that commands act as you;
   - `docs/remote-protocol.md`: the routes and the capability;
   - `bun run cli:spec`;
   - the release notes under Unreleased: the commands, and in the upgrade notes that
     neither the back office nor the CLI will now leave the site without an
     administrator, and (with D1 (a)) that `users` commands act as the person
     signed in.
8. **Tests.**
   - `tests/users.test.ts`, for the ports:
     - the last administrator refused on update, set-groups and delete;
     - the built-in administrator refused on delete.
   - `tests/user-admin.test.ts`, for the core:
     - a change merged into the whole user, the username following the e-mail;
     - a group added and removed by an owner, and refused to a non-owner;
     - sign-ins listed and ended: yours, and someone else's by an administrator, and
       refused to anyone else;
     - a group placed and owned, and the file rule for owners (D3).
   - `tests/users-cli.test.ts`, for the commands, locally and against a test server
     with `--profile`:
     - `users update`, `users remove` (never signed in, signed in, yourself, the last
       administrator);
     - `users sessions` and `end`;
     - `users groups new|update` with start nodes and owners, `--no-apply` refused,
       `--dry-run`, a back-office group placed;
     - at `sign-in`, a non-administrator refused the group commands, and another
       person's sign-ins;
     - with D1 (a), a non-administrator signed in refused `users disable` on an
       administrator;
     - a CI identity refused on each route;
     - a site without the capability refused.
   - `tests/cli-access.test.ts` covers the new commands' declared access.
   - `tests/remote-conformance.test.ts` runs the new checks.
   - SQLite only: no table or column changes. No browser tests: the back office's
     screens don't change, only the refusal the ports give, which `tests/users.test.ts`
     covers.

## Acceptance criteria

- [x] `crombolo users update <user> [--name] [--email] [--group <alias>]... [--remove-
      group <alias>]... [--ui-language <iso>]`, with the rules the Users section and
      story 302 apply
- [x] `users remove <user>`, refused for yourself, the last administrator, the built-in
      administrator, and anyone who has signed in before (who is disabled instead), as
      the Users section refuses them. Neither the back office nor the CLI leaves the
      admin group empty, by removing a user or by taking the group away
- [x] `users sessions [<user>]` lists signed-in devices and terminals, yours without a
      name and anyone's for an administrator, and `users sessions end <id>` ends one
- [x] `--start-at <page>`, `--media-start-at <folder>`, `--library-start-at <folder>`,
      `--owner <group>` and `--remove-owner <group>` on `users groups new|update`, start
      nodes kept with the database, as story 228 settled, through the rules the group
      screen applies
- [x] Each takes `--profile`, except `users groups new`, whose group is made in the
      site's files. On a hosted site `users groups update` changes only what the
      database keeps. `-o json`; audited
- [x] Tests for each, including the last administrator refused and a non-administrator
      refused another person's session
- [x] The CLI reference regenerated

## Built

Built 2026-11-15, with D1 (a), D2 (a) and D3 (a):
- **the last administrator** is `leavesNoAdmin` in `createUserPorts`
  (`packages/server/src/adapters/users.ts`): `users.update`, `setGroups` and `delete` answer
  `AdminGroupCannotBeEmpty` for a change that would leave the admin group empty, and `delete`
  answers `CannotDelete` for the built-in administrator. Both are `UserStatus`es now, and the
  Management API words them as the group screen's `AdminGroupCannotBeEmpty` is worded;
- **the core** is `packages/server/src/user-admin.ts`: `findUser`, `changeUser`,
  `removeUser`, `signIns`, `endSignIn`, `placeGroup` and `groupPlaceOf`, refusing with
  `UserAdminError`. The words for each port status are `userRefusal` there, which the
  command line's `checkStatus` and the remote routes both use;
- **the remote routes** are `packages/server/src/remote-users.ts`, mounted by `createRemote`
  with the server's own user ports (`userPorts`, read from the Management API's deps when a
  request comes), so a hosted site's file rule for owners is the group screen's. Discovery
  lists `users`;
- **the commands** are `users update|remove`, `users sessions [<user>]`, `users sessions
  end <id>`, and the start node and owner flags on `users groups new|update`, over
  `packages/cli/src/support/users.ts`, whose `withUsers` gives the same calls here or on a
  hosted site. `support/people.ts` gains `actingPrincipal()` and `readingPrincipal()`, and
  `openPeople` returns the `groups` port;
- **D1 (a):** every `users` and `users groups` command acts as the signed-in person;
  `users reset-2fa`, which used no port, now asks the port first whether the person may act
  on that user. `users groups new|update|remove` are `adminOnly`;
- `updateUserGroup` (`packages/schema/src/site-edit.ts`) takes `addOwners` and
  `removeOwners`, for a file that names owners;
- the conformance suite checks, when `users` is listed: the caller's sign-ins are their
  own, the caller is found, an unknown user is not, and a change of nothing changes nothing;
- tests: `tests/user-admin.test.ts`, `tests/users-cli.test.ts`, a case in
  `tests/users.test.ts` and one in `tests/cli-access.test.ts`.

Where it differs from the plan:
- **An open sign-in** is one whose session has not ended and that still has an unrevoked,
  unexpired refresh token: a session row stays open after its browser's cookie has lapsed,
  so the row alone would list sign-ins nobody can use. "Last used" is when its newest token
  was made, since `last_validated_utc` is never updated after the sign-in.
- **A sign-in is named by its session id,** eight characters in the list and in `end`, or
  more of it when eight are not enough to tell two apart.
- **"This terminal"** on a hosted site is the sign-in the request's bearer token belongs
  to; a command-line token is no sign-in, so nothing is marked then.
- **A user is found by key, e-mail or username.** The existing commands matched the display
  name where their help said username (`userNamed`), which is fixed for them too.
- **`users sessions <user>` by someone who is not an administrator, naming an
  administrator,** is refused as "Only an administrator can change an administrator's
  account", since finding them is refused first: a non-administrator cannot name an
  administrator either way, as the plan says.
- **The route `PATCH user-groups/{alias}` takes `?dryRun=true`,** so `--dry-run` works
  through `--profile`; and `GET users/{who}` answers as `users?find=` does.
- **The audit for a group's start nodes and owners** from the command line is the command's
  own (`permission`/`Save`/`UserGroup`, by key), written only when they changed; a change to
  the group's file alone writes none, as before.
- **`users groups update` with nothing to change** is a usage error, "Nothing to change".
- **The username follows the e-mail only where the site's usernames are e-mail addresses,**
  as the plan says: elsewhere a username that happened to be the old e-mail is kept.
- **The release notes' Fixes** also carry the username fix above.

