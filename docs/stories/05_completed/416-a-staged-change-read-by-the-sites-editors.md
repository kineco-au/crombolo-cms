# 416 — A staged change read by the site's editors

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 383, 384, 386, 401

## Story

As an editor whose work is in a change staged on the serving site, I want to look at
what is staged there (its pages, its differences, its checks) before it is applied,
so that the person who staged it is not the only one who can say it is right.

## Context

Asked for by Crombolo Cloud on 2026-11-24 (its story 300), against 0.76.0.

A change from another site is staged in a workspace that is looked at and applied,
never edited there (`383`, `399`; `stagedReadOnly`). That workspace belongs to whoever
staged it, usually a host's client, and has no other members.

Who may read a workspace is decided in one place (`packages/server/src/workspaces.ts`):

- **its owner and members** (`mayUse`), everything;
- **an administrator who asks** (`?includePrivate=true`, `401`), the reads in
  `ADMIN_READS`, plus `check` and `open`;
- **every editor, for a workspace its owner shows to editors** (`visibility:
  'editors'`, `384`), but only the workspace itself and `changes`, `diff`, `merge`,
  `members` and `conflicts`. Not `check`, `pages`, `errors`, `render` or `open`.

Anyone else is answered 404, "There is no such workspace". So an editor on the
serving site cannot check a staged change at all, and even a workspace shown to
editors does not let them run its checks or see its pages rendered.

Also found (2026-11-24, by reading):

- **Staging is `PUT changes?stage=true`** on the remote protocol
  (`remote-changes.ts`), its options query parameters (`into`, `editable`, `accept`);
  it takes no visibility today.
- **`384`'s reads check no section:** any signed-in person reads a workspace shown to
  editors, not only those with the Content section.
- **The administrator's list holds `files`** (types and code) too, which the editors'
  list does not.

## The design

- **A staged change can be shown to the site's editors,** by the visibility a
  workspace already has. Whoever stages it says so (`visibility: 'editors'` on the
  staging request), and may change it afterwards.
- **What "shown to editors" lets an editor do is everything that looks and nothing
  that changes:** the workspace, `changes`, `diff`, `merge` (the preview), `members`,
  `conflicts`, `pages`, `errors`, `check`, `render` and `open`. This is the same list
  an administrator who asks is given, kept as one list for both.
- **This holds for any workspace shown to editors,** staged or not, so `384`'s
  reading is widened rather than a second rule added for staged ones.
- **An editor reads only what they could read in Shared:** a page they have no access
  to is left out of the lists and refused by `render` and `open`, and a type, a code
  file or a setting is shown only to someone with that section.
- **Nothing that changes is opened up:** settling a conflict, merging, discarding,
  members, links and edits stay with its members, and a staged change stays read-only
  for everyone.
- **A workspace shown to editors is listed for them** as today, and the listing says
  it is staged.
- **The remote protocol and the command line** answer the same for a signed-in
  person who is not a member.

## Decisions (2026-11-24, the maintainer's)

1. **Opt-in by whoever stages it:** `PUT changes?stage=true&visibility=editors`, or the
   workspace's visibility set afterwards by its members.
2. **An editor is anyone with the Content section,** each item held to their own
   access. This tightens `384`'s reads, which check no section today; the release
   notes say so.
3. **`check` is one of the reads.**
4. **`open` is one of the reads,** held to `410` and `415`.

One list of reads serves an administrator who asks and an editor alike; `files` in it
is held to the Structure and Code sections, as every type and code file is.

## Acceptance criteria

- [x] **A staged workspace shown to editors** is listed for an editor who is not a
      member, and they read it, its changes, diff, merge preview, conflicts, pages
      and errors.
- [x] **The same editor runs its check, renders a page and opens its site.**
- [x] **They are refused** every change to it: settle, merge, discard, members,
      links, edits.
- [x] **A page they may not read in Shared** is not in what they are shown, and is
      refused by `render` and `open`.
- [x] **A staged workspace not shown to editors** is a 404 for them, as today.
- [x] **Someone without the Content section** is a 404 for any workspace they are not
      in, shown to editors or not.
- [x] **An ordinary workspace shown to editors** gains the same reads.
- [x] **An administrator who asks** and an editor are given the same list of reads.
- [x] **The remote protocol and the command line** answer the same.
- [x] **Tests** on both dialects; `docs/workspaces.md`, `docs/remote-protocol.md`
      and the release notes updated.

## Implementation

- **One list of reads** (`WORKSPACE_READS`, `POSTED_READS`, `workspaces.ts`) for an
  administrator who asks and for an editor of a workspace shown to editors, who needs the
  Content section.
- **Held to their access** (`readsOf`): an editor not in it has each answer filtered:
  items naming a page they may not read in Shared, and files of a section they lack, are
  left out; `check`'s failures and pages not checked go with them; `errors`, `render` and
  `open` resolve a path to its page (`pageAt`) and refuse one they may not read.
- **Staging:** `PUT changes?stage=true&visibility=editors` (`remote-changes.ts`); each
  workspace answers `staged`.
- Tests: `tests/change-transfer.test.ts`, story 416's block.
