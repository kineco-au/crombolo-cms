# 167 — Changing a remote site piece by piece

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 160

> **Security critical**, like story 160: it widens what can be done to a live
> site over the network. Planned and built 2026-11-02, after story 160.

## Story

As a developer whose sites run somewhere I cannot open a shell, I want to apply
a site's content (story 163) or per-environment settings (story 166) to a remote site
over HTTPS, so that setting up and updating a hosted environment needs neither
the back office nor database access. A site's content is applied as a bundle,
locally and remotely, with one command.

## Context

The remote protocol (story 108, `docs/remote-protocol.md`) moves **whole
sites**: `pull` takes a site file, `push` replaces the remote's content, schema
and files, keeping its people and domains. There is no remote operation finer
than that. Locally, every other command opens the site's database directly
(`packages/cli/src/support/people.ts`, `support/publish.ts`), which works for a
laptop, a container reached with `docker exec`, or a CI job with network access
to a Postgres database — and not for a hosted site.

## Decisions (2026-11-02)

1. **A remote applies a bundle.** The remote protocol gains an optional job
   that applies a bundle, through the existing bundle import: checked, backed
   up, one transaction, three-way on applying again, recorded as a run that
   can be reverted. It runs under the signed-in identity: a person, or a CI
   trust rule from story 160.
   - **Built where you are:** the CLI builds the bundle locally. `bundle build`
     compiles a site directory's content against that directory's own schema
     in a throwaway database, so neither side needs the other's database.
   - **Turned down:** the Management API as a client, which mirrors the API
     and has no three-way apply or revert; and running the CLI against the
     remote's database, which a hosted platform will not expose.
2. **"Seed" leaves the CLI.** Applying content is a bundle command, locally and
   remotely, and no command, flag, message or user-facing document says seed.
   The CLI breaks with no aliases kept, and the release notes map each old
   command to its new one. Inside the code the name may stay.
3. **The content folder is `content/`**: `content/pages`, `content/library`
   and `content/media`, where `seed/content`, `seed/library` and `seed/media`
   were. Existing sites move with `git mv`, which the release notes give.
4. **A remote apply may change everything a bundle carries**: content, media,
   schema, components, styles and code. Two safeguards stand in front of
   anything beyond content:
   - **The site's ceiling, `CROMBOLO_REMOTE_ACCESS`:** `off`, `read`,
     `content` or `all`, each including the levels before it. It is set where
     the site runs, so no back-office session can raise it.

     | Level | What the site accepts |
     | --- | --- |
     | `off` (default) | Nothing: the site is not a remote, and discovery answers 404 |
     | `read` | `pull`, `bundle runs` |
     | `content` | Applying bundles of content and media only, and `bundle revert` |
     | `all` | Everything: whole-site `push`, and applying bundles that change schema, components and code |

     The level only allows; the permissions still decide who.
     - **Replacing the old switch:** a site was already not a remote unless
       `CROMBOLO_REMOTE_ENABLED=true`. That variable is gone: a site that
       still sets it refuses to start, naming `CROMBOLO_REMOTE_ACCESS`, so it
       cannot quietly stop being a remote. A refused request names the
       level the site has.
     - **`push` needs `all`:** it replaces a site's schema and files.
   - **A permission of its own, `Crombolo.Remote.ApplyStructure`,** to apply a
     bundle that carries more than content. A person holds it through a user
     group, and a CI identity through its trust rule (story 160).
     Content-only bundles need `Crombolo.Remote.Push`, and on a protected
     environment `PushProtected`, as a push does.
5. **Whole-site `push` needs `Crombolo.Remote.ApplyStructure` too**, beside
   `Push` (and `PushProtected` where protected). Both ways of changing a
   remote's structure need the same right. Groups that push today need it
   added: the release notes say so, and a refused push names the permission.

## The bundle commands

| Command | What it does | Replaces |
| --- | --- | --- |
| `bundle build [dir] [--out] [--template] [--with-media] [--code]` | One bundle from a site directory: schema, components, styles and its content, with media | unchanged |
| `bundle build --check [dir]` | Checks the content files against the directory's schema, and lists findings with file and line; writes nothing | `seed check` |
| `bundle apply [dir \| file] [--publish] [--resolve …] [--dry-run] [--remote <name>]` | Applies a bundle's content: checked, backed up, one transaction, three-way on applying again. From a directory it builds the content first. With `--remote`, the remote does all of it | `seed apply`, `content import` |
| `bundle runs [--remote <name>]` | The applies on a site | `content runs` |
| `bundle revert <run> [--remote <name>]` | Undoes an apply | `content revert` |
| `bundle export <root> …` | A subtree as a private bundle, to move to another environment | unchanged |
| `bundle export --source [--root <page>… \| --all]` | Writes a site's pages, Library elements and media as editable files under `content/` | `seed export` |
| `bundle check-code <bundle>` | Checks a bundle's code against this CMS | `bundle check`, renamed beside `build --check` |
| `bundle install-code`, `bundle purge` | unchanged | — |
| `start --bundle <dir \| file> [--publish]` | Installs a bundle into a bare site and starts it | `start --seed`, removed |

## Plan

1. **The commands** above, in `packages/cli/src/commands/bundle/`. `seed/` and
   `content import|runs|revert` are removed, and `start --seed` goes.
   `content` keeps its other commands (copy, move, publish and the rest).
2. **The folder.** The reader looks in `content/pages`, `content/library` and
   `content/media`. A site that still has `seed/` is refused, with the
   `git mv` to run. The demo and starter sites move, and so do `crombolo init`
   and the empty-site guide.
3. **The remote job:**
   - `CROMBOLO_REMOTE_ACCESS` in the config (`config.ts`): discovery and every
     remote route answer by it, and `push` moves to `all`;
   - the `Crombolo.Remote.ApplyStructure` permission, among the remote
     permissions a group or trust rule can hold;
   - an optional `bundle-apply` capability in `docs/remote-protocol.md`;
   - the job endpoints: upload, check (dry run), apply, the runs, revert;
   - the report shape, which is a local `--dry-run`'s;
   - the errors.

   The server half reuses the bundle import as `bundle apply` does. The
   conformance suite checks a remote that advertises it.
4. **Docs.** `docs/seeds.md` becomes the content section of `docs/bundles.md`.
   The CLI docs, the docs section on the product site, `operations.md` and
   every site's README follow. The release notes map the commands and the
   folder.
5. **Tests.**
   - **Updated:** every seed and content-import test, under the new commands
     and folder.
   - **New:** the remote job (check, apply, applying again, conflicts, revert,
     refusals) on SQLite and Postgres, and the conformance suite against the
     reference server.

## Acceptance criteria

- [x] No CLI command, flag, message or user-facing document says "seed". The
      content folder is `content/`, and a site with `seed/` is refused with
      the move to make
- [x] The bundle commands in the table above work locally:
      `build --check`, `apply` (directory or file, `--publish`, `--resolve`,
      `--dry-run`), `runs`, `revert`, `export --source` and `check-code`
- [x] `CROMBOLO_REMOTE_ACCESS` is `off` by default, and each level allows only
      what its row says. An `off` site's refusal names the variable
- [x] `bundle apply --remote` checks, applies, applies again three ways,
      reports conflicts for `--resolve`, and `bundle revert --remote` undoes
      it, with no shell or database access to the remote
- [x] A bundle carrying schema, components or code applies remotely only at
      `all` and with `Crombolo.Remote.ApplyStructure`. Whole-site `push` needs
      the same. A person and a CI trust rule (story 160) can each hold it
- [x] Every remote apply and revert is audited as the identity that made it
- [x] `docs/remote-protocol.md` and the conformance suite cover the
      `bundle-apply` capability and the access levels
- [x] Tests on SQLite and Postgres

## Implementation (2026-11-02)

- **The folder** (`server/src/seed/read.ts`, `export.ts`, `compile.ts`):
  `content/pages`, `content/library` and `content/media`, through
  `CONTENT_FILES_DIR` and `KIND_DIRS`. A page's kind is still `content`, so
  every key derived from a path is unchanged and a site's pages keep their
  keys.
  - **A site with `seed/` and no `content/`** gets one finding naming the
    `git mv` to run.
  - **Moved:** every site under `sites/`, the starter template, and the docs
    pages the build writes (`sites/crombolo/content/pages/home/docs`).
  - **Renamed in the built package:** the label and description say content
    files.
- **The CLI:**
  - **`bundle apply`** (`commands/bundle/apply.ts`) merges `seed apply`,
    `content import` and `content check`. This site's directory, the
    default, builds its content files first; anything else is a bundle.
    `--dry-run` with `--save` is the old check.
  - **`bundle runs` and `bundle revert`** moved from `content`, and take
    `--remote`.
  - **`bundle build --check`** reports findings by file and line with
    `problems_found`.
  - **`bundle export --source`** (`support/content-files.ts`) writes the
    content files.
  - **`bundle check` is `bundle check-code`.**
  - **`start --bundle .`** is the site's own content files, in place of
    `--seed`.
  - **Removed, with no aliases:** `seed`, `content import`, `content check`,
    the `content:export`, `bundle:install` and `seed:build` aliases.
- **The remote** (`server/src/remote.ts`):
  - **`CROMBOLO_REMOTE_ACCESS`** (`config.ts`, `RemoteSettings.access`). A
    config override giving only `enabled` means `all`, as tests and
    existing callers expect.
  - **Every route checks the level first:** pulls `read`, pushes `all`. A
    push also needs `ApplyStructure` once its other permissions hold.
  - **`environments`** says the level and what may be done:
    `apply`, `applyStructure`.
  - **`PUT environments/{env}/bundles`:** a `.tgz`, checked against
    `Crombolo-Sha256`, with options in `Crombolo-Options`. A dry run gives
    the check's report; otherwise it backs up wherever the server can, as a
    push does, and applies through `installBundleContent`. A bundle carrying
    sections needs `all` and `ApplyStructure`.
  - **`GET environments/{env}/runs`** and
    **`POST environments/{env}/runs/{id}/revert`**. A run that swapped files
    needs the same right to revert. Applies and reverts are audited.
  - **Discovery** advertises `bundle-apply` from `content` up.
- **The permission:** `Crombolo.Remote.ApplyStructure`, held through a user
  group (the "Change a site's structure and code" permission) or a CI trust
  rule (`apply-structure` in `remote trust add`).
- **The CLI's remote half** (`support/remote-apply.ts`):
  - **What it sends:** a site directory is built with `bundle build`'s own
    builder and sent as content alone, or whole with `--structure`. A
    package directory or `.tgz` is sent as it is.
  - **How:** packed as an npm tarball and uploaded with its SHA-256.
- **Conformance:** a remote advertising `bundle-apply` refuses a bundle that
  is not the one described, as a problem.
- **Tests:**
  - **`tests/remote-apply.test.ts`:**
    - check, apply, applying again, runs and revert;
    - structure needing `all` and `ApplyStructure`;
    - each level's refusal and what `environments` says;
    - a hash mismatch;
    - the variable's levels and the refusal of the old one.
  - **Updated:** every test of the old commands, folder and variable.
    `remote-ci.test.ts`'s protected push now holds `ApplyStructure`.
