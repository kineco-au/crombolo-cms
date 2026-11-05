# 267 — The Public access dialog shows a page's rules

**Epic:** C — The backoffice, end to end · **Priority:** must · **Size:** S
**Depends on:** 024

## Story

As an editor reopening "Public access" on a protected page, I want to see the
rules the page already has, so that I change them rather than unknowingly
starting again.

## Context

Found 2026-11-05. The client's dialog (`members/member-public-access/modal/
public-access-modal.element.ts`) reads the page's item first and loads its
rules only `if (item.isProtected)`. Every document item, tree item, list-view
item and search result answers `isProtected: false`
(`packages/api-management/src/handlers/document.ts`), so the dialog always
opens as if the page had no rules, and saving from it posts new ones over
them. Pages protected through an ancestor are affected too: the read answers
`isProtectedByAncestor`, but the dialog never asks.

Public access itself is enforced correctly when pages render; only the
back office's view of it is wrong.

## Acceptance criteria

- [x] `isProtected` is true for a page with its own rules in the item, tree,
      collection and search answers, without a query per item.
- [x] Reopening the dialog on a protected page shows its groups or member,
      and its sign-in and no-access pages.
- [x] A page protected only through an ancestor opens on the ancestor's rules,
      as Umbraco does.
- [x] Removing protection sets `isProtected` back to false.
- [x] Tests on both engines, asserting the `isProtected` the dialog reads.

## Implementation

- `DocumentTreeItem.isProtected` (`packages/core/src/documents.ts`): true
  when the page or a page above it has a public access entry, as Umbraco's
  `IsProtected(path)` means. The dialog then reads the rules with
  `includeAncestors`, so a page protected through an ancestor opens on that
  ancestor's rules.
- `DocumentRepository.treeItems` reads it with one more query a page (the
  entries among the pages and every id on their paths), so the tree, item
  lookups, ancestors, siblings and search all carry it.
  `DocumentRepository.protectedKeys` does the same for the list view, whose
  rows are documents rather than tree items (`DocumentCollectionItem`).
- The handlers (`document.ts`) answer it instead of `false`.
- Tests (`tests/public-access.test.ts`): the protected page and its child are
  protected in items, the tree, the list view and search, an unprotected page
  is not, and removing the entry clears it. No browser test: the dialog's only
  condition is the item's `isProtected`, which the test asserts.
