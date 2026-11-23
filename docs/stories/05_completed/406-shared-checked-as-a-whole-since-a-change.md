# 406 — Shared checked as a whole since a change

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 381, 383, 386

## Story

As a host that promotes a site's work, I want Shared checked for everything that
changed since a given change, so that what several merges did together is checked
once and the findings can be shown on the promotion.

## Context

A workspace's `POST check` (`386`) renders the pages that workspace affects and reports
its files' problems (`packages/server/src/workspace-checks.ts`). Once work is merged,
nothing checks Shared: two workspaces that each passed can break a page between them.
A host promoting Shared from one site to another knows the change it last promoted
(`383`'s base) and wants the check from there. Asked for by Crombolo Cloud (its story
300, agents working in workspaces).

## The design

- **`POST <plugin>/api/changes/check { since?, all? }`** checks Shared. `since` is a
  change's id: the pages checked are those affected by every change after it, found
  as a workspace's affected pages are, from the items those changes record (`381`).
  With no `since`, or `all: true`, every published page is checked.
- **The answer is `check`'s shape:** `{ ok, pages, failures, notChecked }`, with a
  failure per page that does not render and per problem in Shared's definition files.
  It adds `since` and `upTo`, the changes the check covered, so a finding is tied to
  what was checked.
- **Rendered as Shared serves,** by Shared's renderer, published pages only, with no
  cache read or written.
- **A `since` the site does not hold** is refused, naming it, and never read as "from
  the start".
- **Who may ask:** whoever may list the site's changes, by cookie or bearer; the
  remote protocol's changes routes answer the same, and `crombolo changes check
  --since` asks it.

## Decisions (settled 2026-11-23)

- **Bounded by a limit, in the request.** The check answers at once: every page the
  changes changed, a sample of three per changed type and view, and no more than 500
  pages in all, with the rest counted in `notChecked`. No job to read back.
- **"After `since`" is by when a change was last added to,** not when it began: a
  person's direct edits share a change for ten minutes, so one begun before `since`
  can gain items after it.
- **Failures only.** Each failing page carries its own error; Shared keeps no list of
  errors to add.

## Acceptance criteria

- [x] **Two merged workspaces that break a page between them** are found by a check
      since the change before both, and by neither workspace's own check.
- [x] **A page no change since `since` affects** is not rendered.
- [x] **A problem in Shared's definition files** is a failure of kind `file`.
- [x] **`all: true`** checks every published page.
- [x] **An unknown `since`** is refused.
- [x] **The remote protocol and the command line** ask the same check.
- [x] **Tests** on both dialects; `docs/changes.md`, `docs/workspaces.md` and
      `docs/remote-protocol.md` updated.

## What was built

- **`packages/server/src/shared-check.ts`:** the check. It takes the changes added to
  since `since` (`ChangeRepository.addedToSince`, by `finished_at`, which each direct
  edit moves), unions their pages and files, finds the affected pages with the rule a
  workspace's check uses (`pagesAffectedBy`, now shared, in `workspace-checks.ts`), and
  renders each published one through Shared's renderer. `SHARED_CHECK_PAGES` is 500.
- **It brings the node up to date first.** A merge tells every node of its views by a
  cache instruction, read on the next poll, so a check asked at once rendered the views
  before the merge. The check polls and takes a new snapshot before it renders.
- **Routes:** `POST <plugin>/api/changes/check` (`changes-api.ts`), the remote
  protocol's `changes/check` under Pull (`remote-changes.ts`), and `crombolo changes
  check --since <change> | --all`, exiting 20 on a failure.
- **A view in a subfolder is found.** A changed view was recognised only directly under
  `components/`; it is now at any depth, for a workspace's check too.
- **File problems** are Shared's views compiled and imported (`checkComponents`), looked
  for when a change touched `components/` or the whole site is checked.
- **Not done:** a shared component every view imports (a layout) samples no pages, as
  in a workspace's check; a page only members may see answers `notFound` and is a
  failure there too.
- **Tests:** `tests/shared-check.test.ts`, and a case in `tests/workspace-cli.test.ts`
  through the remote route and the command.
