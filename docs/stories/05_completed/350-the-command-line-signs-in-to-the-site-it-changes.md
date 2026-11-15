# 350 — The command line signs in to the site it changes

**Epic:** P — The command line · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a site owner, I want to decide whether the CLI may change my site without
anyone signing in, so that a production site's changes are always made by a
named person with their permissions, while a new local site stays as quick to
script as it is today.

## Context

Decided under story 349 (D1), 2026-11-15. It replaces the "CLI sign-in story"
that 240 was held for. Personal access tokens are story 351.

Today a command run against a local site acts as "the command line". The audit
log can't name a person, nothing checks their permissions, and anything that
needs a person, like an approval decision (240), has no one to act as.
`crombolo login <remote>` already signs in to a remote through the browser
(story 107, `docs/remote-protocol.md`).

### The access level

`cliAccess` in `crombolo.config.ts`, or `CROMBOLO_CLI_ACCESS`:

| Level | Default | What it does |
| --- | --- | --- |
| `open` | in development | Commands run without a sign-in, recorded as "the command line"; a person who has signed in acts as themselves |
| `sign-in` | when `NODE_ENV` is `production` | Every command that reads or changes the site's data needs a signed-in person, and acts as them |

These commands never need a sign-in:
- starting and recovery: `init`, `start`, `restart`, `upgrade`, `admin reset-password`;
- signing in and choosing a site: `login`, `logout`, `whoami`, `profile *` (story 352);
- the commands that only work with files and never open the database:
  `generate`, `components`, `assets`, `site build|check|check-code`,
  `bundle build|digest|sign|verify`, `keys create|list`, `extension build|check`,
  `--help`.

Each command declares which group it is in, so a new command can't be missed.

An approval decision always needs a person, even at `open`.

### Signing in

- **Through the running site.** When the site is running, `crombolo login` signs in
  through its own sign-in page, by the same browser flow a remote uses. Every
  provider the site offers (Entra, OIDC) works, and so does two-factor.
- **Not with the site stopped.** Signing in needs the site running, and
  `crombolo login` says to start it when it isn't. Commands need no server once
  someone is signed in: they check the session against the database and renew it
  while it is still valid. In development the level is `open`. In production the
  server is running, and recovery (`start`, `upgrade`, `admin reset-password`)
  needs no sign-in.
- **With a personal access token**, where the site turns them on (story 351).

`init` doesn't sign in (decided 2026-11-15, after building). At `open`, the
development default, nothing needs it. At `sign-in` the walk-through is
`crombolo start`, then `crombolo login`.

### What it does not protect

Whoever holds the database credentials can go around the CLI. The level makes
every change attributed and permission-checked, and does not stop them. Keeping
production's credentials private, and changing a hosted site through `--profile` (story 352),
is what protects it. `docs/operations.md` says so.

## What is there to build on

- **Who a command acts as.** `Actor` (`packages/content/src/actor.ts`) already
  has a `user` kind, carrying the person's permissions, start nodes and
  languages. Commands use `operator` today, built in four places:
  `support/publish.ts`, `pages.ts`, `tree.ts` and `recycle-bin/empty.ts`. Other
  commands are audited by `recordCommand` (`operations/commands.ts`), which names
  `CROMBOLO_ACTOR` or the OS account, never a user.
- **Signing in.** `crombolo login <remote>` uses the device grant
  (`packages/auth/src/device.ts`). The person approves a code at
  `<backoffice>/device`, after signing in there with any provider, and the
  approval becomes a back-office session of its own. That session is listed
  under signed-in devices and can be revoked. Its tokens are reference tokens
  in `auth_token`, so a command can check one against the site's database with
  `AuthService.resolveAccessToken`, with no server running.
- **What a person may do.** The server builds it in `principalFrom`, inside
  `createServer` (`server.ts`). The Management API checks it by section and
  permission verb (`api-management/src/authorization.ts`).
- **Whether a server is running.** `crombolo start` writes
  `.crombolo/supervisor.json` with its port. A site run some other way is
  found by trying the configured port.

## Decisions

- **D1: what a signed-in person may do with commands that aren't about pages
  or media.** Page and media commands check through the `user` actor, exactly
  as the back office does. For the rest (types, forms, webhooks, users,
  operations, extensions):
  - (a) each command declares the back-office section its screen is in, and
    that it is for administrators where the back office limits it to them. The
    gate refuses a person who lacks either. *Recommended:* the CLI then allows
    exactly what the back office allows.
  - (b) those commands are for administrators only.
  - (c) any signed-in person may run them, with only page and media checked.

  **Decided 2026-11-15: (a).**
- **D2: signing in when no server is running.** **Decided 2026-11-15: not
  offered.** Commands run without a server, but signing in rarely needs to
  happen with the site stopped (see "Signing in"). A second place on the machine
  that takes passwords costs more than it saves. Back-office sessions end after
  80 minutes unused, so someone working with the site stopped may have to start
  it to sign in again. A longer lifetime for a command-line sign-in is left until
  someone needs it.
- **D3: what `crombolo login` with no argument means.** Today it signs in to
  the only remote.
  - (a) no argument means this site, and a remote is always named. *Recommended:*
    it matches `logout` and `whoami`. It is a change for anyone with one remote,
    which a release note covers.
  - (b) no argument means this site only when there are no remotes, and
    otherwise the only remote, as today.
  - (c) a `--local` flag.

  **Decided 2026-11-15: (a).** `login`, `logout` and `whoami` with no argument
  act on this site, and a hosted site is always named, with `--profile` (story
  352). A command for a hosted site run without a sign-in says to run
  `crombolo login --profile <name>`, naming the profile. The release
  notes say that a plain `crombolo login` no longer signs in to the only remote.
- **D4: when it ships.** At `sign-in`, a production deploy that runs data
  commands locally, such as `site apply` in its container, has no person until
  tokens exist (351).
  - (a) 350 and 351 ship in the same release. *Recommended.*
  - (b) 350 ships first, with an upgrade note to set `CROMBOLO_CLI_ACCESS=open`
    until 351.

  **Decided 2026-11-15: (a).** 350 is not released until 351 is built. The
  release notes give one upgrade note: a production deploy that runs data
  commands needs a token from then on, with `CROMBOLO_CLI_TOKENS=true`, or else
  `CROMBOLO_CLI_ACCESS=open`.

## Plan

1. **The setting.**
   - `cliAccess: 'open' | 'sign-in'` on `CromboloConfig`, with `CROMBOLO_CLI_ACCESS`
     in the settings registry. The default is `sign-in` when `config.development`
     is false and `open` otherwise. Any other value is refused at start.
   - A production server set to `open` logs one warning at start.
   - `bun run docs:config` regenerates the table.
2. **Each command says what it needs.**
   - `static access: 'none' | 'site' | 'person'` on `BaseCommand`:
     - `none` never needs a sign-in (the list in "The access level");
     - `site` needs one at `sign-in`;
     - `person` always needs one.
   - With D1 (a), also `static section` and `static adminOnly`.
   - `tests/cli-access.test.ts` reads every command, the plugin's included, and
     fails one that declares nothing. It also pins the `none` list, so widening
     it is a visible change.
3. **The gate.** In `BaseCommand.init`, before `run`, for anything but `none`:
   - read the site's sign-in from the keychain and resolve it through
     `AuthService` against the site's database, refreshing an expired access
     token with its refresh token;
   - build the person with the extracted principal (step 4) and keep it on the
     command;
   - with no sign-in, at `sign-in` or for a `person` command, refuse with `auth`
     and a `crombolo login` hint before anything is opened for writing;
   - an ended session is refused with its own message, and never falls back
     to the command line;
   - imports stay lazy, so `--help` and the file-only commands pay nothing.
4. **One principal.** Move `principalFrom` and `loadAccess` out of `createServer`
   into `packages/server/src/principal.ts`, used by the server and the CLI alike.
5. **Acting as the person.**
   - A `commandActor()` helper gives `userActor(principal, { source: 'cli' })` when
     someone is signed in, and `operatorActor` otherwise. The four call sites use
     it. `userActor` takes the origin's source rather than always `request`.
   - `recordCommand` names the user (`userKey` and name) when someone is signed
     in, and ignores `CROMBOLO_ACTOR` then.
   - `--skip-approval` with a sign-in is refused to anyone but an administrator,
     in `support/publish.ts`.
   - With D1 (a), the gate checks `section` and `adminOnly` against the principal.
6. **`login`, `logout` and `whoami` for this site** (with D3 (a)):
   - `login` with no argument, and a site here, finds a running server
     (`supervisor.json`, then the configured port). It runs the device grant
     against that server's own endpoints, as `signIn` does for a remote, so
     providers and two-factor work.
   - With no server found, `login` is refused with `unavailable`, saying to start
     the site with `crombolo start` and sign in again.
   - The sign-in is kept in the keychain under the site's database: its SQLite
     file's absolute path, or its Postgres host, port and database name. Two
     folders on one database share it.
   - `logout` ends the session in the database, as a revoked device would, and
     removes the keychain entry.
   - `whoami` names the person, the site and the access level, or says no one
     is signed in.
   - With no argument, all three always mean this site. `RemoteClient`'s hint
     (`remote/client.ts`, "Run `crombolo login` first") names the remote it
     wants: `crombolo login --profile <name>`.
7. **`init`** — dropped. It creates no administrator, and a development start
   resets the administrator's password, ending any session `init` had made.
8. **Tests.**
   - `tests/cli-access.test.ts`: the declarations, the gate at both levels, a
     `person` command at `open`, an ended session, and that a refused command
     changed nothing.
   - `tests/cli-local-sign-in.test.ts`, against a test server, approving the
     code through the API, so no browser test is needed:
     - a sign-in that works, its session listed as a device, and the audit entry
       of a command run after it naming the person;
     - a command still working with the server stopped, and renewing the session;
     - `logout` ending the session, and an ended or revoked session refused;
     - `login` with no server found refused, saying to start the site.
   - The existing CLI tests run at `open`, since the test containers don't set
     `NODE_ENV=production`. That is checked when this is built.
   - The integration suite gains a `sign-in` walk-through:
     `init`, `whoami`, a `content new` acting as the administrator, and `logout`.
9. **Docs.**
    - `docs/configuration.md` (generated);
    - `docs/operations.md`, "Signing in from the command line": the levels, the
      ways in, and what they don't protect;
    - the CLI reference, regenerated;
    - `docs/building-a-site-from-the-cli.md`, for a production site;
    - `README` only if the setup steps change;
    - the release notes, with upgrade notes for the production default and for
      D3.

## Acceptance criteria

- [x] `cliAccess` and `CROMBOLO_CLI_ACCESS` take `open` or `sign-in`. The default
      follows `NODE_ENV`, and anything else is refused at start with the two values
- [x] A production site set to `open` starts with a warning, once, naming the setting
- [x] Every command declares whether it needs no sign-in, a sign-in at `sign-in`, or
      a person always. A unit test fails a command that declares none
- [x] At `sign-in`, a command that needs one, run without a sign-in, is refused
      with exit code `auth`, saying how to sign in. Nothing is read or changed
- [x] `crombolo login` with no remote signs in through the running site, its
      providers included, when the site is running
- [x] With no server running, `crombolo login` is refused, saying to start the site
- [x] A signed-in command works with the server stopped, renewing the session while
      it is still valid
- [x] The session is kept for that site, in the same place as a remote's, and ends
      with `crombolo logout`. `crombolo whoami` names the person, the site and the
      access level
- [x] Signed in, a command acts as that person at either level. The audit log names
      them, and permission checks use theirs
- [x] A session expires as a back-office session does. An expired one is refused
      and asks for a new sign-in, and never falls back to acting as the command line
- [x] ~~`init` signs the terminal in as the administrator it creates~~ — dropped: see "Built"
- [x] `--skip-approval` with a sign-in is limited to administrators
- [x] The CLI tests, integration flows and walk-throughs run at `open`, and a test
      covers `sign-in` for one command of each group
- [x] Docs:
      - `docs/configuration.md` gains the setting;
      - `docs/operations.md` gains signing in, the levels, and what they do not protect;
      - the CLI reference is regenerated;
      - `docs/building-a-site-from-the-cli.md` covers a production site
- [x] Tests:
      - a sign-in through a running server, and a command after it with the server stopped;
      - a signed-in command is audited under the person;
      - an expired session is refused;
      - a command run without a sign-in at `sign-in` changes nothing

## Built

Built 2026-11-15:
- the setting is `cliAccess` on `CromboloConfig` and `CROMBOLO_CLI_ACCESS` in the registry,
  defaulting from `development` after the config file is merged; the warning is logged once
  by `createServer`;
- each command declares `static access`, and with D1 (a) `section` (one section, or a list
  of which any one will do) and `adminOnly`; the table is in `docs/operations.md`,
  "Signing in from the command line". A command that declares nothing is taken to be `site`,
  for a plugin built before this; `tests/cli-access.test.ts` fails one of ours;
- the gate is `packages/cli/src/support/gate.ts`, run from `BaseCommand.init`; who a
  command acts as is `support/acting.ts` (`commandActor()`, `signedIn()`); the site's
  sign-in, its storage, renewal, revocation and finding the server are
  `support/local-sign-in.ts`; `deviceSignIn` is split out of `signIn` in `remote/client.ts`;
- the principal is `principalOf` in `packages/server/src/principal.ts`;
- `CROMBOLO_CREDENTIALS_FILE` places the credentials file; the test preload
  (`tests/support/isolate.ts`) sets it, with `CROMBOLO_CREDENTIALS=file`, for every run.

Where it differs from the plan:
- **`init` does not sign in, decided 2026-11-15.** `init` only writes files: the database, and its
  administrator, are made by the first command or `crombolo start` that opens it. And in
  development `crombolo start` gives the administrator a new password on every start,
  which ends their sessions, so a sign-in `init` made would end at the first start and
  every command after it would be refused until `crombolo login`. At `open` nothing needs
  it; at `sign-in` the walk-through is `start`, then `login`. Making the database in `init`,
  or sparing command-line sessions from start's password reset, were weighed and declined.
- **The `none` list adds `schema`, `types rewrite`, `extension migrate` and `upgrade
  check|ledger`,** by the story's own rule: they work only with files, or are recovery.
  Moved commands, which only say where they went, are `none` too.
- **A user actor may carry `skipApproval`,** honoured for an administrator only
  (`packages/content`), since the back office's actor had no way to skip an approval.
- **A page written from the command line is saved with `overwrite`,** as it is read and
  written in one go: a user actor otherwise needs the revision it was based on.
- **`push` and `pull` check each site folder they read or replace,** and a hosted site is
  checked by the site itself; a hosted-only command (`hostedFlags`) is never gated here.
- **`login` checks the server it found is this site's** by resolving the new session in
  this folder's database, and refuses one that signed it in to another.
- **`whoami` here** returns `name` and `email` as null when nobody is signed in, and an
  `access` field.
- **A command with `--profile` whose flags do not parse, or whose profile cannot be chosen,
  is left to refuse that itself,** as it does before doing anything, so its own message
  comes first.
- **The section refusal is `refused`,** the kind for a permission; the sign-in refusals are
  `auth`.

