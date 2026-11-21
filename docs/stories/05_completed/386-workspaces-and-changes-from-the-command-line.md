# 386 — Workspaces and changes from the command line

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 378, 379, 380, 381, 383

## Story

As a developer or an agent, I want to open a workspace, change it, push it to a site and
merge it from the command line, always told which site and which workspace I am acting
on, so that what I move is one change I can name.

## Context

`crombolo pull` and `push` (`108`) move whole sites, which is why they read like git and
do not behave like it. With a change as the thing moved (`383`), the names become true.
A profile today names one address and one environment.

## Decisions (2026-11-19)

- **One profile per site.** `crombolo profile add <name> <address>` asks the site which
  environments it has. The environment is part of the command, not the profile.
- **The path says where:** `--profile <site> <environment> …` acts on that environment's
  Shared, and `… workspace <name> …` on a workspace in it. An environment with
  workspaces off has no `workspace` commands, and says so.
- **Merge is the word** for a workspace into its environment.
- **`push` and `pull` stay,** and move changes.
- **Open, change, merge is the way to work locally too,** and the guides say so.

## The design

```
crombolo workspace open <name>                       # on this site
crombolo workspace status | list | discard
crombolo workspace share <person>… | unshare <person>
crombolo workspace diff [item] [--against shared|base|<env>]
crombolo workspace sync                              # bring Shared's latest in
crombolo workspace conflicts
crombolo workspace resolve <item>[#part] --mine | --theirs | --value <v> | --file <path>
crombolo workspace check [--all]                     # every check below; non-zero if any fails
crombolo workspace errors [--since <time>]           # what its process logged: exceptions, crashes, timeouts
crombolo workspace pages [--failing]                 # each affected page: address, rendered or not, how long
crombolo workspace render <path>                     # one page: status and any error
crombolo workspace merge [<name>…] [--dry-run] [--accept-lossy <item>]   # into this site's Shared

crombolo --profile <site> <env> workspaces
crombolo --profile <site> <env> workspace <name> <any of the above> | address
crombolo --profile <site> <env> push <name>          # this site's workspace → a workspace there
crombolo --profile <site> <env> pull [<name>]        # what was merged there, or a workspace
crombolo --profile <site> <env> changes [<id>]
crombolo --profile <site> <env> revert <change> [--to-workspace <name>]
```

**Comparing and resolving, made for an agent to drive:**

- **Nothing asks a question.** Every command takes flags and answers with `-o json`.
- **Exit codes say why:** clean, conflicts present, checks failed, and a lossy change
  not accepted are each a code of their own.
- **`diff` is by meaning:** per property for pages and types, by line for files.
  `--against shared` is what a merge would change, `--against base` what the workspace
  changed since it opened, and `--against <env>` what applying it there would change.
- **`sync` loses nothing.** It merges what merges. Where it cannot, the workspace keeps
  its own version and the item is in conflict until resolved.
- **`conflicts` carries the other side's intent:** for each part, the base, mine and
  theirs, and who made the other change, its name and its description.
- **Resolving, by kind:**
  - a component, stylesheet or script: three ways, with markers written into the file;
    `resolve <path>` refuses while markers remain;
  - a type or data type: per property, `resolve event#date --mine`, or by editing the
    schema file;
  - a page: per property, language and segment, with `--value` for a merged value.
- **`check` covers:**
  - the build and the component check on the result;
  - rendering each changed page, and a sample of the pages of each changed type or
    template (`--all` for every one);
  - values that cannot convert, by page;
  - a required value missing for this environment (`387`);
  - references to pages or media the site does not hold;
  - what cannot be checked until the workspace is merged (new dependencies, routes),
    listed, so a clean result is not read as more than it is.
- **The same commands read a staged change** (`383`) on a site that takes content only
  by change (`388`): `… <env> workspace staged check`.
- **`merge --dry-run`** lists what a merge would do and runs the checks, changing
  nothing.
- **`revert`** undoes a merged change as a new change (`381`). With `--to-workspace` the
  work is reopened as a workspace, to carry on with and merge again. It is refused where
  a later change touched the same items, naming them.

- **`merge` with several names** merges them as one, all or none (`380`).
- **Where the site named leaves merging to its host** (`380`), `merge` is refused and
  says so, with what the host offers in its place.
- **`push` never merges.** It makes or updates a workspace on the site named, where it
  can be looked at (`379`) and merged.
- **`pull`** with no name brings what was merged there since this site's base; with one,
  a workspace. Conflicts are left in a local workspace to resolve.
- **Locally, a change made outside a named workspace** goes into an unnamed one, opened
  for you and named when it is pushed or merged. Nothing is unrecorded.
- **Every command starts by naming where it acts:**
  `<site> › <env> › workspace <name>`, or `<site> › <env> (shared)`.
- **`push`, `merge` and `pull` list what they will do** (each item, its class, what
  takes effect at merge), then ask, or take `--yes`.
- **A folder remembers where its files came from,** and `push` refuses a different site
  without `--profile` saying so. `CROMBOLO_PROFILE` names one for scripts.
- **A hosting plugin can add a verb under an environment,** so a host's own steps read
  as part of the same path.
- **`types export --from` and the type commands' `--to`** (`374`) stay for a single
  definition; a change is the way to move work.

## Decisions (settled 2026-11-20)

- **The unnamed local workspace is on by default.** A change made on a local site
  without naming a workspace goes into the person's own (`380`'s `mine`), named when it
  is pushed or merged.
- **An existing profile with `--env` is refused,** saying to add it again as a site
  profile (`crombolo profile add <name> <address>`), so no command acts on an
  environment the person did not name.
- **The command line reaches workspaces through the remote protocol:** routes under
  `/crombolo/remote/v1` for open, list, share, diff, sync, conflicts, resolve, merge,
  check, errors, pages and render, extending `380`'s `workspaces/{key}/merge`, with a
  capability and conformance checks of their own. A local site is reached the same way.
- **Kept whole,** built once `378`, `379`, `381` and `383` have landed, so `check`,
  `errors`, `pages`, `render`, `push`, `pull`, `changes` and `revert` arrive with the rest.

- **The environment is a flag** (2026-11-21): `--profile <site> --env <environment>`,
  required whenever `--profile` names a hosted site; a bare environment after the profile
  cannot be told from a command by the CLI's parser.

## Acceptance criteria

- [x] **A profile names a site** and lists its environments.
- [x] **A workspace is opened, changed, pushed and merged** from the command line, local
      and remote.
- [x] **`push` leaves a workspace on the site,** unmerged.
- [x] **`pull`** brings merged changes, or a named workspace, and leaves conflicts to
      resolve.
- [x] **`diff`** compares a workspace with Shared, with its base and with an
      environment, by property and by line.
- [x] **`sync` then `conflicts`** lists each conflict with base, mine, theirs and the
      other change's author, name and description.
- [x] **`resolve`** settles a file, a type's property and a page's property, and
      refuses a file that still has markers.
- [x] **A script resolves a conflict and merges** with no prompt, branching on exit
      codes alone.
- [x] **`check`** renders the changed pages and a sample per changed type, and exits
      non-zero with each failure named; `--all` renders every affected page.
- [x] **`errors`, `pages` and `render`** answer for a workspace and for a staged change.
- [x] **`merge --dry-run`** changes nothing.
- [x] **`revert`** undoes a change, and with `--to-workspace` reopens its work.
- [x] **`share` and `unshare`** change who can read a workspace.
- [x] **`merge` with several names** merges all or none.
- [x] **Every command prints where it acts** first, and `-o json` carries it.
- [x] **A change made outside a workspace locally** is in the unnamed one.
- [x] **A site with workspaces off** refuses the `workspace` commands by name.
- [x] **A plugin's verb** runs under an environment.
- [x] **The clispec schema and `docs/cli`** carry the commands.
- [x] **Getting started, the deployment guide and the guide `init` writes for agents**
      (`370`) describe open, change, push, merge as the way to work.
- [x] **Tests** against a site served by the harness.
- [x] **An integration scenario** opens, changes, pushes and merges a workspace with the
      real command line against a site run with `crombolo start`.

## Built (2026-11-21)

- **The routes:** the remote protocol's workspace routes pass every workspace route through for
  the person (`remote-workspaces.ts`, capability `workspaces`), with new ones for the command line
  (`workspace-checks.ts`: `diff?against=`, `GET conflicts` with the other change's author and name,
  `check`, `pages`, `errors`), `GET members` and sharing by email; `changes/{id}`,
  `changes/{id}/revert`; `PUT changes?check=true` and `stage=true&editable=true`.
- **Local and hosted alike:** `Remote.handleAs` and `ServerHandle.remoteAs` answer a request as a
  person in process, so a command in a site's folder boots the site (`role: web`, no watching) and
  calls the same paths (`support/work-site.ts`); with `--profile` and `--env` it calls the hosted
  environment. The command line acts as the person signed in, or the site's administrator.
- **The commands:** `workspace open|list|status|discard|share|unshare|diff|sync|conflicts|resolve|
  check|errors|pages|render|address|merge|push|pull`, `workspaces`, `changes`, `revert`; outcomes
  `conflicts_found` (22) and `lossy_unaccepted` (23) beside `problems_found` (20).
- **Profiles:** a profile naming an environment is refused with what to run; `profile add --env` is
  refused.
- **A local change with workspaces on** goes into the person's own workspace
  (`siteDocumentOperations(…, { ownWorkspaceOf })`, from `support/pages.ts`).
- **A plugin's verb:** `onSite`, `siteFlags`, `workSite` from `@crombolo/cli/plugin`.
- **Fixed on the way:** a change made here and since reverted counts as held, so a pull does not
  bring it back.
- **Tests:** `tests/workspace-cli.test.ts`, `tests/integration/workspace-cli.integration.ts`.

## Departures

- **`--env` is a flag,** as decided 2026-11-21.
- **Changes move with `workspace push --to` and `workspace pull --from`;** `crombolo push` and
  `pull` still copy whole sites, their `--from`/`--to` flags unchanged.
- **`resolve --value`** is for a file's merged text; a page's part is settled with `--mine` or
  `--theirs`.
- **`errors`** are what this node's renders of the workspace said, kept in memory.

