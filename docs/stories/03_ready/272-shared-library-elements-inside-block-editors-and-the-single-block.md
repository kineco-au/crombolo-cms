# 272 — Shared Library elements inside block editors, and the Single Block

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** XL
**Depends on:** 027

## Story

As an editor, I want to place a shared element from the Library in a Block
List, Block Grid, Single Block or rich text beside local blocks, so that a call
to action or a promo kept once in the Library appears on many pages and
changes everywhere when it is published.

## Context

On Umbraco's roadmap ("Elements in the Block Editor"), checked 2026-11-05.
Umbraco built it as "Reusable Content of Blocks" (PR #22448, with follow-ups
#23195, #23271, #23871, #24180, #24181, #24221, #24242 and #24263), in
19.0.0-beta1 (2026-10-28), with 19.0.0 expected in December 2026. Our fork is
on 18.2.0, so the editing UI comes with the move to Umbraco 19 (story `277`).
This story builds everything the server does, against Umbraco 19's value
shape, so that move finds it ready.

**The value shape.** A block's layout entry gains a structural `key`, distinct
from `contentKey`, because one element may now appear several times in one
value. A shared block is a layout entry with `isExternalContent: true` whose
`contentKey` is the Library element's key; it has no `contentData` entry, and
its settings stay local:

```json
{
  "layout": { "Umbraco.BlockList": [
    { "key": "…", "contentKey": "<element key>", "settingsKey": "…", "isExternalContent": true }
  ] },
  "contentData": [],
  "settingsData": [{ "key": "…", "contentTypeKey": "…", "values": [] }]
}
```

Values saved by an 18.x client have no layout `key`; one is derived from
`contentKey` when read, as Umbraco does.

**What Umbraco does at render.** A shared block resolves to the element's
published version (its draft in preview), and is left out when the element is
not published in the culture shown. The local block's "expose" rules do not
apply to it: the element's own publishing decides. Its text is indexed with
the page that uses it, and publishing the element reindexes those pages.

**What we already have.** The Library (story `027`) and its published cache,
which the Element Picker reads (`context.element` in
`packages/render/src/values.ts`). References are found by scanning stored
values for keys (`packages/data/src/repositories/references.ts`), so "used
by", "referenced by N items" and the recycle bin's warnings count a shared
block without any change. Publishing an element already refreshes pages.

**The Single Block** (`Umbraco.SingleBlock`, decided 2026-11-05 to fold in
here). Umbraco 18's client offers it, and ours serves it, but the server has
never known it: its value is not rendered as a block, typed by `crombolo
generate`, shaped for the Delivery API, written in content files or offered by
the CLI. Its value is a block value with one layout entry under
`Umbraco.SingleBlock`.

## Decisions

- 2026-11-05: the server side now, against Umbraco 19's shape; the editing UI
  with the move to Umbraco 19 (story `277`).
- 2026-11-05: Single Block support is part of this story.
- Following Umbraco, not asked: a shared block's text is indexed with the page;
  an unpublished element is left out of the published page; a shared block's
  settings stay local to the page.

## Plan

1. **One reader for block values** (`packages/core`): walks a value's layout,
   grid areas included, for every block editor, Single Block among them, and
   rich text's `blocks`, giving each entry its layout key, and whether its
   content is local (`contentData`) or a Library element (its key). Rendering,
   the Delivery API, search, content files, the CLI and the importer all use
   it, instead of each reading `layout` themselves.
2. **Saving.** A shared entry needs no `contentData`. Saving refuses one whose
   element does not exist, is in the recycle bin, or is of a type the editor's
   blocks do not allow, in the same problem shape as a local block's errors.
   Settings are validated as now. An entry without a layout `key` is accepted
   and given one.
3. **Rendering** (`values.ts`, `blocks.ts`): a shared entry resolves through
   `context.element`, published or in preview, and drops out when there is
   nothing to show. Each `BlockItem` says which it is (`library: true`, the
   element's key), so a template can tell, and `<Blocks>` renders either with
   the element type's block component. The Single Block reads as one
   `BlockItem` or `null`, and `<Blocks>` takes it too. `crombolo generate`
   types it.
4. **Caching.** Check that publishing or unpublishing an element changes the
   ETags of pages using it (stories `258`, `259`), as the Element Picker's
   pages are refreshed today.
5. **Delivery API** (`packages/api-delivery/src/output.ts`): a shared block is
   output in the same shape as a local one, from the element's published
   values, and `expand` and `fields` apply to it. The Single Block outputs as
   one item. `crombolo generate --delivery` types both.
6. **Search** (`packages/data/src/search-text.ts`): a page's text includes
   its shared blocks' elements, and publishing an element queues the pages that
   use it for reindexing.
7. **Content files and bundles**: a shared block is written `{ library:
   "<Library path>", settings: { … } }` beside local blocks
   (`server/src/seed/`), and `bundle export --source` writes it back that way.
   Exporting a page takes the elements it uses with it, as for the Element
   Picker. The Single Block is written as one block rather than a list.
8. **The CLI**: `content block add --library <path>` adds a shared block;
   `content block show` (or the page's `show`) marks shared blocks and names
   their element; `content block update` on a shared block's values refuses
   with "edit the Library element", and `content block move` and `remove`
   work on either kind. The Single Block takes `add` (replacing the one
   there), `update` and `remove`.
9. **The Umbraco importer**: shared blocks from an Umbraco 19 site are
   imported with their elements; earlier versions have none. Single Block
   values import as they are.
10. **Copying** a page leaves a shared block's `contentKey` alone wherever
    block keys are renewed.

## Acceptance criteria

- [ ] A Block List, Block Grid (inside areas too), Single Block and rich text
      value may hold shared blocks beside local ones, in Umbraco 19's shape,
      and saves without `contentData` for them.
- [ ] Saving refuses a shared block whose element is missing, trashed or of a
      type the editor does not allow; a value without layout keys still saves.
- [ ] A page renders a shared block with the element's published values in
      the page's culture, and leaves it out while the element is unpublished
      there; preview shows the element's draft.
- [ ] Publishing or unpublishing the element changes every page using it, and
      their ETags, without touching the pages.
- [ ] The Delivery API outputs shared blocks as it does local ones, with
      `expand` and `fields`.
- [ ] A page is found by search for its shared blocks' text, and publishing the
      element reindexes it.
- [ ] The element reports what uses it, and its deletion warns, as now.
- [ ] The Single Block renders, is typed by both `crombolo generate` modes, is
      output by the Delivery API, and is written in content files and by the
      CLI.
- [ ] Content files, `bundle export --source`, bundles and the Umbraco
      importer carry shared blocks and the elements they use.
- [ ] The CLI adds, shows, moves and removes shared blocks, and refuses to
      edit their values.
- [ ] `docs/rendering.md` ("Blocks"), `docs/delivery-api.md`,
      `docs/bundles.md` ("Content files") and `docs/cli/` describe both.
- [ ] Tests on both engines.

## Out of scope

- The editing UI: inserting from the Library, "Transfer to Library",
  "Disconnect from Library" and the reference colour come with Umbraco 19's
  client (story `277`), which calls the endpoints that exist.
