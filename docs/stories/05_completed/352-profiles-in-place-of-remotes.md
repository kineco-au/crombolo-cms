# 352 — Profiles in place of remotes

**Epic:** P — The command line · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As someone who works on several sites, hosted or in folders on my machine, I
want them named once, in a file of my own, and chosen with `--profile` from any
folder, as the AWS and Databricks CLIs do. I also want to pull and push between
any two of them, so that I don't need a site's folder to reach it, and a machine
with no keychain can still keep my sign-in.

## Context

Decided 2026-11-15 while planning 350.

Today a site's `remotes.toml` (story 108, `packages/cli/src/remote/remotes-file.ts`)
names its remotes. It is committed, and holds addresses only. Commands choose
one with `--remote <name>`, or with a positional argument for `login`, `logout`
and `whoami`. Sign-ins go in the OS keychain, keyed by the remote's address.

Settled:

- **`~/.crombolo/profiles` replaces `remotes.toml`.** It is a TOML file of the
  person's own, with one table per profile. `CROMBOLO_PROFILES_FILE` points
  somewhere else, for tests and unusual machines.
- **A profile is a hosted site or a site folder,** with exactly one of `url` and
  `path`. `environment` applies to a hosted site only:
  ```toml
  [default]
  url = "https://riverside.example"
  environment = "production"

  [staging]
  url = "https://staging.riverside.example"

  [riverside-copy]
  path = "~/dev/riverside-copy"
  ```
  A folder profile on a single-site command acts on that folder's site, as the
  command would run there, with that site's own sign-in level (story 350). A
  leading `~` is the home folder, and a relative path is refused.
- **The CLI no longer reads `remotes.toml`.**
- **`--profile <name>` replaces `--remote`** on every command, and
  `CROMBOLO_PROFILE` chooses one for a shell or a job. `--remote` is removed,
  and a command given it says to use `--profile`.
- **A site described by the environment.** With no `--profile` and no
  `CROMBOLO_PROFILE`, `CROMBOLO_PROFILE_URL` (with `CROMBOLO_PROFILE_ENVIRONMENT`, optional)
  describes the site in place of a profile. This is how a CI job names its
  target, alongside its other settings, with story 160's sign-in unchanged.
- **Which comes first:** `--profile`, then `CROMBOLO_PROFILE`, then `CROMBOLO_PROFILE_URL`,
  then the `default` profile.
- **The default never redirects a local command.** A command that can act on
  this folder's site or another one (`content find`, `audit list`, and the
  `--profile` options story 349 adds) acts on another only when `--profile`,
  `CROMBOLO_PROFILE` or `CROMBOLO_PROFILE_URL` says so. Otherwise it acts on this folder's
  site. The `default` profile is used only:
  - by commands that always act on a hosted site: `site deploy`, `remote trust *`
    and `remote job`;
  - for the side of `push` or `pull` that defaults to it (below).

  Nobody publishes to production by forgetting where they are.
- **`pull` and `push` take two sites, `--from <profile>` and `--to <profile>`,**
  either of which may be hosted or a folder:

  | Command | `--from` when left out | `--to` when left out |
  | --- | --- | --- |
  | `push` | this folder's site | the `default` profile |
  | `pull` | the `default` profile | this folder's site |

  So `crombolo push --to live` and `crombolo pull --from live` read as today, and
  `crombolo push --from riverside-copy --to staging` works from any folder. The
  two commands do one job with mirrored defaults. Only profile names are
  accepted, never a path or an address, so an option never means two things.
  Leaving a side out is how you mean this folder. `CROMBOLO_PROFILE` and
  `CROMBOLO_PROFILE_URL` stand for the side that defaults to `default`.

  How each pair runs:
  - **Folder to folder:** an export from one, applied to the other on this
    machine, checked and backed up as `site apply` is.
  - **Folder and hosted:** as today's `push` and `pull`.
  - **Hosted to hosted:** pulled into a temporary folder, then pushed, signed in
    to both, with everything, media included, passing through this machine. A
    copy straight from one server to the other is not part of this story.

  The receiving site's own rules hold whichever way it is reached: a protected
  environment, approval of a push, and its sign-in level. An option that only
  makes sense for a hosted side, such as `--lazy-media` or `--media-info-only`,
  is refused when that side is a folder. A hosted side's environment comes from
  its profile, else `--from-env` or `--to-env`. `--env` works when only one side
  is hosted.
- **Sign-ins stay in the keychain.** A folder profile has none of its own: it is
  that site's sign-in (story 350). On a machine with none, they go in
  `~/.crombolo/credentials`, readable only by its owner, never in the profiles
  file. Both are keyed by the site's address, as now, so two profiles for one
  site share a sign-in.
- **Commands:**
  - `crombolo remote add|list|remove` become `crombolo profile add|list|remove`;
  - `remote trust *` and `remote job` keep their names, since they act on a
    hosted site rather than on the list, and take `--profile`;
  - `login`, `logout` and `whoami` take `--profile` in place of their argument.
    With neither, they mean this folder's site (story 350, D3);
  - `pull` and `push` take `--from` and `--to` in place of their argument.
- **Existing sites.** While a site's folder still has a `remotes.toml`, each
  command that would have read it says once how to move it: `crombolo profile
  import`. That copies its entries into the profiles file, and refuses a name
  already there unless given `--replace`. It leaves the committed file for the
  team to delete.

## What is there to build on

- **`remotes-file.ts`** reads and writes `remotes.toml`, and holds the name rule
  (`[a-z][a-z0-9-]{0,39}`). It rewrites the whole file on each change.
  `pickRemote` takes the only remote when none is named.
- **`connectRemote(name, env)`** (`support/remote.ts`) is the one place a
  command turns a name into a site. It discovers the site, builds a
  `RemoteClient` with the keychain or CI's identity token, and picks the
  environment. Its 19 callers are:
  - `login`, `logout`, `whoami`, `push`, `pull`;
  - `remote job` and `remote trust *`;
  - `content find`, `site revert` and `site runs`;
  - `support/audit.ts`, `bundles.ts`, `remote-apply.ts` and `restart.ts`, behind
    `audit list`, `extension *`, `site apply|deploy` and `restart`.
- **How commands name a remote today:**
  - `login`, `logout`, `whoami`, `push`, `pull`, `remote job` and `remote trust *`
    take it as a positional argument;
  - 11 commands take `--remote` and `--env`, each declaring its own pair.
- **The keychain** is `osKeychain()` in `@crombolo/server/remote-credentials`,
  through `Bun.secrets` and keyed by origin. `memoryKeychain()` stands in for
  tests. The media a lazily pulled site reads through to its remote
  (`remote-media.ts`) uses the same keychain, so both must find the same sign-in.
- **The plugin entry** (`@crombolo/cli/plugin`, story 158, covered by semver)
  exports `keychain` and `RemoteClient`, so a hosting plugin signs in where
  `login` does.
- **Docs.**
  - The CLI reference is `bun run cli:spec`.
  - The product site's guide is `sites/crombolo/docs/guides/remotes.md`, with its
    content file made by `bun run build:template`.
  - `tests/docs-site.test.ts` uses that guide to check the generated header.

## Decisions

- **D1: how `profile add` and `profile remove` change the file.** It is the
  person's own file, which they may edit and comment.
  - (a) change only the table being added, replaced or removed, leaving the rest
    of the file as it was, comments included. *Recommended.*
  - (b) rewrite the whole file from what was read, as `remotes.toml` is rewritten
    today. This is simpler, but loses comments and ordering.

  **Decided 2026-11-15: (a).**
- **D2: a command that always acts on a hosted site, with nothing chosen and no
  `default` profile.**
  - (a) refused, listing the profiles there are, with a hint at `--profile`, or at
    `profile add default`. *Recommended:* one file now serves every site, so "the
    only one" may be a different site from the one in this folder.
  - (b) the only profile, when there is exactly one, as `pickRemote` does today.

  **Decided 2026-11-15: (a),** for these commands and for the side of `push` or
  `pull` that defaults to `default`.
- **D3: when sign-ins go in `~/.crombolo/credentials`.**
  - (a) automatically, when the keychain can't be reached, saying so at each
    sign-in. `CROMBOLO_CREDENTIALS=keychain|file` forces one. *Recommended:* a
    container or CI runner needs no setup.
  - (b) only when `CROMBOLO_CREDENTIALS=file` is set. With no keychain and no
    setting, signing in is refused, saying how. Tokens are never written to disk
    unless someone asked for that.

  **Decided 2026-11-15: (a).** `CROMBOLO_CREDENTIALS`, `CROMBOLO_PROFILE`,
  `CROMBOLO_PROFILES_FILE`, `CROMBOLO_PROFILE_URL` and `CROMBOLO_PROFILE_ENVIRONMENT` go into the
  settings registry (`packages/server/src/settings.ts`), as `CROMBOLO_ACTOR` is,
  so `bun run docs:config` lists them in `docs/configuration.md`.

## Plan

1. **The file** (`packages/cli/src/profiles/profiles-file.ts`, in place of
   `remotes-file.ts`):
   - it is read from `CROMBOLO_PROFILES_FILE`, else `~/.crombolo/profiles`
     (`os.homedir()`, so Windows works too);
   - each table is a profile with exactly one of `url` (with an optional
     `environment`) and `path`, under the name rule kept from `remotes-file.ts`;
   - a `path` is expanded from `~`, must be absolute, and is checked to hold a
     site (`crombolo.config.ts`) when it is used rather than when the file is read;
   - an unknown key, a bad name or bad TOML is refused, naming the profile or
     line, so a typo isn't ignored;
   - writing follows D1, atomic as now, creating `~/.crombolo` with mode 700.
2. **Choosing the site** (`packages/cli/src/profiles/choose.ts`):
   - `chooseSite({ profile, env }, { mayDefault })` follows the order
     `--profile`, `CROMBOLO_PROFILE`, `CROMBOLO_PROFILE_URL` (with `CROMBOLO_PROFILE_ENVIRONMENT`),
     then `default`, the last only when `mayDefault`;
   - it answers with a hosted site (name, URL, environment), a folder (name,
     path), or nothing, which a command that can act locally reads as "this
     folder's site";
   - for a single-site command, a folder answer changes the process's working
     folder to that site before the command runs. The CLI reads `process.cwd()` in
     42 places, and a command is one process, so this is safer than threading a
     folder through all of them. `push` and `pull` instead load each side's
     config from its own folder (`loadConfig(overrides, dir)`), since the
     operations they call take a config;
   - with nothing for a hosted-only command, it is refused per D2;
   - an unknown name is refused, listing the profiles there are.
3. **One connection.** `connectRemote` becomes `connectSite(choice)`, taking what
   `chooseSite` answered. Discovery, the client, the CI token and the environment
   are unchanged. The 19 callers move to it:
   - the hosted-only ones with `mayDefault: true`: `site deploy`, `remote job`,
     `remote trust *`, and `login`, `logout` and `whoami` when given `--profile`;
   - the rest with `mayDefault: false`;
   - a hosted-only command given a folder profile is refused, saying it needs a
     hosted site.
4. **One pair of flags.** `profileFlags` in `support/flags.ts`:
   - `--profile <name>` and `--env <id>`, plus a hidden `--remote` that is
     refused with "use `--profile <name>`";
   - the 11 commands use it in place of their own pair;
   - the positional argument on the twelve commands that took one becomes
     `--profile`. A hidden optional argument stays for one release, refusing a
     name with "use `--profile <name>`", so `crombolo push live` explains itself;
   - `login`, `logout` and `whoami` with no `--profile` mean this folder's site,
     which story 350 builds. Until then they say a profile is needed.
5. **`pull` and `push` between any two sites** (`remote/transfer.ts` and a new
   `support/site-copy.ts`):
   - `--from` and `--to`, each a profile name, defaulting as the table says, with
     `--from-env`, `--to-env`, and `--env` when only one side is hosted;
   - one routine underneath both commands, choosing by the pair:
     - folder to folder: `site export` from one into a temporary file, then the
       import `site apply` uses on the other, with its check, backup and
       confirmation;
     - folder and hosted: the existing push and pull paths;
     - hosted to hosted: a pull into a temporary folder, then a push from it,
       removed afterwards, even on failure;
   - the source and target are named in the confirmation and the output, so it
     is always clear which site is replaced;
   - the same profile on both sides, or two profiles naming one site, is refused;
   - options for a hosted side only are refused for a folder side, naming the
     option;
   - pulling into an empty folder and starting it, as `pull` does today, stays.
6. **Profile commands.**
   - `remote add|list|remove` move to `profile add|list|remove`. `list` says, for
     each profile, whether you are signed in and where that sign-in is kept;
   - `profile import [--replace]` reads `./remotes.toml` and adds its entries;
   - `support/remote.ts` warns once per command, on stderr, when the folder has a
     `remotes.toml`;
   - `packages/cli/package.json`'s topic for `remote` changes to `remote trust`
     and `job` only, and a `profile` topic is added.
7. **Where sign-ins go** (in `@crombolo/server/remote-credentials`, so the CLI
   and the lazy media store agree):
   - `userKeychain()` uses the OS keychain, else, per D3,
     `~/.crombolo/credentials`: JSON by origin, mode 600, written atomically;
   - `osKeychain()` stays, for what calls it today;
   - `remote-media.ts` and the CLI's `keychain()` use `userKeychain()`;
   - `login` says which one it used.
8. **The plugin entry** adds `chooseSite`, `connectSite` and `profileFlags`, so a
   hosting plugin's commands choose a site the same way. This is a minor version
   in semver terms, and its docs say so.
9. **Remove** `remotes-file.ts`, `pickRemote` and every read of `remotes.toml`.
10. **Docs.**
   - `docs/remote-protocol.md` and `docs/operations.md`: profiles, the order,
     the default rule and the credentials file;
   - story 160's CI examples in the docs, using `CROMBOLO_PROFILE_URL`;
   - the product site's remotes guide, with `bun run build:template` rerun;
   - `bun run cli:spec`, and `bun run docs:config` for the new variables;
   - `README` if its setup mentions `remotes.toml`;
   - the release notes, with the upgrade note.
11. **Tests.**
    - `tests/profiles.test.ts`:
      - reading, with a bad key, a bad name and bad TOML;
      - add, replace and remove leaving the rest of the file alone, under D1;
      - the order step by step, and that `default` never changes where a local
        command acts;
      - D2's refusal;
      - `import` with and without `--replace`;
      - the `remotes.toml` warning;
      - `--remote` and a positional name refused with the hint;
      - a folder profile on a single-site command acting on that folder;
      - a hosted-only command refusing a folder profile.
    - `tests/site-copy.test.ts`:
      - folder to folder both ways, with the target backed up;
      - folder to hosted and back, and hosted to hosted, against two test servers;
      - the defaults of each side;
      - the same site on both sides refused;
      - a hosted-only option refused for a folder side;
      - the temporary folder removed after a failure.
    - `tests/remote-credentials.test.ts`: the credentials file's mode and
      contents, and the switch from the keychain under D3.
    - `tests/remote-cli.test.ts`, `tests/cli.test.ts`, `tests/cli-plugin.test.ts`,
      `tests/audit-read.test.ts` and `tests/content-query.test.ts` move to
      profiles, with `CROMBOLO_PROFILES_FILE` in each test's own folder.
    - A CI-style run with only `CROMBOLO_PROFILE_URL` and the CI identity token.
    - No browser tests. No database dialect tests, since the data layer is
      untouched. `site export` and `site apply` already run on both.

## Acceptance criteria

- [x] `~/.crombolo/profiles`, or `CROMBOLO_PROFILES_FILE`, is read as TOML. Each
      table is a profile with `url` (and, optionally, `environment`) or `path`. A
      name follows the rule remote names do. A malformed file is refused, naming
      the line
- [x] A folder profile on a single-site command acts on that folder's site, at
      that site's sign-in level. A hosted-only command refuses one
- [x] `crombolo profile add <name> <url> [--env <id>]`, `profile add <name> --path <dir>`,
      `profile list` and `profile remove <name>` edit it, changing only that profile's
      table, written atomically, creating the folder and file when absent.
      `profile add` checks that the address answers as a crombolo site, as
      `remote add` does, or that the folder holds a site
- [x] `pull` and `push` take `--from` and `--to`, with the defaults in the table,
      and copy between any two sites, folder or hosted. The receiving site's checks,
      backup, protection, approvals and sign-in level apply. The same site on both
      sides is refused, and so is a hosted-only option on a folder side
- [x] `--profile` on every command that took `--remote`, and on `login`, `logout` and
      `whoami`. `--remote` is refused with a hint at `--profile`
- [x] The order `--profile`, `CROMBOLO_PROFILE`, `CROMBOLO_PROFILE_URL` with
      `CROMBOLO_PROFILE_ENVIRONMENT`, then `default`, with `default` used only by commands
      that always act on a hosted site and for the side of `push` or `pull` that
      defaults to it. A unit test covers each step, and that the default never
      changes where a local command acts
- [x] With nothing chosen and no `default`, such a command is refused, listing
      the profiles there are (D2)
- [x] A named profile that doesn't exist is refused, listing those that do
- [x] Sign-ins in the keychain, or in `~/.crombolo/credentials` (mode 600) where
      there is no keychain. The CLI says which it used when it signs in
- [x] `crombolo profile import` copies a `remotes.toml` into the profiles file,
      refusing a clash without `--replace`. A command that finds one says once how
      to move it
- [x] `remotes-file.ts` and the reading of `remotes.toml` are removed
- [x] Docs:
      - `docs/remote-protocol.md` and `docs/operations.md`;
      - the remotes guide on the product site (`sites/crombolo/docs/guides/remotes.md`
        and its content files);
      - the CLI reference, regenerated;
      - story 160's CI examples, using `CROMBOLO_PROFILE_URL`
- [x] Release notes, with an upgrade note: `remotes.toml` is no longer read, so run
      `crombolo profile import` in each site's folder. `push <name>` and `pull <name>`
      become `push --to <name>` and `pull --from <name>`, and CI jobs set
      `CROMBOLO_PROFILE_URL` in place of `--remote <name>`
- [x] Tests:
      - `tests/remote-cli.test.ts` and `tests/cli.test.ts` move to profiles, with
        `CROMBOLO_PROFILES_FILE` pointing into the test's own folder;
      - `tests/docs-site.test.ts` follows the guide's changes;
      - a CI-style run with only `CROMBOLO_PROFILE_URL`;
      - `tests/site-copy.test.ts` for each pair of sites

## Built

Built 2026-11-15 as planned:
- the profiles file is `packages/cli/src/profiles/profiles-file.ts`, and choosing a site is
  `packages/cli/src/profiles/choose.ts`;
- `connectSite` replaces `connectRemote` in `support/remote.ts`;
- the copy under `push` and `pull` is `support/site-copy.ts`;
- `userKeychain()` and `fileKeychain()` are in `@crombolo/server/remote-credentials`;
- the five settings are in the registry, which `@crombolo/server/settings` now exports on
  its own, so the plugin entry loads no site package;
- `remote add|list|remove` stay as hidden moved commands that name `profile add|list|remove`.

Where it differs from the plan:
- **`profileFlags` is in `support/remote.ts`, not `support/flags.ts`.** That keeps the
  plugin entry from loading what `flags.ts` imports. It comes with `hostedFlags`, the
  `--profile` that hosted-only commands take, and `hostedOrHere`, which does the folder
  move for single-site commands. The plugin entry exports all three.
- **Hosted to hosted pushes the pulled file directly.** It is pulled into a temporary
  folder, removed afterwards even on failure, and pushed from there without being opened
  as a site. Everything still passes through this machine.
- **`push` and `pull` share one set of flags and one output** (`from`, `to`, `check`,
  `job`, `size`, `anonymised`, `started`, `runId`, `media`; `pull` adds `serving`). Each
  option is refused where the pair doesn't take it. That covers `--yes` and
  `--backup-taken` for a hosted target, as well as the hosted-only options for a folder.
  `--dry-run` works for a folder target too.
- **A side's environment:** `--from-env`, `--to-env` or `--env` wins over the profile's
  own `environment`, as `--env` always did over a remote's. The profile's is the default.
- **`profile remove`** also removes the comment lines directly above the table, which
  describe it.
- **`CROMBOLO_PROFILE_URL`** was listed as a Next.js front end's variable. It is now a declared
  setting, and its description covers both uses.

The variables that describe a site in place of a profile were planned as
`CROMBOLO_URL` and `CROMBOLO_ENVIRONMENT`, and renamed after review to
`CROMBOLO_PROFILE_URL` and `CROMBOLO_PROFILE_ENVIRONMENT`. A Next.js app made by
`crombolo init` (and `sites/harbourstone-next`) already reads `CROMBOLO_URL` as
the CMS's address. With that set in a shell or a CI job, the CLI's commands
would have acted on the hosted site rather than this folder's.
