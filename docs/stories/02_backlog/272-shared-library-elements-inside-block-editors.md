# 272 — Shared Library elements inside block editors

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 027, 277, 345

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
on 18.2.0, so this comes after the move to Umbraco 19 (story `277`), whose
client brings the editing UI; this story makes the server take what it saves,
and checks it end to end. The Single Block, once part of this story, is story
`345`, before it; its one list of block editors and one reader of block values
are what this extends.

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

**What we already have, checked 2026-11-13.**
- The Library (story `027`) and its published cache, which the Element Picker reads
  (`context.element`, set in the cache's own view, `published-cache.ts`).
- References are found by scanning stored values for keys
  (`packages/data/src/repositories/references.ts`), so "used by", "referenced by N items"
  and the recycle bin's warnings count a shared block without change.
- ETags rest on the published checkpoint (`validatorBasis`), so publishing anything,
  an element included, already changes every page's ETag.
- Copying a page copies its values as they are; nothing renews block keys.

**What we do not have.**
- **No validation inside a block value.** Saving checks top-level properties only; the
  one block check, a duplicate alias, is refused as plain text
  (`content/src/operations.ts`).
- **No element in preview.** Preview's value context (`valueContext()`,
  `published-cache.ts`) has no `element`, so an Element Picker shows nothing in preview
  today.
- **No reindexing of pages for an element.** Publishing an element queues only the
  element for search.

## Decisions

- 2026-11-05: the server side now, against Umbraco 19's shape; the editing UI
  with the move to Umbraco 19 (story `277`). Changed 2026-11-13: after the move.
- 2026-11-05: Single Block support is part of this story. Changed 2026-11-13: split
  out as story `345`, to come first.
- Following Umbraco, not asked: a shared block's text is indexed with the page;
  an unpublished element is left out of the published page; a shared block's
  settings stay local to the page.
- 2026-11-13: exporting a page lists the elements its shared blocks use as expected
  dependencies, as it does an Element Picker's, rather than carrying them; the Library
  is exported with `library` or `--all`.
- 2026-11-13: importing from Umbraco is no longer this repository's (the importer left
  it), so it is not part of this story.

## Plan

1. **The reader** (story `345`'s, in `packages/core`) gives each entry its layout `key`
   (derived from `contentKey` when absent, as Umbraco does) and whether its content is
   local (`contentData`) or a Library element (`isExternalContent`, its key), for every
   block editor, Single Block among them, and rich text.
2. **Saving shared entries** (`content/src/operations.ts`, beside the alias check): a
   shared entry needs no `contentData`. Saving refuses one whose element does not
   exist, is in the recycle bin, or is of a type the editor's blocks do not allow, as a
   `validationProblem` whose path reaches into the value; this is the first validation
   inside a block value. Settings are validated as now. An entry without a layout `key`
   is given one.
3. **Rendering** (`values.ts`, `blocks.ts`): `BlockItem` gains `key` and `library` (the
   element's key, or absent); a shared entry resolves through `context.element` and
   drops out when the element is not published in the culture shown. **Preview gains an
   element lookup over drafts**, which an Element Picker in preview needs too. Check
   which key Umbraco 19 writes into rich text's markup for a shared block, since the
   Delivery API matches rich text blocks by `data-content-key`.
4. **Delivery API** (`output.ts`): follows from 3, with `expand` and `fields`.
5. **Search:** a page's text includes its shared blocks' elements, through an element
   text lookup passed to the text builder; publishing an element queues the pages that
   reference it (`ReferenceRepository`'s referencing ids, as dictionary words are
   queued), which reindexes an Element Picker's pages too.
6. **Content files:** a shared block is written `{ library: "<Library path>", settings:
   { … } }` beside local blocks (`server/src/seed/values.ts`), and `content export`
   writes it back that way, listing the element as an expected dependency.
7. **The CLI:** `content block add --library <path>` adds a shared block; `content block
   show` marks shared blocks and names their element; `content block update` on one
   refuses with "edit the Library element"; `move` and `remove` work on either kind.
8. **The back office, end to end** on 19's client: inserting from the Library's tab,
   "Transfer to Library", "Disconnect from Library", editing in place and the publish
   state on the block, against the endpoints above.
9. **Held by tests, unchanged:** publishing or unpublishing an element changes the
   ETags of pages using it, and copying a page keeps a shared block's `contentKey`.

## Acceptance criteria

- [ ] A Block List, Block Grid (inside areas too), Single Block and rich text value may
      hold shared blocks beside local ones, in Umbraco 19's shape, and saves without
      `contentData` for them.
- [ ] Saving refuses a shared block whose element is missing, trashed or of a type the
      editor does not allow, naming where in the value; a value without layout keys
      still saves.
- [ ] A page renders a shared block with the element's published values in the page's
      culture, and leaves it out while the element is unpublished there; preview shows
      the element's draft, and so does an Element Picker.
- [ ] Publishing or unpublishing the element changes every page using it, and their
      ETags, without touching the pages.
- [ ] The Delivery API outputs shared blocks as it does local ones, with `expand` and
      `fields`.
- [ ] A page is found by search for its shared blocks' text, and publishing the element
      reindexes it.
- [ ] The element reports what uses it, and its deletion warns, as now.
- [ ] Content files and `content export` carry shared blocks, and list the elements they
      use as expected dependencies.
- [ ] The CLI adds, shows, moves and removes shared blocks, and refuses to edit their
      values.
- [ ] Shared Library elements work end to end in the back office: inserting from the
      Library's tab, "Transfer to Library", "Disconnect from Library", editing in place,
      and the publish state on the block, in a Block List, Block Grid, Single Block and
      rich text.
- [ ] `docs/rendering.md` ("Blocks"), `docs/delivery-api.md`, `docs/bundles.md`
      ("Content files") and `docs/cli/` describe them.
- [ ] Tests on both engines.
