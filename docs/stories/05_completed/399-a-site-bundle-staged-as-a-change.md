# 399 — A site bundle staged as a change

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 382, 383, 392, 394

## Story

As a team building a site in a pipeline, I want to push what a checkout holds into a
workspace on a site as a change, so that it is looked at and merged there like any other
work, rather than replacing the whole site.

## Context

A change bundle (`docs/changes.md`, "Between sites") carries each item's state before and
after, and only a running site can make one: from a workspace, a recorded change, or page
edits since a point. A CI checkout has no database, so it has no before-states and cannot
make one. What it can make is a site bundle, the file or folder `crombolo` builds for a
whole-site push, which today only replaces a site (`383`).

Taking the target's state now as the before would make every difference part of the
change, so a checkout made before an editor's edit in Shared would undo that edit. The
change has to be measured from the state the checkout's content was based on.

## The design

- **The target makes the change, then stages it as any other.** Given a site bundle and a
  workspace, the target builds a change bundle itself, each item's *before* the base's and
  its *after* the bundle's, and stages it (`createChangeTransfer().stage`), so the merge
  goes three ways against Shared now, as for any staged change. An editor's later edit in
  Shared is kept where the checkout left the item alone, and a conflict where both changed
  it.
- **What travels:** the site's files a bundle carries (definitions, components,
  stylesheets, scripts), its dictionary, pages, media items with their files, Library
  items and blueprints. The site's code, `public/` and Library folders are left out and
  listed as such; people, site data, domains and secrets never travel this way,
  as in any change.
- **The base is a source's last merge.** The caller names a source (`ci/main`, up to 255
  characters). When a change staged from a source is merged, the site keeps the bundle's
  items as they were in it, as that source's base (`change_source`, a migration). The next
  staging from the source measures from it, as a branch synced again and again merges from
  its last sync. A change staged but discarded, or staged again before it was merged,
  leaves the base where it was.
- **The first staging from a source** names its base: `base=<change key>`, the site as that
  change left it, or `base=now`, the site as it is. Without a base and with no merge from
  the source, staging is refused, saying so.
- **Nothing is deleted unless asked.** An item the base had and the bundle lacks is left
  alone. With `prune`, it is deleted in the change, and its merge asks for each delete to
  be accepted (`page-deleted`, and story 382's lossy file changes), as any staged change's.
- **The usual preview first:** with `check`, the same answer `PUT changes?check=true` gives
  (each item's class, what loses data, conflicts and refusals) and nothing is written.
- **Into a workspace by name or key.** `into` names an open workspace the caller may use,
  or a name to open a new one with; staging again from the same source into it replaces
  what it staged there before.

## The surface

- **`PUT <backoffice>/crombolo/api/changes/from-site?source=&into=&base=&prune=&check=`**,
  the body a site bundle (`application/gzip`), with `Crombolo-Sha256` and the upload limit
  as `PUT changes`. The same rights: *Apply changes*, and *Install code* when it carries
  templates or the site's own code. A sign-in token in `Authorization`, never the back
  office's cookie.
- **The remote protocol's `changes/from-site`**, by the same rules, for a host.
- **`crombolo changes stage <folder | file> --into <workspace> --source <name>
  [--base <change key> | --base now] [--prune] [--dry-run]`**, with `--profile` and
  `--env` as the `workspace` commands. A bundle's folder is packed; a site's checkout is
  built into a whole-site bundle of its files (schema, components, stylesheets,
  scripts), with no pages and no database. `--dry-run` is the preview; a conflict exits
  22, as `workspace merge` does.

## Acceptance criteria

- [x] A site bundle checked against a site answers what staging it would do, changing
      nothing
- [x] Staged with a base, only what the bundle changed since the base is in the change; an
      editor's later edit to an item the bundle left alone is kept, and one to an item it
      changed is a conflict
- [x] Files, pages, media items (with their files), Library items and blueprints travel; what does not is listed
- [x] The first staging from a source without a base is refused; `base=now` and
      `base=<change key>` are taken
- [x] Merging a change staged from a source moves the source's base; discarding it does not
- [x] Without `prune` nothing is deleted; with it each delete is a finding until accepted
- [x] Staging again from a source into its workspace replaces what it staged there
- [x] The CLI stages a folder and a file, with `--dry-run`, and its exit codes
- [x] The migration names the release it ships in; every test rewind undoes it
- [x] `docs/changes.md`, `docs/remote-protocol.md` and the CLI reference say so

## Implementation

- `stageSite` (`packages/server/src/change-transfer.ts`) reads the site bundle
  (`loadBundle`), maps its sections to the workspace's file keys (`siteFileKey`) and its
  nodes to page states (`siteStateOf`), takes the base (the source's snapshot, the site
  now, or the site as a change left it: each file's text after the last change by then,
  each page's latest version then), builds a change bundle of what differs and stages it
  (`stage`). A check stages it `quiet` and discards it.
- `ChangeSourceRepository` (`packages/data/src/repositories/change-sources.ts`, migration
  094): what each workspace staged from a source, which `closeMerged` makes the source's
  base and a discard drops.
- The route is `changes/from-site` in `remote-changes.ts`, for the remote protocol and the
  Management API (`server.ts`, `managementChange`).
- The CLI: `changes stage` (`packages/cli/src/commands/changes/stage.ts`) and
  `site-bundle.ts`, which packs a bundle's folder or builds one from a checkout.
- Tests: `tests/site-staging.test.ts`.
- The dictionary: a site bundle carries it as `dictionary.udt`, converted to the
  workspace's `content/dictionary.jsonl` (`siteDictionaryLines`), so it merges by item;
  Shared's base is read the same way (`textNow`).
