# 411 — An unpublish, a move, a reorder and a delete are passed on

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 388, 395, 397

## Story

As a host that sends an editor's change to the serving site as soon as it is made, I
want to hear when they unpublish, move, reorder or delete a page as I hear of a
publish, so that those changes do not wait for the next promotion.

## Context

Asked for by Crombolo Cloud on 2026-11-24 (its story 306).

On the site where content is made, a person's publish, or setting or clearing a
schedule, closes their change and raises `Crombolo.ChangePublished` naming it (`388`,
`395`), and a publish in their own workspace does the same when it merges that page
(`397`). A host subscribed to it takes the change and applies it to the serving copy.

`recordInChange` (`packages/server/src/content-events.ts`) acts only on saves and on
the events in `PUBLISHES`, plus `scheduled`. An unpublish, a move, a reorder and a
delete (to the recycle bin, and for good) raise their own webhooks but close no change
and raise no `ChangePublished`. So a page taken down where content is made stays up
where it is served until something else is published.

Found out before the design was fixed (2026-11-24):

- **Straight in Shared, none of the four joins the person's change.** `recordInChange`
  records only saves, and closes the change only on a publish or a schedule.
- **A change bundle carries three of the four:** an unpublish (`after.published: false`),
  a move (`beforeParentKey`) and a delete (`action: 'delete'`). **It carries no sort
  order,** so a reorder cannot be applied on another site yet.
- **In a person's own workspace only a publish merges at once** (`publishOwnPage`). An
  unpublish, move, reorder or delete made there waits for that page's next publish,
  which for a delete or an unpublish never comes, so it never reaches the serving site.

## The design

- **Each of the four joins and closes the person's change and is announced,** in the
  same transaction, as a publish is, made straight in Shared.
- **In a person's own workspace, done to a page Shared has,** each merges that page at
  once (a reorder, the parent's children), where the person may, and is announced with
  `From: own-workspace`; where it cannot go, it stays there and the answer says why, as
  a publish does. A page made in the workspace and never merged is only dropped,
  moved or reordered there: nothing merges, nothing is raised.
- **The same event, saying what happened:** `Crombolo.ChangePublished` with
  `Change.Kind`: `publish` (absent today, and for a schedule), `unpublish`, `move`,
  `reorder` or `delete`. `Change.Key`, `Name`, `By`, `Tool`, `Needs` and `From` are as
  today.
- **A delete names a page that is gone:** the event carries its key and the name it
  had, read before it went, as the audit entry does.
- **Applied on the other site, the change does the same there.** A delete arrives as
  the item a merge already shows as losing content (`page-deleted`), and is settled
  as any such item is.
- **A reorder is one change for the parent's children,** not one per page moved. The
  change bundle gains `orders: [{ parentKey, keys }]`, the children in their new order;
  applying it puts those the target has in that order, the rest after, and a parent the
  target reordered since the change's base is a conflict, as a moved page is.
- **A named workspace's merge raises none,** as today: it raises `WorkspaceMerged`.

## Decisions (2026-11-24, the maintainer's)

1. **The same event, with `Change.Kind`:** `publish` (absent, as today, for a publish or
   a schedule), `unpublish`, `move`, `reorder`, `delete`.
2. **The recycle bin is the delete.** Emptying it announces nothing more; restoring from
   it is announced as a move.
3. **A move or reorder of an unpublished page is announced,** so the two trees stay the
   same.
4. **One event for a branch,** for the page acted on; the change holds the rest.
5. **In a person's own workspace, each of the four done to a page Shared has merges at
   once** and is announced; one done to a page made there is not.
6. **A reorder travels as the parent's children in their new order** (`orders`).

## Acceptance criteria

- [x] **An unpublish, a move, a reorder and a delete** by a person in Shared each
      close their change and raise the event once, naming the change and the kind.
- [x] **The same four in the person's own workspace,** done to a page Shared has, merge
      at once and raise it with `From: own-workspace`; done to a page made there, they
      merge nothing and raise nothing.
- [x] **A reorder taken to another site** puts the children it has there in the new
      order; one the target reordered since is a conflict.
- [x] **The change, taken and applied to another site,** leaves the page unpublished,
      moved, in its new order or gone there.
- [x] **A delete's event** names the page's key and the name it had.
- [x] **A publish and a schedule** raise what they do today, unchanged for a
      subscriber that ignores the kind.
- [x] **A merge, an import and the site's own code** doing any of the four raise
      none, as for a publish.
- [x] **A named workspace's merge** raises `WorkspaceMerged` only.
- [x] **Tests** on both dialects; `docs/webhooks.md`, `docs/changes.md` and the
      release notes updated.

## Implementation

- **Events carry where a page was:** `moved.from`, `sorted.before` and `deleted.was` (a
  delete from outside the bin) (`packages/content/src/events.ts`, `operations.ts`).
- **The change holds it:** `ChangeRepository.placed`, `ordered`, `removedBy` and
  `closeOpen` (`places/<key>`, `orders/<key>`, `pages/<key>`); `placeInChange` in
  `content-events.ts` records each of the four and announces it with `kind` (and `page`
  for a delete). A merge records the same items (`workspace-merge-run.ts`).
- **The bundle:** `restored` on a page, `orders` on the change
  (`packages/transfer/src/change-bundle.ts`); `placeOn` lays a page's recorded place over
  the states read back, which only know where it is now (`change-transfer.ts`).
- **Applying:** unpublish, restore (moved out of the bin, or made again) and
  `stageOrder`, with a parent reordered since a conflict.
- **Own workspace:** `MERGED_AT_ONCE` and `mergeOwnPage` (`workspaces.ts`) merge the page,
  or a reorder's siblings, at once (`only` takes several keys, `onlyKind` names and
  announces the merge); a page made there is left alone. A delete is accepted by asking.
- **Payload:** `Change.Kind` and `Change.Page` (`webhooks.ts`).
- **Found and fixed on the way:** unpublishing a page in any workspace that had not saved
  it there answered 404: the workspace's read of a page with no version of its own now
  falls back to Shared's version it began from (`documents.ts`).
- Tests: `tests/content-locked.test.ts`, story 411's block (both dialects).
