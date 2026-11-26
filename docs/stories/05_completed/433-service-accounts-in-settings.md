# 433 — Service accounts in Settings

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 026, 207, 298, 389, 405, 429

## Story

As someone running a site, I want to see and look after the accounts that other systems
and the site's own code use, so that I know what each one is for, what it may do, and
what would stop working without it.

## Context

Asked for by the maintainer on 2026-11-26, while deciding what a job acts as (207).

A service account is an API user: groups like anyone's, client ids with a secret each,
and no password. Today it is a row among the people in Users, and what it needs is spread
about:

- **What it is for is nowhere.** The config names accounts by client id, and no screen
  says so: `content.actAs` (298), `members.actAs` (207), `users.managedBy` (389) and
  `groups.managedBy` (405).
- **Taking one away breaks the site with no warning.** A removed client id, or a disabled
  or deleted account, that `content.actAs` or `members.actAs` names refuses the next boot;
  until then the writes it makes answer `forbidden`. A directory's client just stops.
- **Last used is half known.** `user_account.last_login_date` is the account's, not the
  client id's, and moves only when a token is issued. The site's own code acts as an
  account without one, so an account in daily use may look never used.
- **One that was ever used cannot be deleted,** only disabled
  (`CannotDeleteUserWithLoginHistory`).
- **A secret cannot be replaced in place.** A client id holds one secret. Removing and
  adding the same id leaves a gap; adding a second id means changing whoever signs in with
  the first, and the config where it is named.
- **A removed secret's tokens still work** until they expire: removing a client id ends no
  session. Disabling the account does.
- **A secret was a way round group ownership.** Giving a group to someone needs ownership
  of it (302), but anyone with Users could add a secret to any account that was not an
  administrator, and sign in with what that account's groups may do. Fixed on 2026-11-26,
  before this story: only an administrator adds a secret (`AdministratorsOnly`).

## The design

- **A card in Settings,** "Service accounts", in People. Its description: "Accounts that
  other systems and the site's own code use".
- **The list:** name, groups, client ids, last used, whether it is enabled, and what it is
  used for.
- **An account's screen:** name, groups, its client ids with when each was added and last
  used, "Used for", enable and disable, delete, and its entries in the audit log.
- **"Used for" is in words,** from what the server was started with: "Changes pages for the
  site's own code", "Reads and changes members for background jobs", "Keeps this site's
  users up to date", "Keeps this site's groups up to date".
- **A new secret is made by the server and shown once,** with a copy button. Only its hash
  is kept, as now.
- **Disabling or deleting an account, or removing a client id, that is used for something**
  says what will stop, and asks, with `ask()`. The API refuses it unless the caller says
  they know, so the command line asks as well.
- **Removing a client id ends the sessions made with it.**

## Decisions (2026-11-26, the maintainer's)

1. **Administrators alone** manage service accounts: the card, creating, changing,
   disabling, deleting and their secrets. Adding a secret is administrators' already.
2. **Listed in Service accounts only:** Users shows people, and an old link to an API user
   opens its screen here. The Management API's user list stays Umbraco's.
3. **Last use per client id,** a token issued with it and the site's code acting as its
   account, written at most once an hour. A migration.
4. **Two secrets while switching:** a client id may hold a second secret, and making it says
   when the old one stops (now, a day, a week). A migration.
5. **A used account may be deleted** after the warning names what depends on it; the audit
   log keeps its name. People keep today's rule.

Built into 0.81.0 at the maintainer's ask, so migration 102 names 0.81.0.

## Acceptance criteria

- [x] Settings has the card, for administrators; anyone else is refused by address and by
      the API, adding a secret included.
- [x] The list and each account show groups, client ids, last used and what it is used for;
      each of the four settings is shown on the account it names.
- [x] An account is created, changed, enabled, disabled and deleted there, and Users lists
      people only. An old link to an API user opens its screen here.
- [x] A secret is shown once, when made, and is in no later answer, log or audit entry.
- [x] A replaced secret works until the time chosen, and not after.
- [x] Taking away what something depends on says what will stop and asks; the API refuses it
      unless told, naming each use.
- [x] Removing a client id ends its sessions, and leaves the account's others.
- [x] A token issued, and the site's code acting as the account, move last used, at most
      hourly.
- [x] Every change is in the audit log, naming the account and client id.
- [x] With `users.managedBy` set, service accounts stay the administrator's.
- [x] No client id prefix, hash or setting's name is needed to use the screens.
- [x] `docs/backoffice-hosting.md`, `docs/configuration.md` and the release notes describe
      it. Tests on SQLite and Postgres.

## What was built

- Migration 102 `AddServiceAccountSecrets`: `last_used_at`, `old_secret_hash`,
  `old_secret_until` on `user_client_credential`, undone in every test rewind.
- `UserRepository`: `clientCredentialDetails`, `replaceClientSecret`,
  `touchClientCredential` (hourly), and `removeClientCredential` ending the sessions made
  with the client id. The token grant takes the old secret until it stops and moves last use;
  `apiUserPrincipal(db, id, { used: true })` moves it for `content.actAs` and `members.actAs`.
- `packages/server/src/service-accounts.ts`: `serviceAccountUses` (the config's four
  settings, in words) and the API at `<plugin>/api/service-accounts`, administrators only,
  audited by itself; a use the config names answers 409 unless `?confirm=true`.
- The Management API's user adapter: anyone but an administrator is refused an API user and
  making one; a person's user lists leave API users out; deleting, disabling or removing a
  client id the config names is `ServiceAccountInUse`; a used API user may be deleted.
- The back office: the Service accounts card and screen (`service-accounts.js`,
  `service-accounts-words.js`), and an old link to an API user sent to it
  (`service-account-redirect.js`). `crombolo api-client rotate --old-stops`.
- Tests: `service-accounts.test.ts`, `service-accounts-words.test.ts`, the browser's
  `settings-dashboards.browser.ts`.
- Docs: `backoffice-hosting.md` ("Service accounts"), `configuration.md`, `operations.md`,
  the release notes.
