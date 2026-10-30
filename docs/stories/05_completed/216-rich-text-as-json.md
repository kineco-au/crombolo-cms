# 216 — Rich text as JSON

**Epic:** F — Headless · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer rendering Crombolo content in an app (a Next.js front end,
208, or any other), I want rich text as a tree of elements rather than an HTML
string. Then I can render each tag with my own component: a link as the
framework's router link, an image through its image component, a heading in
the design system, a block in place. I don't need inner HTML or an HTML parser
in my app.

## Context

The Delivery API answers a rich-text property as `{ markup, blocks }`
(`docs/delivery-api.md`). Links in the markup are resolved to this site's
URLs, and blocks are placeholders keyed by content id. Two of Umbraco's
behaviours are not built:
- **The `data-*` link attributes** Umbraco adds to resolved links:
  `data-destination-id`, `data-destination-type`, `data-link-type` and the
  start-item pair. Without them an app cannot tell an internal link from an
  external one, except by its address.
- **`RichTextOutputAsJson`**, Umbraco's switch that answers rich text as a
  JSON tree instead.

Umbraco's behaviour is recorded in
`docs/stories/05_completed/050-research/output-and-queries.md`, "Rich text:
HTML markup processing" and "Rich text: JSON tree format". The reference is
`ApiRichTextElementParser` and its tests.

Story 208 renders the HTML for now: `<RichText>` sets it as inner HTML and
makes internal links client-side navigations. This story lets it, and any
app, render the tree instead.

## The design

The root:

```json
{
  "tag": "#root",
  "attributes": {},
  "elements": [
    { "tag": "p", "attributes": {}, "elements": [
      { "tag": "#text", "text": "Read " },
      { "tag": "a", "attributes": {
          "destinationId": "eed5fc6b-…", "destinationType": "expression",
          "linkType": "Content", "route": { "path": "/whisky/twelve/", "startItem": { … } }
        },
        "elements": [{ "tag": "#text", "text": "the twelve" }] }
    ] },
    { "tag": "umb-rte-block", "attributes": { "content-id": "…" }, "elements": [] }
  ],
  "blocks": [ /* ApiBlockItem, as today */ ]
}
```

Elements, as Umbraco writes them:
- **Content:** comments are dropped, and so are text nodes that are empty or
  only newlines, except whitespace between inline elements.
- **`data-*` attributes** lose their prefix, unless an attribute of that name
  already exists.
- **A content link** loses `href` and gains `destinationId`,
  `destinationType`, `linkType: "Content"` and a `route` object. Its culture
  comes from `data-culture`.
- **A media link** has `href` set to the media URL, plus `destinationId`,
  `destinationType` and `linkType: "Media"`.
- **An image** with a media reference gets its media URL, keeping crop
  parameters.
- **A block element** carries `content-id`.

## Decisions (2026-10-30)

1. **JSON only: rich text is always the tree.** The Delivery API answers every
   rich-text value as the tree above, inside blocks and expanded items too, or
   `null` when empty. There is no site setting and no per-request switch, and
   the `{ markup, blocks }` HTML form is removed rather than kept beside it.
   - The `data-*` link attributes are not added to markup, because there is no
     markup: the tree's `destinationId`, `destinationType`, `linkType` and
     `route` carry what they would have.
   - Story 208's `<RichText>` renders the tree, with a component per tag and
     per block; the inner-HTML rendering goes.
   - A breaking change for Delivery API clients that read `markup`, including
     clients written for Umbraco's default output: the release notes carry an
     upgrade note, and `docs/delivery-api.md` says the tree is Umbraco's
     `RichTextOutputAsJson` form, always on.
   - Not chosen: Umbraco's site setting, a per-request switch, or both, which
     would keep two forms to build, test and document.

2. **One set of tree types, used everywhere.** `@crombolo/delivery-client`
   exports `RichTextElement`, a union of the root, the generic tag element and
   the text element, with the attributes of `a` (`destinationId`,
   `destinationType`, `linkType`, `route`), `img` (its media URL) and
   `umb-rte-block` (`content-id`) typed where they are known; and
   `RichTextValue`, the root with its `blocks`. `crombolo generate` types each
   rich-text property as `RichTextValue | null`, and `walkRichText(tree,
   visitors)` takes the same types. Not chosen: a loose
   `{ tag, attributes, elements }`, which leaves an app to tell a link from a
   block by hand.

## Acceptance criteria

- [x] Each rich-text value is the tree above, or `null` when empty, including
      rich text inside blocks and expanded items; the HTML form is gone.
- [x] Content links, media links, images, block elements, `data-*` renaming,
      and the dropping of comments and blank text match Umbraco's
      `RichTextParserTests` cases. Those cases are ported as fixtures.
- [x] Nested elements carry the `$type` discriminators Umbraco's serialiser
      writes, and the root does not.
- [x] The Delivery API's OpenAPI document and contract tests describe the
      tree as the only form.
- [x] `@crombolo/delivery-client` exports `RichTextElement` and
      `RichTextValue`, with the known tags' attributes typed, and a small
      `walkRichText(tree, visitors)` helper; `crombolo generate` types each
      rich-text property as `RichTextValue | null`.
- [x] Story 208's `<RichText>` renders the tree, with a `components` map per
      tag and per block; the inner-HTML rendering is removed.
- [x] `docs/delivery-api.md` documents the tree as the only form, and the
      release notes carry the upgrade note. Unit tests cover parsing, links,
      media, blocks and the client helper.

## What was built

- **The tree** (`packages/api-delivery/src/rich-text.ts`): a forgiving parser of
  the stored markup, and `richTextTree`, which writes Umbraco's tree from it.
  Media that links and images name is looked up together, through the Delivery
  API's media port. `output.ts` writes every rich-text value this way, inside
  blocks and expanded items too; `RichTextValue` in `@crombolo/render` carries
  the value's converted blocks to it.
- **The contract:** `DELIVERY_CONTRACT_ADDITIONS` (`packages/contracts`) adds
  `RichTextRootElement`, `RichTextGenericElement` and `RichTextTextElement` when
  the contract is loaded. `DeliveryApi.json` stays exactly Umbraco's.
- **The client:** `@crombolo/delivery-client` exports `RichTextValue`,
  `RichTextElement`, `RichTextGenericElement`, `RichTextTextElement`, the
  attributes of `a`, `img` and the block tags, `walkRichText` and
  `decodeEntities`. `ApiRichText` is gone. `crombolo generate --delivery`
  writes `RichTextValue | null`.
- **`<RichText>`** (`@crombolo/next-integration/components`): renders the tree
  with `components` per tag and `blocks` per element type. A link to a page is
  a `next/link` to its route, entities are decoded, `class`, `style` and the
  like become React's props, and attributes that are event handlers are
  dropped. The inner-HTML rendering and the client-side `RichTextLinks` are
  removed. Harbourstone's Next app uses `RichTextValue`.
- **Tests:**
  - `tests/rich-text-tree.test.ts`: Umbraco's `RichTextParserTests` cases,
    ported.
  - `tests/delivery-api.test.ts`: the tree over HTTP, with a page link and a
    media image.
  - `tests/delivery-contract.test.ts`: the added schemas, with a written tree
    checked against them.
  - `tests/next-rich-text.test.tsx`: `walkRichText`, `decodeEntities` and
    `<RichText>`.
  - `tests/delivery-types.test.ts`: the generated type.
