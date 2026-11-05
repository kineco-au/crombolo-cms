# 276 — The pages list view sorts by its property columns

**Epic:** C — The backoffice, end to end · **Priority:** could · **Size:** M
**Depends on:** 269

## Story

As an editor, I want clicking a property column in a list view, such as a
date or a price, to sort the pages by it, as the built-in columns do.

## Context

Left out of story `269`, which sorts by the built-in columns in the database.
A list view's own columns are property values, which are append-only and
read as "the latest per key at or before the version", so sorting a large
folder by one means joining that read into the listing query rather than
loading the folder. Until then such a column keeps the sort order.

## Acceptance criteria

- [x] `orderBy` naming a property alias the list view shows sorts by the
      current draft's value of it, in `orderCulture` for a property that
      varies, in either direction, with empty values last.
- [x] Numbers and dates sort as numbers and dates, not as text.
- [x] A page of a large folder still costs a page, and the total is right.
- [x] Tests on both engines.

## Implementation

- `DocumentListingRepository.children` (`packages/data/src/repositories/document-listing.ts`)
  takes `sort: { property, ascending }` beside the built-in columns. It orders
  by the property's current draft value (`property_value.is_current`, no
  segment), in the culture shown when the property varies.
  - The value is read with correlated subqueries, so a page is listed once.
  - Pages with no value come first in the order, so they are last either way.
  - Then come `int_value`, `decimal_value`, `date_value` and
    `lower(sortable_value)`. A value is kept in the column of its storage, so
    numbers and dates sort as numbers and dates.
- The adapter (`packages/server/src/adapters/documents.ts`) takes any
  `orderBy` that is not a built-in column as a property alias. One that names
  no property has no values, so the sort order stands.
- Tests (`tests/document-collection.test.ts`, SQLite and Postgres):
  - a number ascending and descending, 9, 10 and 100 rather than as text, with
    the page lacking one last;
  - a date;
  - text in each of two cultures;
  - the total.
