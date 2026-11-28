# 456 — The block editors behave as Umbraco's

**Epic:** C — The backoffice, end to end · **Priority:** must · **Size:** L
**Depends on:** 184, 345

## Story

As someone who builds pages from blocks, as most Umbraco sites do, I want Block List,
Block Grid, Single Block and blocks in rich text to accept, refuse, store and deliver
exactly what Umbraco's do, so that moving a site to crombolo changes nothing about how
its editors work or what its front end receives.

## Context

The back office's block editors are Umbraco's own client, and crombolo's server answers
every call they make. What is covered today:
- **Reading values:** lists, grids with areas, Single Block, rich text's blocks, blocks
  within blocks (`blocks-reader`, `value-converters`, `core`).
- **Rendering:** list order, the grid's markup with spans and areas, Single Block, blocks
  in rich text (`blocks`, `single-block`, `content-pages`, `rich-text-tree`).
- **The Delivery API:** block output and aliases (`value-converters`, `block-alias`,
  `delivery-types`).
- **Schema and the command line:** block tables, add, rename, move and remove, a type a
  list doesn't offer refused, aliases unique within a list (`schema-scaffold`,
  `single-block`, `cli`, `types-rename`, `schema-references`).
- **Search and references** inside blocks.

What is not:
1. **The server doesn't validate blocks.** On save, `validateValues`
   (`packages/data/src/repositories/documents.ts`) checks only top-level mandatory fields
   and patterns. `validationLimit` is never read on the server. Umbraco refuses, on the
   server:
   - fewer or more blocks than a list's or grid's limits;
   - a mandatory field left empty, or a pattern unmatched, on a property inside a block,
     in its content and its settings, at any depth;
   - a block of a type the property doesn't offer, and in a grid, a block an area doesn't
     allow or more than an area allows.

   The back office catches most of these before it saves, but the Management API, the
   command line, agents and content files can store and publish blocks Umbraco would
   refuse.
2. **Blocks that vary by culture or segment** (the `expose` list, Umbraco 13 onwards) have
   no test that they save, publish, read and render per language as Umbraco's do.
3. **The editor in a browser** is barely exercised: one journey, about aliases.
4. **The Delivery API's shape** is tested, but not against Umbraco's own output for the
   same content.

## Decided (2026-11-28)

1. **Server validation matches Umbraco's**, for the Management API's validate and save,
   the command line, content files and bundles alike.
2. **Errors are reported at Umbraco's paths**, so the back office highlights the block and
   the field: `$.contentData[n].values[?(@.alias == 'x' && @.culture == null &&
   @.segment == null)].value`, and the same for `settingsData`, as Umbraco 14+'s
   validation answers do.
3. **Coverage, not just fixes:** a browser suite for each editor, and golden files of
   Umbraco's Delivery API output to compare against.
4. **Golden files are hand-written from Umbraco's documentation** of the Delivery API's
   shapes (blocks, grids with areas and spans, settings, nested blocks, variant blocks),
   for 13 and 17 where they differ, citing the page each follows. No .NET in this repo or
   its CI.
5. **Stored content is refused on its next save,** not before: what is stored keeps
   rendering and stays published, and the next save or publish of a page with a block
   problem is refused until it is fixed, as Umbraco does. `crombolo content check` and the
   health check list the pages that would be refused, so a site can fix them ahead.
6. **Content files, bundles and changes from another site are validated too,** blocks and
   top-level fields alike, before anything is written: a refused import names each page,
   property and block path, and nothing is applied.
7. **Umbraco's wording** for every message (`Minimum %0% entries, requires %1% more.`,
   `Maximum %0% entries, %1% too many.`, `Value cannot be empty`, a property's own
   mandatory and pattern messages), so the server says what the editor already shows.

## The design

- **Validation:** `validateValues` gains a block step for Block List, Block Grid, Single
  Block and rich text's blocks. Reading the property's data type configuration and each
  block's element type, it checks:
  - **counts:** `validationLimit.min` and `max` on the number of blocks in the layout;
  - **allowed blocks:** each block's `contentTypeKey` (and `settingsTypeKey`) among those
    the configuration offers, and in a grid, each area's `specifiedAllowance` and its
    limits;
  - **inside each block:** every property of its element type, in `contentData` and
    `settingsData`, for mandatory and pattern, recursing into blocks within blocks, and
    for a culture- or segment-variant block, per culture in `expose`.
  - Messages are Umbraco's wording where Umbraco has one (`Minimum %0% entries, requires
    %1% more.`, `Maximum %0% entries, %1% too many.`), filled in.
- **Variance:** saving, publishing and reading a block list whose element type varies by
  culture, with `expose` per culture, and a segment, as Umbraco 13+ stores it.
- **The browser suite** (`tests/browser/blocks/*.browser.ts`), against a site with a block
  list, a grid with areas, a Single Block and rich text with blocks:
  - add a block from the catalogue, fill it in, save, publish, see it rendered;
  - reorder by drag, delete, undo the delete;
  - block settings, and inline editing where the configuration asks for it;
  - in the grid: column and row spans resized, a block placed in an area, an area's
    allowance refused;
  - copy a block and paste it into another property;
  - the editor's own min/max and mandatory-field errors, and the server's, both shown on
    the right block;
  - a variant block edited in two languages.
- **Golden files:** the Delivery API output Umbraco documents for a list, a grid with
  areas, spans and settings, nested blocks and a variant block, written by hand from its
  documentation (13 and 17 where they differ, each file citing the page it follows),
  stored under `tests/fixtures/umbraco-delivery/`, and compared with ours for the same
  content, field by field. A difference is either fixed or listed in
  `docs/delivery-api.md` as deliberate.
- **Imports:** content import, bundle install and a change from another site run the same
  validation over every page they would write, before writing; refused, they report every
  page, property and block path and apply nothing.
- **Ahead of time:** `crombolo content check` and the health check's content entry list the
  stored pages the rules would refuse on their next save, with each problem's path.

## Acceptance criteria

- [x] **Too few or too many blocks** in a list or grid are refused on validate and save,
      with Umbraco's message, through the Management API, the command line and a content
      file.
- [x] **A mandatory field or pattern inside a block**, in content or settings, at any
      depth, is refused at Umbraco's path, and the back office highlights that block and
      field.
- [x] **A block type the property doesn't offer**, and a grid area's allowance broken, are
      refused.
- [x] **Variant blocks** save, publish, read and render per culture, as Umbraco's.
- [x] **Imports** (content files, bundles, changes from another site) are validated before
      anything is written, and a refusal names every page, property and block path.
- [x] **Stored content** keeps rendering; its next save is refused until fixed, and
      `crombolo content check` and the health check list it beforehand.
- [x] **Messages** are Umbraco's wording.
- [x] **The browser suite** passes for Block List, Block Grid, Single Block and rich text's
      blocks, covering each step in the design.
- [x] **Our Delivery API output** matches the hand-written golden files from Umbraco's
      documentation, or each difference is documented.
- [x] **Tests:** the validation's pure parts unit tested on both dialects; the suite and
      golden comparisons in CI.
- [x] **Docs:** `docs/delivery-api.md` (any deliberate differences), the release notes
      (a save Umbraco would refuse is now refused: an upgrade note for content that was
      saved before).

## Built

- **Validation** (`packages/core/src/block-validation.ts`, pure): `blockValueProblems` checks
  a Block List, Block Grid, Single Block or rich text value — `validationLimit` min (no
  value counts as none) and max on the root blocks; each block's `contentTypeKey` and its
  settings' among those the configuration offers; in a grid, `allowAtRoot`, `allowInAreas`,
  each area's `specifiedAllowance` (element or group) with its limits and the area's own
  `minAllowed`/`maxAllowed`; and every property of each block's element type, content and
  settings, for mandatory and pattern, recursing into blocks within blocks. A
  culture-variant block is checked in each validated culture its `expose` names; a value
  with no `expose` in every validated culture. An empty block list is empty for a
  mandatory property. `validateValues` in `packages/data/src/repositories/documents.ts`
  calls it for every block editor property, loading the element types a value names at
  any depth (`#elementTypesFor`).
- **Paths and words:** `DocumentValidationError` gains `path`, the continuation into the
  value; `validationProblem` appends it to the property's own path, by index when sent
  (`$.values[0].value.contentData[1].values[?(@.alias == 'title' && @.culture == null &&
  @.segment == null)].value`), as Umbraco 14+'s block path translators read it. Messages:
  `Minimum %0% entries, requires %1% more.`, `Maximum %0% entries, %1% too many.`,
  `<type> is not allowed at this spot.`, `The content amount requirements are not met for
  one or more areas.`, a property's own mandatory/pattern message else `Value cannot be
  empty` / `Value is invalid, it does not match the correct pattern`.
- **Where:** validate, create-and-publish, save-and-publish and publish (all rules); a
  draft create and save, documents and Library items, refuse block problems (`'blocks'`
  scope) while a top-level empty field stays a publish rule. The command line prints each
  problem's full path. Imports: the transfer check (`invalid-blocks`, blocking) validates
  what each node would hold once written, before anything is written, for content files,
  `site apply`, bundle install and `content import`; a change from another site is
  validated once staged, each problem a conflict, so nothing reaches Shared.
- **Stored content:** `storedBlockProblems` (`packages/data/src/repositories/stored-blocks.ts`)
  lists pages and Library items whose next save would be refused; `crombolo content check`
  (exit 20 with findings, `-o json`) and the health check's **Content › Blocks** entry use
  it. What is stored keeps rendering and stays published.
- **Variance:** the render layer reads a block's values in the page's culture (falling back
  to invariant) and leaves out a block not exposed in it (`ValueContext.culture`,
  `valuesIn`, `exposedIn` in `packages/render/src/values.ts`); before, every language
  showed a varying block's first culture. Save, publish, read, render and the Delivery API
  per culture are tested end to end (`tests/block-editors.test.ts`).
- **Rich text's blocks** never reached a page or the Delivery API (the published value was
  the markup alone); a rich text value holding blocks is now published as `{ markup,
  blocks }` (`toPublishedValue`), so views get a `RichTextValue` and the Delivery API its
  `blocks`.
- **Delivery API against Umbraco's:** `tests/fixtures/umbraco-delivery/` (list, grid with
  areas/spans/settings, rich text with blocks — from Umbraco's property expansion page,
  13 and the current docs alike; nested blocks, Single Block and a variant block in two
  cultures derived from its documented item shape and behaviour, said in each file).
  `tests/umbraco-delivery-golden.test.ts` compares field by field and in order. Fixed:
  a grid area answered its key as `alias` and the grid's columns as its spans; a block's
  `areaGridColumns` ignored its block type; a block's elements carried `name: ""`.
  Deliberate differences in `docs/delivery-api.md`, "Blocks as Umbraco's".
- **Browser suite** `tests/browser/blocks/` (site in `blocks/site.ts`, a draft saved before
  the rules seeded by `blocks/seed.ts`): list (catalogue, inline, workspace, drag reorder,
  delete and a delete declined at its confirmation, settings, the editor's mandatory and
  minimum messages, the server's refusal marking the right block, copy and paste into
  another property), grid (a block in an area offering only its allowance and no second,
  a span resized by its handle), Single Block, rich text (insert, delete, undo) and a
  variant block in two languages. Drag and resize use the mouse in steps, as Umbraco's
  sorter and scale handler follow pointer moves. Umbraco's list and grid have no undo for a
  delete — its confirmation is the take-back, which the list journey declines; rich text's
  editor undo is exercised.
- **Docs:** `api-contract.md` ("Blocks are validated as Umbraco's are"), `delivery-api.md`,
  `rendering.md`, `content-transfer.md` (`invalid-blocks`), `changes.md`, `diagnostics.md`,
  `testing.md`, release notes.

## Out of scope

- The Umbraco importer's handling of block values, in crombolo-cloud (story 235's
  importer); its own coverage is a story there if it needs one.
