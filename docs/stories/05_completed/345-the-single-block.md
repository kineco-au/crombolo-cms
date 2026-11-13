# 345 — The Single Block

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As an editor, I want a Single Block property to save, render and travel like a Block
List does, so that a page's one hero or one call to action is a block without being a
list of one.

## Context

Split out of story `272` on 2026-11-13, to come first: Umbraco 18's client already offers
the Single Block (`Umbraco.SingleBlock`), and ours serves it, but the server has never
known it. Its value is a block value with one layout entry under `Umbraco.SingleBlock`:

```json
{
  "layout": { "Umbraco.SingleBlock": [{ "contentKey": "…", "settingsKey": "…" }] },
  "contentData": [{ "key": "…", "contentTypeKey": "…", "values": [] }],
  "settingsData": []
}
```

**What we do not have, checked 2026-11-13.**
- **No one list of block editors.** Six places each keep their own:
  `JSON_VALUE_EDITORS` (`core/src/property-values.ts`), `STRUCTURED_EDITORS`
  (`data/src/content-query.ts`), `BLOCK_EDITORS` (`schema/src/edit.ts`),
  `config-references.ts`, `BLOCK_LAYOUT` (`server/src/seed/values.ts`) and `LIST_EDITORS`
  (`cli/src/support/blocks.ts`). None has the Single Block, so its stored JSON is not
  even parsed, and it renders, types and exports as nothing.
- **No one reader of block values.** `blockItems()` and the grid's areas
  (`render/src/values.ts`), the menus (`render/src/menus.ts`), the alias check
  (`content/src/block-aliases.ts`), the content files' writer and reader
  (`server/src/seed/values.ts`, which gives up on grid areas) and the CLI
  (`cli/src/support/blocks.ts` and `block/*`) each read `layout` themselves, so a new
  block editor is a change in each.

## Plan

1. **One list of block editors** in `packages/core`: Block List, Block Grid, Single
   Block and rich text, which the six lists above become. The Single Block's value is
   then parsed as JSON, and its element types count as its data type's references.
2. **One reader of block values** in `packages/core`: walks a value's layout for every
   block editor, grid areas and nested values included, and rich text's `blocks`, giving
   each entry its content and settings. The readers above move onto it, so story `272`
   extends one reader rather than five.
3. **Rendering:** the Single Block reads as one `BlockItem` or `null`, and `<Blocks>`
   takes it as well as a list. `crombolo generate` types it.
4. **Delivery API** (`output.ts`): output as one item, or `null`; `generate --delivery`
   types it.
5. **Content files** (`server/src/seed/values.ts`): written as one block rather than a
   list, and read back; `content export` writes it that way.
6. **The CLI:** `content block add` on a Single Block replaces the one there; `update`
   and `remove` work as for a list; `move` refuses, there being one.
7. **Search** indexes its text as a list's.

## Acceptance criteria

- [x] A Single Block's value saves, is parsed, and renders through `<Blocks>` as one
      block, or nothing when empty.
- [x] `crombolo generate` and `generate --delivery` type it.
- [x] The Delivery API outputs it as one item, with `expand` and `fields`.
- [x] Content files and `content export` write it as one block, and read it back.
- [x] The CLI adds (replacing), updates and removes it.
- [x] A page is found by search for its Single Block's text.
- [x] Its element types are listed as its data type's references.
- [x] Rendering, menus, the alias check, content files and the CLI read block values
      through the one reader, and content files read grid areas.
- [x] `docs/rendering.md` ("Blocks"), `docs/delivery-api.md`, `docs/bundles.md`
      ("Content files") and `docs/cli/` describe it.
- [x] Tests on both engines.

## Built

- **One list, one reader** (`packages/core/src/blocks.ts`): `BLOCK_EDITORS`,
  `BLOCK_VALUE_EDITORS` and `BLOCK_LIST_EDITORS`; `blockValueOf` (rich text's
  `blocks` included), `readBlocks` (a layout's blocks with their content, settings and
  grid areas), `blockLists` and `everyBlock` (areas and blocks inside blocks).
  `JSON_VALUE_EDITORS`, the content query's structured editors, `schema edit`'s block
  editors, the config references and the CLI's editors are built from it, and the
  content files' own layout table is gone.
- **Readers moved onto it:** rendering's `blockItems` and the grid's areas, the menus
  and their media keys, the alias check, the content files' writer and reader. The CLI's
  block commands edit the stored layout in place, as they did, but take their editors
  from the one list.
- **Rendering:** `convertValue` reads a Single Block as one `BlockItem` or `null`;
  `<Blocks items>` takes it. `crombolo generate` types it as `(BlockItem & …) | null`.
- **Delivery API:** one `{ content, settings }` item or `null`; `generate --delivery`
  types it as `ApiBlockListItem<…>`. `@crombolo/next-integration` gains `<SingleBlock>`.
- **Content files:** one block as a table; more than one refused. Grid areas are now
  written and read as `areas = [{ key, blocks = [ … ] }]`; the reader had given up on
  them and left the stored value.
- **CLI:** `content block add` replaces the one there, `update` and `remove` work,
  `move` refuses. `types new data-type --editor single-block` makes one.
- **Search** needed nothing: its text is read out of any block value.
- Tests: `tests/blocks-reader.test.ts`, `tests/single-block.test.ts`.
