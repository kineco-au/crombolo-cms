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

- **A change's created page carries its place:** the keys of its siblings in order where
  it was made, as the change left them (or the sibling it follows; decide while
  building). Recorded when the change is made, carried in the bundle.
- **Staged, the page is put there:** after the nearest sibling before it that this site
  has, else first. Siblings this site has and the change does not name keep their
  places relative to each other.
- **A page moved to another parent by a change** takes its place the same way.
- **A reorder is a conflict only where the order was sorted here:** a difference from
  `order.before` with no sort made on this site since (none recorded among its own
  changes, as on a locked site) is drift, and the change's order is applied. A sort made
  here since is the conflict it is today.
- **Sites already out of step** are put right by the next reorder that reaches them
  under the rule above; nothing is migrated.
- **An older bundle** with no place on its created pages is staged as today, last.

## Decisions for the maintainer

1. Both parts, or only the first. The first alone stops new drift but leaves every site
   that has drifted refusing reorders; the second alone lets drift go on between
   reorders, with pages listed in another order on the two sites.
2. How "sorted here" is known: from this site's own changes holding an order for that
   parent (`orders/…` items not from an applied change), or simply that the site is
   locked.
3. Whether the place travels as the whole sibling order or one neighbour.

## Acceptance criteria

- A page created by a change between two others is staged between them on a site that
  has both, and after the nearest earlier sibling it has otherwise.
- Pages arriving in another order than they were made end in the order of the site
  they were made on.
- A reorder staged on a site whose order differs only by drift is applied, with no
  conflict; on a locked site in particular.
- A reorder staged on a site where someone sorted the same parent since is a conflict,
  as today.
- A move to another parent lands the page at its place there.
- A bundle from an older version stages as it does today.
- The journey "an unpublish, a reorder and a delete reach Production" passes where a
  page arrived late.
- Tests on both dialects; `docs/changes.md` says a page keeps its place.
