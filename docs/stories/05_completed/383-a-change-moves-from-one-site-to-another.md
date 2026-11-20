# 383 — A change moves from one site to another

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 380, 381

## Story

As someone with more than one copy of a site, I want to take a change out of one and
apply it to another, and be told where the other has moved on, so that what I deploy is
the change I looked at and nothing else.

## Context

A bundle today is a whole site under one hash, and applying one replaces what was there
(`104`, `107`, `108`). Nobody can say what a push carries, because it carries
everything. With changes recorded (`381`), the thing to move is one change.

## The design

- **A change is exported as a bundle** of a new kind: its identity, the state it was
  made on, each item with its before and after, each item's class, and its files. It
  keeps the bundle's manifest, its one hash and its signing.
- **Applying one checks the base, per item.**
  - Where the target still holds what the change started from, the item is applied.
  - Where the target has moved on, it merges as a workspace does (`380`); what is left
    is refused and named.
  - A lossy item is counted against the target and must be accepted there (`382`).
- **A change touches only what it changed.** The target may have been edited directly
  since, and what it holds is kept:
  - **a page** arrives as the properties, languages and segments the change altered,
    never as the whole page. Anything else on the target's copy stays as it is;
  - **a page's place** among its siblings is merged into the target's order, which is
    not replaced;
  - **media** arrives only where the change added or replaced it. Nothing the target
    holds that the change never touched is altered or removed;
  - **deleting** a page or a media item the target has edited since, or that the target
    still uses, is a conflict, not a deletion;
  - **a page made separately on both** at the same address is a conflict, naming both;
  - **a property with a value per environment** (`387`) travels with every
    environment's value, like any other.
- **A refused apply changes nothing** and leaves the change as a workspace on the
  target, where the conflict can be resolved and merged.
- **A change can be staged before it is applied.** Staging puts it in a workspace on
  the target, made for it and read-only, served at the workspace's address (`379`) on
  the target's own data. Applying it is then that workspace's merge (`380`). A staged
  change the target has moved under is staged again from its source, never resolved on
  the target. It is discarded when asked; an administrator can list every pending
  workspace and clear those past an age in one step.
- **An open workspace can be exported too,** as a change not yet merged where it was
  made. It keeps its identity, so merging it there later is recognised as the same
  change.
- **Several changes can be staged and applied as one:** into one staging workspace,
  and then all of them or none.
- **A change is applied once.** Its identity is kept on the target, so one that comes
  back by another route is recognised and skipped.
- **Several changes are applied in order.** A change that touches what an earlier
  unapplied change touched, or uses what it made, is refused unless that one comes too.
- **A whole site is still a bundle.** Starting an empty site from one is its first
  change. Replacing a site with one is a change marked as replacing everything, and is
  lossy.
- **A site already running** records what it holds as its starting point the first time
  a change is taken from it or applied to it.
- **Everyday page edits** are exported in bulk from the pages' history since a point,
  for bringing one copy of a site up to another.
- **The remote protocol carries all of it** (`107`): list a site's changes, export one,
  apply one, and say which a site already has.

## Decisions (settled 2026-11-20)

- **A page's before and after travel as values,** per property, language and segment,
  since event ids mean nothing on another site; types and files travel as their texts.
  Items are matched on the target by key.
- **Dependencies are named per item.** Each item carries the id of the change that last
  touched it at the source, and the change lists the changes that made anything it
  references (a picked page or media item). The target refuses only where a named change
  is missing there and the item's base does not match what the target holds, naming the
  missing change.
- **No starting point is recorded.** An item with no recorded history is compared by
  value: what the target holds now against the change's before. The first change costs
  what any other does.
- **A staged change is kept until asked,** with no expiry by default. Administrators get
  a quick way to see every pending workspace, staged changes included, with its owner,
  its age and when it was last touched, and to clean up those past an age they choose,
  in one step (the back office's Workspaces view, `384`, and the command line, `386`,
  over one route).

## Decisions (settled 2026-11-20, building)

- **A change bundle is a bundle package directory,** sent as a gzipped tarball over the
  protocol, so it keeps the bundle's manifest, its one hash and its signing.

## Acceptance criteria

- [x] **A change exported from one site applies to another,** and both then hold the
      same items.
- [x] **An item the target changed since** merges where it can and is refused, named,
      where it cannot.
- [x] **A page edited on the target in a property the change did not touch** keeps that
      edit after the change is applied.
- [x] **Media the target holds and the change never touched** is unchanged.
- [x] **Deleting an item the target edited since, or still uses,** is refused as a
      conflict.
- [x] **A refused apply** changes nothing and leaves a workspace holding the change.
- [x] **A staged change** is served at an address on the target with the target's
      shared state unchanged, and merges when applied.
- [x] **An open workspace** is exported and applied elsewhere, and its later merge at
      the source is the same change.
- [x] **Several changes staged together** are served as one site and applied together
      or not at all.
- [x] **The same change applied twice** is skipped the second time.
- [x] **A change without the earlier change it depends on** is refused, naming it.
- [x] **A lossy item** is counted against the target and needs accepting there.
- [x] **A whole-site bundle into an empty site** is its first change; into a site with
      content, a change marked as replacing everything.
- [x] **Page edits since a point** are exported and applied in bulk.
- [x] **The conformance suite** covers the protocol's new routes.
- [x] **Tests** on both dialects.
- [x] **An administrator lists every pending workspace,** staged changes included, with
      owner, age and last activity, and discards those older than an age in one step.
- [x] **An integration scenario** moves a change between two sites run with `crombolo
      start`: staged, looked at, applied, refused where the target moved on.

## Built (2026-11-20)

- **The bundle** (`@crombolo/transfer`, `change-bundle.ts`): `writeChangeBundle` and
  `readChangeBundle`, a private package typed `change` whose integrity covers
  `change.json`, the media under `media/` and the package's identity.
- **The service** (`packages/server/src/change-transfer.ts`): `exportChange`,
  `exportWorkspace`, `exportSince`, `stage` and `apply`. Staging opens a workspace,
  snapshots Shared's files and rebases each changed file on the change's before; pages
  are written there field by field, conflicts named; the change keys are kept on the
  workspace (`staged_changes`, read-only when staged).
- **The merge** (`workspace-merge-run.ts`) takes `changeKey` and `appliedChanges`, a
  whole workspace's merge recording its change under the workspace's key; its moves and
  deletes are recorded as page changes, and a deleted page's state is kept as an item
  (`REMOVED_PAGE_PREFIX`, hidden from file listings).
- **Migration 088 `AddChangeTransfer`:** `applied_change`, `workspace.staged_changes`.
- **Routes:** the remote protocol's `changes` (`remote-changes.ts`), with
  `Crombolo.Remote.ApplyChanges`, Install code for a change carrying code, and
  `may.applyChanges`; `GET/POST <plugin>/api/workspaces/pending[/discard]`.
- **Whole sites:** an apply that replaces a site holding pages marks its run `replace`.
- **Tests:** `tests/change-transfer.test.ts`, `tests/site-replace.test.ts`, the
  conformance suite's two `changes` checks, `tests/integration/change-transfer.integration.ts`.

## Left for later

- **A page's place among its siblings** is left as the target has it; only a move to
  another parent travels.
- **The command line** (`386`) packs, unpacks and signs change bundles on disk; over the
  protocol they travel as tarballs and are not signed.
