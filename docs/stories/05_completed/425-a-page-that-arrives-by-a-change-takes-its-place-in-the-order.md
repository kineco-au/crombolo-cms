# 425 — A page that arrives by a change takes its place in the order

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** M
**Depends on:** 411

## Story

As a host passing changes from the site where content is made to one where it is only
read, I want a page a change creates to take the place among its siblings it has where
it was made, so that the two sites keep the same order and a later reorder is not a
conflict on a site where nobody reordered anything.

## Context

Reported by Crombolo Cloud on 2026-11-25, on 0.79.0, and confirmed here by reading; not
run. Studio's top level holds A, B, C, D. B reached Production after C and D, having
waited for a type that came in a later change, so Production holds A, C, D, B. Production
is locked (`CROMBOLO_CONTENT=locked`); nobody sorted anything there. An editor reorders
the top level in Studio, and staging that change on Production is a conflict: "The top
level's pages were put in another order here since."

Two things in `packages/server/src/change-transfer.ts`:

- **A page a change creates carries no place among its siblings.** `stagePage` creates
  it under its parent and it goes last. A change's page says its parent
  (`parentKey`, `placeOn`) and nothing of its order. So the order drifts whenever pages
  arrive in another order than they were made, or a page is made between others.
- **`stageOrder` treats any difference as a sort made here.** Over the pages both sides
  know, it compares the order here with the order the change started from
  (`order.before`), and a difference is the conflict above. It cannot tell a sort
  someone made here from drift the first fault caused.

The reorder change (`411`) is therefore refused on any site whose order has drifted, and
on a locked site nobody can settle it by hand.

## The design

- **A change's created or moved page carries its place:** its parent's children in order
  when the change made or moved it, kept by the change and carried in the bundle.
- **Staged, the page is put there:** after the nearest sibling before it that this site
  has, else before the nearest after it. Siblings the change does not name keep their
  places relative to each other. Placing a page is never a conflict.
- **Where content is locked, a reorder is always applied:** nobody reorders there, so
  another order than the change found is only drift. This puts right a site already out
  of step, at the next reorder that reaches it.
- **Where content is not locked,** a reorder that finds another order is the conflict
  it is today, settled there in the staged workspace.
- **An older bundle** with no place on its pages is staged as today, last.

## Decisions (2026-11-25, the maintainer's)

1. **Both parts:** pages take their place, and a locked site applies a reorder.
2. **"Locked", not "was it sorted here":** a fact the site knows, where a rule about
   since when would not be.

## Acceptance criteria

- [x] Pages arriving in another order than they were made end in the order of the site
      they were made on.
- [x] A reorder staged on a locked site whose order differs is applied, with no conflict.
- [x] A reorder staged on a site that is not locked, where the same parent was sorted
      since, is a conflict, as today (story 411's test).
- [x] A move to another parent carries its place and lands there.
- [x] A workspace's merge keeps the place of a page it made.
- [x] A bundle from an older version stages as it does today.
- [x] Tests on both dialects; `docs/changes.md` says a page keeps its place.

## Implementation

- **Kept by the change:** `siblings/<parent>` among its items (`SIBLINGS_PREFIX`,
  `ChangeRepository.amongSiblings`), the parent's children in order: for a page made or
  moved straight in Shared (`content-events.ts`), and for each page a merge made or moved
  (`workspace-merge-run.ts`).
- **Carried:** `ChangeBundlePage.siblings`, on a created page and a moved one
  (`exportChange`, `change-transfer.ts`).
- **Staged:** `placeAmong` after a page is made or moved in the staged workspace, as a
  sort there, which the merge applies. `stageOrder` skips its comparison where
  `locked()` (`contentLocked(config)`, `server.ts`).
- A page placed in the middle renumbers its siblings, so the merge on the site taking it
  records an order of its own for that parent.
- Tests: `tests/content-locked.test.ts`, story 425's block.
