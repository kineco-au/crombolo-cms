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

## Decisions before implementation

- **How an app asks for it.**
  - **A. A site setting, `deliveryApi.richTextOutputAsJson`**, as Umbraco's
    `RichTextOutputAsJson`. Every rich-text value is answered as JSON. The
    output matches Umbraco's, so Umbraco clients work unchanged.
  - **B. Per request**, through a header or query parameter
    (`Accept-RichText: json`), so one site serves both an HTML app and a
    JSON one.

  Recommended: A as the setting, plus B as a Crombolo extension. An app can
  then opt in without the site changing for everyone. It is noted in
  `docs/delivery-api.md` as not in Umbraco.
- **Generated types.** Recommended: `crombolo generate` and
  `@crombolo/delivery-client` type the tree (`RichTextElement`, a union of
  the root, generic and text elements). Rich-text properties are typed by
  the output the site is set to.

## Acceptance criteria

- [ ] Resolved links in rich-text markup carry Umbraco's `data-*` attributes
      (`data-destination-id`, `data-destination-type`, `data-link-type`,
      `data-start-item-path`, `data-start-item-id`), and `type` is removed, as
      `ApiRichTextMarkupParser` does.
- [ ] With JSON output on, each rich-text value is the tree above, or `null`
      when empty. That includes rich text inside blocks and expanded items.
      `blocks` is the same list as the HTML form.
- [ ] Content links, media links, images, block elements, `data-*` renaming,
      and the dropping of comments and blank text match Umbraco's
      `RichTextParserTests` cases. Those cases are ported as fixtures.
- [ ] Nested elements carry the `$type` discriminators Umbraco's serialiser
      writes, and the root does not.
- [ ] Output is chosen as decided above, and the Delivery API's OpenAPI
      document and contract tests describe both forms.
- [ ] `@crombolo/delivery-client` exports the tree's types and a small
      `walkRichText(tree, visitors)` helper. The generated content types use
      them for rich-text properties.
- [ ] Story 208's `<RichText>` renders the tree when it is given one, with a
      `components` map per tag and per block, and keeps rendering the HTML
      when it is not.
- [ ] `docs/delivery-api.md` drops "not built" for both, and documents the
      tree, the setting and any per-request switch. Unit tests cover parsing,
      links, media, blocks, the switch and the client helper.
