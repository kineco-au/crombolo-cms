# 255 — Compositions shown and checked

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone building types from the command line, I want a composed type to
show the properties it takes from its compositions, and a property that clashes
with one to be refused, so that what `types show` says is what a page has.

## Context

Found by the walkthrough in `docs/building-a-site-from-the-cli.md`, where
`homePage` is composed of `contentPage`:

- `types show homePage` says "No properties", but the page has `title`, `body`
  and `blocks` from `contentPage`, and its view renders them.
- `types new content-type homePage --compose contentPage` gave `homePage` a
  `title` of its own beside the composition's `title`, and it was applied.
  `types property add homePage title` is accepted too. The alias clashes, so
  which value a view reads is not clear.
- `types new content-type … --element` gives an element type a mandatory
  `title` and puts it in the Library. The walkthrough removed both for a block
  that has a heading instead.

## Decided (planning, 2026-11-03)

- **A clash is refused everywhere.** A property whose alias a composition
  already has is a problem like any other. The whole-site check refuses it, so
  a site that has one does not apply its definitions until it is fixed. The
  upgrade note says to run `crombolo types check` first, and the problem names
  the command that fixes it (`types property remove homePage title`).
- **A new element type starts with nothing.** It has no properties and is not
  in the Library. `--title` adds the mandatory title, and `--library` puts it
  in the Library. A content type keeps its title unless `--no-title` is given
  or a composition has a `title`.

## Plan (2026-11-03)

Today, for reference:
- `effectiveProperties(set, type)` in `packages/schema/src/generate.ts` is
  what `crombolo generate` uses. It already walks compositions, including
  built-in ones such as `seoFields`, but it does not say where each property
  came from.
- `validateSchemaSet` checks that a composition exists, that it varies by
  culture with its fields, and that there are no cycles. It does not check
  for clashes.
- `newType` in `scaffold.ts` gives every type with a tab a mandatory `title`,
  and puts every element type in the Library.

1. **Where a property comes from:** `composedProperties(set, type)` in
   `packages/schema`.
   - It returns each property a type takes from its compositions, with the
     composition it comes from. A composition's own composition counts as
     coming through it, named by both.
   - `effectiveProperties` is built on it, so `generate` is unchanged.
2. **`types show`:**
   - The composed properties are listed in their tabs, as the back office
     merges them, each marked `from contentPage`.
   - "No properties" is said only when there are none at all.
   - In `-o json`, each property gains `from` (`null` for the type's own) and
     `via` (the path, when it is a composition's composition).
3. **The check:**
   - `validateSchemaSet` refuses an own property whose alias a composition
     has: `property "title": "contentPage" has a property "title" already`.
   - It also refuses two compositions that bring the same alias.
   - The fix named is `crombolo types property remove <type> <alias>`. Because
     it is the whole-set check, `types property add`, `types update
     --compose`, `types new --compose`, a hand edit and a boot are all
     covered.
4. **`types new`:**
   - `--compose` with a composition that has a `title` gives the new type
     none of its own.
   - `--no-title` leaves the title out of any type.
   - `--element` starts with no properties and outside the Library. `--title`
     and `--library` add them.
5. **Sync:** check that a type whose clash was already applied is refused
   cleanly, and that removing the clashing property then applies.
6. **Tests:**
   - `composedProperties`, through two levels and from a built-in type;
   - `types show`, in text and JSON;
   - a clash refused by `property add`, by `update --compose`, by a hand edit
     and by `types check`;
   - two compositions clashing;
   - `types new` with `--compose`, `--no-title` and `--element`.
7. **Docs:**
   - the walkthrough: step 2 without the removals it needed;
   - its rough edge and its row in the gaps table removed;
   - the release note, with the upgrade note and the element default
     changed;
   - the guide on types.

## Implementation (2026-11-03)

- **Compositions:** `packages/schema/src/compositions.ts`.
  - `placedProperties` gives a type's own properties with their tab and
    group.
  - `compositionType` finds a composition among the site's types or the
    built-in ones.
  - `composedProperties` walks compositions depth first, each type once, and
    records `from` (the defining type) and `via` (the direct composition, when
    that is a different type).
  - `effectiveProperties` moved here from `generate.ts` and is built on it, so
    `generate` and the delivery types are unchanged.
- **The check:** `compositionClashes` in `validate.ts`, called for every type
  of every kind.
  - An own property that clashes, compared case-insensitively, is reported at
    `property "<alias>"`. The message names
    `crombolo types property remove <type> <alias>`.
  - Two compositions bringing one alias are reported at the compositions key.
  - One composition reached two ways (a diamond) is not a clash.
  - `describeLocated` adds no second command when a message already names
    one.
- **`types show`:** `propertyDetails` lists own and composed properties.
  - A composition's tab merges into the type's tab of the same name, ordered
    by where each tab first appears.
  - Each property has `from` and `via`, and the text says `from contentPage`.
- **`types new`:**
  - `--title` / `--no-title`. The default is a title for a content type, none
    for an element type, and none when a composition has a `title`, with the
    compositions walked through.
  - `newType` puts an element type in the Library only with `--library`.
- **Tests:** `tests/compositions.test.ts`:
  - `composedProperties`, through two levels and from built-in `seoFields`;
  - a clash in its own property, two compositions clashing, and a diamond
    that does not;
  - `types show` in text and JSON;
  - a clash refused by `property add`, by `update --compose`, and by a hand
    edit through `types check` and `types sync`;
  - `--no-title`, and element types with and without `--title` and
    `--library`.
- **The repo's own sites** and templates were checked: none has a clash.
- **Docs:**
  - the walkthrough's step 2 lost the three removals it needed, and its row
    in the gaps table is gone;
  - the end-to-end test lost the same removals;
  - the release note, with the upgrade note.

## Acceptance criteria

- [x] `types show` lists a composed type's properties from each composition,
      saying which composition each comes from; `-o json` gives the same.
- [x] A site whose definitions already have a clash is refused until it is
      fixed, with the problem naming the command that fixes it.
- [x] A property whose alias a composition already has is refused, by
      `types property add`, by `types update --compose` and by the check on a
      hand-edited file.
- [x] `types new content-type --compose` adds no `title` of its own when a
      composition has one, and `--no-title` leaves it out on any type.
- [x] A new element type starts with no properties and outside the Library;
      `--title` and `--library` add them.
- [x] Tests for each.
