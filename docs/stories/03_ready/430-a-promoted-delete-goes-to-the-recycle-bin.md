# 430 — A promoted delete goes to the recycle bin

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** M
**Depends on:** 383, 411

## Story

As someone running a site that takes its content by change, I want a page deleted where it
is made to go to the recycle bin where the change lands, so that a deletion can be undone
there as it can be where it was made, with its history.

## Context

Raised by the maintainer on 2026-11-25. From reading; not run, and not built.

A page moved to the recycle bin and one deleted for good are both recorded as a removal and
carried as `action: 'delete'` (`exportChange`, `packages/server/src/change-transfer.ts`).
`stagePage` stages either with `here.delete(page.key)`, a pending `delete`, and the merge
runs `shared.delete` (`workspace-merge-run.ts`): the page, its versions and **every page
below it** go for good, pages only the target has among them. So an editor who moves a page
to the bin, and can restore it, has it destroyed on the site the change goes to.

The guards are that `page-deleted` is accepted, and that a page changed or still used there
is refused. None makes it recoverable. A restore passed on later makes the page again, with
none of the target's history.

A merge of a workspace's own pending `trash` already goes to the bin, and its finding
already reads "is moved to the recycle bin".

## The design

- **A removal is staged as a move to the bin,** whether the source moved the page there or
  deleted it for good, for pages, media and Library items. A blueprint has no bin and is
  deleted as now. The merge's finding, `page-deleted`, then says "moved to the recycle bin".
- **A page already in the target's bin** is left there: nothing to do, and no conflict. Today
  it would be one, being unpublished there.
- **A change that brings a page back takes it out of the bin:** a restore, as now, and a
  revert of the delete, or any later change that makes or changes a page whose target is in
  the bin, which today would edit it inside the bin.
- **"Still used"** looks at the values in use and not at old versions', nor at the page's
  own or those of the branch going with it.
- **What the source deletes for good is never deleted for good by a change.** Removing it
  from the target is done there, by emptying its bin.

## Decision (2026-11-25, the maintainer's)

**One deleted for good goes to the bin too.** A change never destroys anything; a deletion
for privacy also needs the bin emptied on each site, which a locked site does not refuse.

## Plan

1. `stagePage` (`change-transfer.ts`): the bin for pages, media and Library items; blueprints
   deleted as now; one already in the bin left there.
2. A later change that restores, reverts or changes a binned page takes it out.
3. `stillUsed`: values in use, less the page's own and its branch's.
4. Tests, on both dialects; `docs/changes.md`, the release notes.

No migration, and no change to the bundle.

## Acceptance criteria

- A page moved to the bin, its change staged and merged, or applied in one call, is in the
  target's bin with its versions and the branch below it.
- The same for a page deleted for good where it was made, for media and for a Library item.
- The restore passed on later takes it out, to where it was, its history kept.
- Reverting the delete on the source and passing that on takes it out of the bin too.
- A delete of a page already in the target's bin merges, with nothing to accept.
- A new page at the binned page's address is made with no clash.
- The merge says the page is moved to the recycle bin; `page-deleted` still accepts it.
- A blueprint is deleted, as now.
- A change from an older version is staged the same way.
- Tests on both dialects; `docs/changes.md` and the release notes say where a delete goes.
