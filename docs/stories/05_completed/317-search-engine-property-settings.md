# 317 — An administrator sets where a page's search and sharing values come from

**Epic:** C — Content and editing · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an administrator, I want to set where a page's title, description, sharing
image and preferred address come from, from the page's Search & sharing view,
so that search results and shared links say what I choose, without a developer
changing a template.

## Context

A document's Search & sharing view (`plugin/seo/document-view.js`) shows a card,
"Searchable property values", listing each value and its source: the page's own
fields, the page design, a site setting (Settings → Search), the page name, or nothing.
The sources are fixed by convention: an administrator can read them here, and change
none of them.

`effectiveMeta` (`packages/render/src/seo.ts`) is the one place the fallbacks live, for
the page's head, the editor's view and the Delivery API's `seo=true` alike. Today's
order, highest first:
1. the template's `generateMetadata` (story 206), which wins over everything;
2. the page's own fields, from the `seoFields` composition (`seoTitle`,
   `seoDescription`, `seoImage`, `seoCanonical`);
3. the template's `<SeoHead>` props;
4. the site settings;
5. the page name (title) or its own address (preferred address).

A text value already reads `{#name}` as the dictionary's words in the page's culture
(story 297, `word` in `render/src/values.ts`). The form designer suggests `{alias}` and
`{#key}` at the cursor as they are typed (`form-word-input.js`).

Content types are schema files (`schema/content-types/*.toml`): editable in development,
read-only in production, where they change by a deploy (`schema-as-code.md`).

## Decisions (2026-11-10)

- **This page, or every page of its type, asked each time.** Saving a mapping
  asks whether it applies to this page only, or to every page of its content
  type. A page's own mapping wins over its type's.
- **A page's own mapping is its Search & sharing fields.** `seoTitle`,
  `seoDescription` and `seoCanonical` accept `{alias}` and `{#key}`, and `seoImage`
  is the page's own image. So a page's mapping is saved, versioned, previewed and
  published with the page, with no storage of its own. Anyone who may edit the page
  may set it, as they may set the fields today.
- **A type's mapping is in its schema file,** as an `[seo]` table. It is reviewed and
  deployed with the content model, editable in development, and read-only in
  production.
- **Code still wins.** The type's mapping comes after the page's own fields, and
  before the template's `<SeoHead>` props. `generateMetadata` keeps winning over
  everything: a developer who sets a value in code means it, and the card says so.
  The rejected alternative put the mapping above the code.

## The design

- **The order,** highest first:
  1. `generateMetadata`;
  2. the page's own fields;
  3. **the type's mapping**;
  4. `<SeoHead>` props;
  5. the site settings;
  6. the page name, or the page's own address.

  `MetaSource` gains `'type'`. The card names it "this type's setting".
- **A value** is any of these, or a mix such as `{heading} | {#site.name}`:
  - fixed text;
  - `{alias}`, a property of the page, read as text in the page's culture;
  - `{#key}`, a dictionary word, read in the page's culture.

  The sharing image is one media picker property's alias, or a fixed media item, and
  never text.
- **When a value is empty:** a value whose tokens all read empty counts as unset, so
  the next source answers. This applies to `{alias}` with nothing in the page, and to
  `{#key}` with no item.
  - `{{` and `}}` write a literal brace.
- **The schema file:**

  ```toml
  [seo]
  title = "{heading} | {#site.name}"
  description = "{summary}"
  image = "heroImage"            # a media picker property's alias
  canonical = ""
  ```

  - The validator refuses an `{alias}` the type (with its compositions) doesn't
    have, and an image that isn't a media picker, naming the field.
  - `crombolo types export` writes the table.
  - The Management API document type carries the mapping as Crombolo's own
    extension field, so the back office reads and writes it.
- **The card,** "Searchable property values":
  - **Administrators** may edit each value in place, through the form designer's word
    input, which suggests the page's type's properties after `{` and dictionary
    items after `{#`.
  - **Saving asks** "This page only" or "Every <type> page", and says how many
    pages the second changes.
    - **This page only** writes the page's field, as a saved draft, published as the
      page is.
    - **Every <type> page** writes the type's `[seo]` table. In production it is not
      offered: the dialog says the type's setting changes with a deploy.
  - **Each value** says which source answered. Where `generateMetadata` answered over a
    mapping, the card says the page design overrides it.
  - **Editors** see the card read-only, as now. They can still set the page's own
    fields where they edit the page.
- **The resolution is shared:**
  - **Rendering:** `effectiveMeta` resolves the mapping with the page's values and
    the dictionary in the page's culture.
  - **The preview** (`crombolo/api/seo/preview`) and the Delivery API's `seo=true`
    answer with it unchanged.
  - **The cache:** a change to a type's mapping reaches the published cache by the
    schema sync a deploy runs.
- **Docs:**
  - `seo.md`'s "Fallbacks" table gains the type's setting, and a section shows the
    `[seo]` table and the tokens.
  - `schema-as-code.md` lists `[seo]`.
  - The release notes say so.

## Acceptance criteria

- [x] A type's `[seo]` table sets its pages' title, description, sharing image and
      preferred address, with `{alias}` and `{#key}` read in the page's culture.
      `generateMetadata` and the page's own fields still win over it.
- [x] A page's own fields accept the same tokens.
- [x] A value whose tokens all read empty falls through to the next source.
- [x] The validator refuses an unknown alias, and an image that isn't a media picker.
- [x] The card lets an administrator edit each value, suggesting properties and
      dictionary items as they are typed; an editor sees it read-only.
- [x] Saving asks "This page only" or "Every <type> page", saying how many pages the
      second changes, and offers only the first in production.
- [x] The card says where each value came from, including this type's setting. The
      page design overriding it is said wherever `generateMetadata` runs (the page's
      head, the Delivery API); the card's preview doesn't run the template, so it
      can't see it (see Implementation).
- [x] The page's head, the preview and the Delivery API's `seo=true` agree.
- [x] A browser test sets a type's title mapping from one page and sees it on
      another page of that type.

## Implementation (0.58.0)

- **Storage:**
  - Migration 070, `AddContentTypeSeo`: `content_type.seo`, JSON or null.
  - `SeoMapping` and `SEO_MAPPING_FIELDS` (`@crombolo/core`), carried as
    `ContentTypeModel.seo`, where absent means unchanged.
  - `ContentTypeRepository.setSeo` and `seoMappings`.
- **Schema:**
  - `parse.ts` reads a document type's `[seo]` table; `write.ts` writes it after
    `cleanup`.
  - `sync.ts` and `export.ts` carry it.
  - `seo-mapping.ts` checks it (`seoMappingProblems`) and lists the properties it may
    name (`seoMappingProperties`).
  - A fixed image is a media item's key.
- **Tokens:** `seoTokens` and `expandSeoValue` (`core/src/seo-mapping.ts`).
  - A value naming only empty things is unset.
  - A page's own field already read `{#key}` through its text value; `{alias}` is new.
- **Rendering:**
  - `effectiveMeta` takes `site.types` (`SeoSiteDefaults.types`) and answers
    `source: 'type'` between the page and the template.
  - `withMetadata` marks a type's value it replaced with `over: 'type'`.
  - `PublishedContent.word` reads a dictionary item.
  - `createSeoHost.siteDefaults` fills `types`, a fixed image made its address,
    cached for ten seconds as the settings are.
- **API:**
  - `GET seo/preview` gains `mapping`: `canEdit` (the Settings section), the type's
    properties, its values, whether it is editable here, and its page count.
  - `PUT seo/type` saves through `ContentTypeRepository.setSeo` and the schema file
    writer, refusing 409 where the files are read-only and 400 for an unknown alias.
- **The card** (`plugin/seo/document-view.js`):
  - A Change button on each row, for an administrator, opens the value in
    `crombolo-seo-value-input` (`value-input.js`, `value-model.js`), which offers the
    properties after `{` around `crombolo-form-word-input`, which offers the
    dictionary after `{#`.
  - "This page only" sets the page's own field in the workspace and saves it.
  - "Every <type> page (n pages)" calls `PUT seo/type`.
  - The image is set for the type only, from its media pickers.
- **Not done:** the card's preview doesn't run the page's template, as before this
  story, so a value `generateMetadata` would replace shows as the type's there. It
  would need the preview to render the page.
- **Tests:**
  - `tests/seo-mapping.test.ts`: tokens, and the box's suggestions.
  - `tests/seo-meta.test.ts`: the order, the tokens, `over`.
  - `tests/schema.test.ts`: the round trip, the media type's refusal, the validator.
  - `tests/seo-server.test.ts`: saving, the file, the head, the preview, an editor,
    read-only files.
  - `tests/browser/seo-type-values.browser.ts`.
