# 203 — Media member permission defaults

**Epic:** D — Members and identity · **Priority:** must · **Size:** M
**Depends on:** 196

Story 204 supersedes this story's default audience and dialog choices with
Public / Private / Custom read and Private / Custom write. The member-only
policy remains supported for saved settings and transfers.

## Story

As a media editor, I want new files to be readable by all signed-in members
and writable by no members unless configured otherwise, with clear choices
that do not offer a nonexistent parent folder at the library root.

## Context

The dialog defaults to following a folder, including for root files, and has
no option for every signed-in member. Public access is a separate setting:
it permits anonymous visitors with a link. Existing saved permissions must
remain intact; these defaults apply to new files.

## Acceptance criteria

- [x] The read label is **Which members can see this?**, with **All members**
      first, and **No members** first for writes.
- [x] New file defaults are member-only read and no member write; explicit
      folder defaults remain supported.
- [x] Root files disable parent-folder choices; children can opt into them.
- [x] Member-only access works for files, crops, Delivery API items and lists,
      caching and transfer; anonymous access remains a separate explicit choice.
- [x] Existing saved permissions are preserved.
- [x] Unit coverage, relevant tests on both database dialects, focused browser
      coverage and formatting/lint/types pass in Docker; docs reflect the change.

## Decisions

Existing permissions are preserved. A restricted folder keeps its group
restriction for new files unless it explicitly sets another new-file default.
Otherwise new files get All members / No members. Folder nodes continue to
follow their rules rather than being stamped as files.

## Implementation

- Added the `members` read policy throughout the shared permission check,
  database-backed Delivery API filtering, folder defaults and bundle format.
  It permits signed-in members with or without groups and never grants write
  access. Anonymous reads remain a separate explicit `public` setting.
- New files stamp `members` / `none` unless configured folder defaults or a
  restricted folder's read groups apply. Existing null/inherited settings and
  folders keep their previous meaning. The existing string columns store the
  new value, so no database migration is needed.
- Permission descriptions include whether the item has a parent. The dialog
  disables folder inheritance for root files, orders the requested defaults
  first and uses the new member-focused labels. Newly configured folder
  defaults also start at All members / No members.
- Regression coverage includes member-only files, default stamping, group
  restrictions, Delivery API lists and items, bundle serialization and root
  versus child controls in the real browser. Public-cache and redirect tests
  explicitly mark their public fixtures public.
- `docs/rendering.md` and `docs/data-model.md` describe the defaults and
  distinguish signed-in member access from anonymous public access.

## Validation

- Full Docker Postgres unit suite: 3,043 passed, 12 skipped, zero failures.
- Full Docker SQLite run: 3,042 passed, 8 skipped, three public-cache/redirect
  fixtures failed because uploads now default to member-only access. Those
  fixtures were explicitly made public, then all 91 affected media/transfer
  tests and all ten cache-header tests passed. Final bundle-media fixture
  shutdown checks also passed on both dialects (21 tests each).
- Focused real-browser regression: one passed, covering both root and child
  files, the labels, choice order, disabled inheritance and saved defaults.
- Final Docker `bun run check`: formatting, lint and types passed.
- A Postgres reset race exposed by repeated bundle-media runs was fixed by
  closing each previous fixture server before the next resets its database.
