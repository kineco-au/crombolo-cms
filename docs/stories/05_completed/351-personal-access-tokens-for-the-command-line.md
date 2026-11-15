# 351 — Personal access tokens for the command line

**Epic:** P — The command line · **Priority:** should · **Size:** M
**Depends on:** 350

## Story

As a developer whose site needs a sign-in for the CLI, I want a script or a CI
job to run commands as me through a token I created, so that unattended work
keeps going, is limited to my permissions and is recorded under my name.

## Context

Decided under story 349 (D1), 2026-11-15. At `cliAccess = sign-in` (story 350),
nothing unattended can sign in through a browser. Story 160's CI rules cover a
job pulling from or pushing to a remote. They don't cover a command run
against a site's own database, or a person's own script.

It ships in the same release as 350 (350's D4), so no production site is left
without a way to run unattended at `sign-in`.

A token acts as the person who created it. It is not a separate identity, so the
audit log, permissions and approval rules all treat it as that person.

## What is there to build on

- **The gate** (`packages/cli/src/support/gate.ts`, story 350) reads the site's
  stored sign-in, resolves it against the site's database
  (`support/local-sign-in.ts`), and has the command act as the person found
  (`support/acting.ts`). A token is one more way to find that person.
- **Sign-ins on a hosted site** go to the server as a bearer access token.
  `RemoteClient` (`remote/client.ts`) takes a token source in place of the
  keychain, as CI's identity token does (`remote/ci.ts`). The server resolves a
  bearer at `server.ts`, `auth.resolveAccessToken`.
- **Tokens and sessions.** `auth_token` holds reference tokens tied to a session
  (`packages/auth/src/store.ts`). `AuthService.identityOf(userId)` resolves a
  person outside any session, for a credential that acts for them, such as a
  preview token, and refuses a locked or unapproved user.
- **CI is never allowed to decide.** The principal carries `ci` (`router.ts`).
  `remote.ts` refuses it the push approvals, but the approvals engine
  (`approvals.ts`, `approvals-api.ts`) doesn't check it (story 240's note).
- **The back office:**
  - a person's signed-in devices are a `userProfileApp`
    (`plugin/signed-in-devices.js`), with the endpoints in `packages/auth/src/routes.ts`;
  - a user group's screens add `workspaceView`s, so the user workspace can take one too;
  - the words live in `*-words.js` modules, which are unit-tested.
- **The last migration** is 077 (`session-view-as.ts`). A new one is undone in
  every test rewind (see the rewind helpers).

## Decisions

- **D1: where tokens are kept.**
  - (a) a table of their own, `cli_token`: a key, the person, the name, the hash,
    created, expires, last used, and revoked (when and by whom). *Recommended:* a
    token is named, listed, capped, audited on first use and revoked on its own,
    and lives longer than any session, so session cleanup and signed-in devices
    never touch it.
  - (b) a long-lived session with an access token of a new type in `auth_token`.
    This reuses revocation, and the token would show among signed-in devices. But
    sessions are cleaned up and renewed, and have no name, cap or first use.

  **Decided 2026-11-15: (a).**
- **D2: who may create a token, when the site turns them on.**
  - (a) anyone who can sign in. *Recommended:* a token carries only its person's
    own permissions, and the site's setting is the switch.
  - (b) administrators only.
  - (c) groups given a new "command-line tokens" permission.

  **Decided 2026-11-15: (c).**
  - The permission is `Crombolo.CliTokens.Create`, a group-wide verb kept in the
    group's fallback permissions, as the media and remote verbs are
    (`packages/core/src/permissions.ts`).
  - It shows in a group's permissions as "Command-line tokens", beside the remote
    verbs.
  - Only the built-in Administrators group is given it, by the migration and the
    seed.
  - It is checked each time a token is created **and each time one is used**. A
    person whose groups lose it has their tokens refused, with a reason of their
    own, without the tokens being deleted, so giving the permission back
    restores them.

## Plan

1. **Settings** in the registry, with `bun run docs:config`:
   - `cliTokens` / `CROMBOLO_CLI_TOKENS`, off by default;
   - `cliTokenMaxDays` / `CROMBOLO_CLI_TOKEN_MAX_DAYS`, 90 by default;
   - `CROMBOLO_TOKEN`, read by the CLI.
2. **Migration 078, `AddCliTokens`** (with D1 (a)):
   - `cli_token`: `id`, `key` (uuid), `user_id`, `name`, `token_hash` (unique),
     `created_at`, `expires_at`, `last_used_at`, `revoked_at`, `revoked_by`;
   - a unique name per user while not revoked;
   - `Crombolo.CliTokens.Create` given to the built-in Administrators group, and
     to it in the seed (`grantBuiltInPermissions`), as migration 045 gives the media
     verbs;
   - `release` is the next version, set when it is cut;
   - `tables.gen.ts` regenerated, and the rewinds in the test helpers updated.
3. **The tokens themselves** (`packages/auth/src/cli-tokens.ts`):
   - `issue(userId, name, days)` makes `crombolo_pat_` followed by 32 random bytes,
     base64url, so secret scanners can recognise one;
   - only its hash is kept, and it is returned once;
   - `--expires` defaults to 30 days and is capped at `cliTokenMaxDays`;
   - `list(userId?)` and `revoke(key, byUserId)`;
   - `resolve(token)` gives the person, or why not:
     - `unknown`, `expired`, `revoked`;
     - `disabled`, `locked`, `removed`;
     - `not-allowed`, when none of the person's groups holds the permission now;
     - `off` while the setting is off.

     Each gives its own message.
   - Using a token sets `last_used_at` at most once an hour. The first use is
     reported, so it can be audited.
4. **The principal.**
   - `viaToken?: { key, name }` joins `ci` on `Principal`, and `principalOf` takes it.
   - The approvals engine refuses a decision from a principal with `ci` or
     `viaToken`. `remote.ts`'s approve and decline of a held push already refuse
     `ci`, and now refuse `viaToken` too. That closes the gap story 240 found
     for CI as well.
5. **On the server.**
   - A bearer that starts with `crombolo_pat_` resolves through `cli-tokens.ts`
     and `identityOf`, while `cliTokens` is on. Never from a cookie, so a token
     can't become a back-office browser sign-in.
   - Audit entries made through a token name the person, with "through the token
     *name*".
   - Creating, first use and revoking are audited under the person, in the
     `user` category.
6. **The endpoints,** `<backoffice>/crombolo/api/cli-tokens`:
   - `GET` lists your own tokens, and `?user=<key>` lists another person's, for an
     administrator;
   - `POST {name, days}` answers with the token, once, for a person whose groups
     hold `Crombolo.CliTokens.Create`, and is refused otherwise;
   - `DELETE /{key}` revokes one, your own or, for an administrator, anyone's;
   - while tokens are off, `GET` answers `{ enabled: false }` and the rest are
     refused.
7. **The CLI.**
   - `crombolo tokens new --name <name> [--expires <days>]` prints the token once
     with a line saying it won't be shown again. `-o json` gives it as a field.
   - `tokens list [--user <user>]` and `tokens revoke <name> [--user <user>]`.
   - Each is `access: 'person'`. `tokens new` needs the permission, `--user` is
     for administrators, and each takes
     `--profile`, calling the endpoints through `RemoteClient`. Locally, they use
     `cli-tokens.ts` against the site's database.
   - `CROMBOLO_TOKEN`, when set, is used before a stored sign-in:
     - the gate resolves it against the site's database and acts as its person,
       or refuses with its reason;
     - `RemoteClient` sends it as the bearer, before the keychain or CI's token,
       since it is the most explicit.
8. **The back office.**
   - A "Command-line tokens" box in the person's profile (`userProfileApp`, next
     to signed-in devices) lists their tokens. It creates one from a name and an
     expiry, shows it once with a copy button, and revokes.
   - A view on a user's workspace lets an administrator list and revoke that
     user's tokens.
   - The profile box offers "New token" only to someone whose groups hold the
     permission. Without it, the box lists any tokens they have and lets them
     revoke them.
   - The permission appears in the group editor through an `entityUserPermission`
     manifest, as the remote verbs do, labelled "Command-line tokens" and
     described as "Create tokens that let scripts run commands as you".
     `crombolo users groups permissions` lists it too.
   - Both are hidden while tokens are off.
   - The wording goes in `cli-tokens-words.js`, for people and with no technical
     terms, and is unit-tested.
9. **Docs.**
   - `docs/operations.md`: "Command-line tokens", and "Running unattended at
     `sign-in`", with a CI example setting `CROMBOLO_TOKEN` as a secret and
     `CROMBOLO_PROFILE_URL`;
   - `docs/configuration.md` (generated) and `bun run cli:spec`;
   - the release notes under Unreleased. 350's upgrade note already names
     `CROMBOLO_CLI_TOKENS=true`, and the migration is listed.
10. **Tests.**
    - `tests/cli-tokens.test.ts`, for the service and the endpoints:
      - issue, the cap and the default, only a hash kept;
      - listing your own and, as an administrator, another person's;
      - revoking;
      - each refusal: expired, revoked, disabled, locked, removed, and off with
        the token kept;
      - creating refused without the permission;
      - a token refused once its person's groups lose the permission, and working
        again when it is given back;
      - the migration giving Administrators the permission and no one else;
      - first use audited once.
    - The CLI, locally and with `--profile` against a test server:
      - `tokens new|list|revoke`;
      - a command run with `CROMBOLO_TOKEN` at `sign-in` acting as the person,
        audited with the token's name;
      - a non-administrator's `--user` refused.
    - An approval decision refused for a token, in the engine and through
      `remote.ts`, and for CI, the gap 240 noted.
    - The words module's unit test. No browser test unless asked.
    - The migration's rewinds, then SQLite and Postgres:
      `docker compose run --rm cms-test-sqlite bun run test`, the Postgres suite
      and `test:integration`.

## Acceptance criteria

- [x] `cliTokens` in `crombolo.config.ts`, or `CROMBOLO_CLI_TOKENS`, turns tokens on.
      It is off by default. With it off, no token is issued and every existing one is
      refused, without being deleted
- [x] `crombolo tokens new --name <name> --expires <days>` gives a signed-in person a
      token, printed once. Every token has an expiry, the site may cap it (default
      cap 90 days), and only a hash is kept
- [x] Creating a token needs `Crombolo.CliTokens.Create`, a group permission given
      only to Administrators at first and shown in a group's permissions as
      "Command-line tokens". A token whose person's groups no longer hold it is
      refused, with its own message, and works again when it is given back
- [x] `crombolo tokens list` and `tokens revoke <name>` act on a person's own tokens.
      An administrator lists and revokes anyone's, with `--user`
- [x] The same is in the back office: the person's profile lists their tokens and
      creates and revokes them, and the Users screen lets an administrator see and
      revoke a user's tokens
- [x] A command run with `CROMBOLO_TOKEN` acts as the token's person, locally and
      with `--profile` (story 352). It is audited under them, noting it was through that token,
      and holds their current permissions, not those they had when it was made
- [x] A token stops working when it expires, is revoked, or its person is disabled,
      locked or removed. Each is refused with its own message
- [x] A token never decides an approval, as a CI token never does (story 160)
- [x] Creating, using for the first time and revoking a token are audited
- [x] `docs/operations.md` (tokens, and running unattended at `sign-in`) and the CLI
      reference regenerated
- [x] Tests on SQLite and Postgres (a new table, so a migration and the rewind
      helpers):
      - a token acts as its person;
      - an expired, revoked or switched-off token is refused;
      - a disabled person's token is refused;
      - a token is refused an approval decision

## Built

Built 2026-11-15:
- the settings are `cliTokens` and `cliTokenMaxDays` on `CromboloConfig`, and
  `CROMBOLO_CLI_TOKENS`, `CROMBOLO_CLI_TOKEN_MAX_DAYS` and `CROMBOLO_TOKEN` in the registry;
- migration 078 is `packages/data/src/schema/cli-tokens.ts` (release 0.66.0): the
  `cli_token` table, a unique index on `(user_id, name)` where not revoked, and
  `grantBuiltInPermissions`, which gives Administrators the verb as the seed does;
- the verb is `CliTokenPermissions.Create` in `packages/core/src/permissions.ts`, plain name
  `tokens:create`;
- the service is `CliTokens` in `packages/auth/src/cli-tokens.ts`, with its refusals'
  sentences in `CLI_TOKEN_REFUSALS`;
- the endpoints are `packages/server/src/cli-tokens-api.ts`; `authenticate` in `server.ts`
  turns a `crombolo_pat_` bearer into a principal with `viaToken`, and an audit context
  whose entries say "through the token *name*" (`AuditContext.token`, and
  `setProcessAuditContext` for a command);
- `approve` and `sendBack` in `approvals.ts` refuse a principal with `ci` or `viaToken`, and
  the remote's push approval refuses `viaToken` (`token-cannot-approve`);
- the commands are `packages/cli/src/commands/tokens/`, over `support/tokens.ts`; the gate
  takes `CROMBOLO_TOKEN` before a stored sign-in (`resolveSiteToken` in
  `support/local-sign-in.ts`), and `connectSite` gives it to `RemoteClient` as a personal
  token source, which is not CI;
- the back office is `plugin/cli-tokens.js` (the profile box), `plugin/cli-tokens-user.js`
  (a Tokens view on a user, administrators only) and `plugin/cli-tokens-words.js`; the
  permission is a `Command line` entry in the group editor's Data Transfer tab, and an
  `entityUserPermission` manifest.

Where it differs from the plan:
- **The verb is explicit, as Install code is (`EXPLICIT_PERMISSIONS`).** Being an
  administrator bypasses the permission tables, so without this an administrator would hold
  it whatever their groups said, and taking it from Administrators would not refuse their
  tokens, which D2 asks for.
- **`--expires` beyond the site's cap is refused, not cut down,** saying the most the site
  allows, so a token never lasts less than asked without saying so.
- **`cli_token.user_id` has no foreign key,** so a removed person's tokens stay and are
  refused as `removed` rather than `unknown`.
- **A token is taken by `authenticate`, not `identify`.** Routes that need a session of
  their own (viewing as a group, signed-in devices) never take one.
- **A refused token's reason reaches a hosted command** through the `cli-tokens` endpoint,
  which answers `401 { reason, message }`: `RemoteClient` asks it once a token is refused.
- **The Tokens view on a user's screen shows while tokens are off,** saying the site does
  not take them, as hiding a workspace view by a server setting needs a condition of its
  own. The profile box is hidden.
