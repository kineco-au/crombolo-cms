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
- **Golden files:** Umbraco 13's and 17's Delivery API output for the same content (a
  list, a grid with areas, spans and settings, nested blocks, a variant block), captured
  with the .NET fixtures in Docker (never on the host), stored under
  `tests/fixtures/umbraco-delivery/`, and compared with ours, field by field. A difference
  is either fixed or listed in `docs/delivery-api.md` as deliberate.

## Acceptance criteria

- [ ] **Too few or too many blocks** in a list or grid are refused on validate and save,
      with Umbraco's message, through the Management API, the command line and a content
      file.
- [ ] **A mandatory field or pattern inside a block**, in content or settings, at any
      depth, is refused at Umbraco's path, and the back office highlights that block and
      field.
- [ ] **A block type the property doesn't offer**, and a grid area's allowance broken, are
      refused.
- [ ] **Variant blocks** save, publish, read and render per culture, as Umbraco's.
- [ ] **The browser suite** passes for Block List, Block Grid, Single Block and rich text's
      blocks, covering each step in the design.
- [ ] **Our Delivery API output** matches Umbraco's golden files, or each difference is
      documented.
- [ ] **Tests:** the validation's pure parts unit tested on both dialects; the suite and
      golden comparisons in CI.
- [ ] **Docs:** `docs/delivery-api.md` (any deliberate differences), the release notes
      (a save Umbraco would refuse is now refused: an upgrade note for content that was
      saved before).

## Out of scope

- The Umbraco importer's handling of block values, in crombolo-cloud (story 235's
  importer); its own coverage is a story there if it needs one.
