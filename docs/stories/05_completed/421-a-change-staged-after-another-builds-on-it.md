# 421 — A change staged after another builds on it

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 383, 399, 403

## Story

As a host staging a promotion one change at a time into one workspace, I want each
change to be staged over what the ones before it put there, so that a change that
builds on an earlier one in the same promotion is not refused or broken.

## Context

Reported by Crombolo Cloud on 2026-11-24, on 0.78.0, and confirmed here by reading. A
host takes each change in order (`GET changes/{id}/bundle`) and stages it
(`PUT changes?stage=true`), the first into a new workspace and each later one with
`&into=<that workspace>`. Two faults in `stage` and `stagePage`
(`packages/server/src/change-transfer.ts`):

1. **A change staged earlier in the workspace counts as missing.** What a change
   needs is looked for among the changes this site holds (`changes.held`) and those
   arriving in the same call (`coming`). The workspace's own `stagedChanges` are in
   neither, so a change whose `depends` names one staged a step earlier is told "it
   needs …, which this site does not have", and answers 409.
2. **A page the workspace already holds is made again.** `stagePage` decides whether
   a page exists from Shared alone (`shared.byKey`). A page an earlier staged change
   created is in the workspace and not in Shared, so the next change that touches it
   takes the "never made here" path and creates it a second time. On Postgres that is
   a 500, `duplicate key value violates unique constraint "node_unique_id_key"`. The
   delete path reads Shared alone too, and returns without deleting such a page.

The second fault does not need two requests: two changes handed to `stage` in one
call, the second touching a page the first made, take the same path. The route takes
one change per request, so sending them together is not a way round it today.

`lackingIn` (`403`) already looks in the workspace as well as the site, which is the
rule the rest should follow.

## The design

- **What a workspace holds counts as here,** for everything staging asks:
  - the changes it has staged count as held, for `depends`;
  - a page is looked for in the workspace first, then in Shared, to decide between
    making, changing and deleting it;
  - a page's fields are compared with the workspace's copy where it has one, as the
    update path already does (`here.byKey(…) ?? target`).
- **A change that deletes a page an earlier staged change made** removes it from the
  workspace.
- **A change already staged in the workspace is skipped,** as one the site holds is,
  so staging the same change twice does nothing.
- **Nothing staged answers a 500:** a page that cannot be made is a conflict naming
  the page and why.
- **Order still matters and is the caller's:** a change staged before the one it
  needs is still told what it needs.

## Decisions (2026-11-24, the maintainer's)

1. **One change per request,** as today; a list is a separate story if a host needs it.
2. **Earlier staged changes stay when a later one conflicts,** with a 409 naming the
   conflicts; the host decides whether to discard the workspace.
3. **Released in 0.79.0,** with `419` and `420`.

## Acceptance criteria

- [x] **Three changes staged in order into one workspace,** the second publishing a
      page the first made and the third renaming it and depending on the second, all
      stage with no conflict, and the workspace holds the page as the third left it.
- [x] **The same on Postgres** raises no unique-key error.
- [x] **A change that deletes a page an earlier staged change made** leaves the
      workspace without it.
- [x] **A change whose dependency is neither held nor staged** is still told what it
      needs.
- [x] **Staging the same change into the workspace twice** changes nothing the second
      time.
- [x] **Two changes handed to `stage` in one call** behave as the same two staged in
      turn.
- [x] **Merging the workspace** applies all of them, and each is then held.
- [x] **Tests** on both dialects; `docs/changes.md`, `docs/remote-protocol.md` and
      the release notes updated.

## Implementation

- `stage` (`packages/server/src/change-transfer.ts`): the workspace's `stagedChanges` count as
  held, so a change staged there is skipped and satisfies a later one's `depends`.
- `stagePage`: the page is looked for in the workspace first (`here.byKey`), then Shared, so
  one an earlier staged change made is changed or deleted there.
- A page that throws while staged is a conflict naming it, a duplicate key saying it is here
  already; never a 500.
- Tests: `tests/change-transfer.test.ts`, story 421's block (both dialects, CI running
  Postgres).

