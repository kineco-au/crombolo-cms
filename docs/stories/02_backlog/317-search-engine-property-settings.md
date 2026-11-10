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
"Where each value comes from", listing each value and its source: the page's own
fields, the page design (a template's `generateMetadata`), a site setting (Settings
→ Search), the page name, or nothing. The sources are fixed by convention: an
administrator can read them here, and change none of them.

The form designer already offers `{alias}` for a field's value and `{#key}` for a
dictionary word, suggested at the cursor as they are typed (story 297).

## Decisions (2026-11-10)

- **This page, or every page of its type, asked each time.** Saving a mapping
  asks whether it applies to this page only, or to every page of its content
  type. A page's own mapping wins over its type's.

## The design

- **The card** is "Searchable property values" (renamed in 0.57.0).
- **Each value is editable** by an administrator: the title, the description, the
  sharing image and the preferred address. A value is one of:
  - **a fixed value**, typed in;
  - **a page property**, written `{alias}`, suggested from the page's type's
    properties as it is typed;
  - **a dictionary word**, written `{#key}`, suggested from the dictionary as it is
    typed.
  Text may mix them: `{heading} | {#site.name}`. The sharing image takes one
  property, of a media picker, or a fixed media item.
- **Saving asks** "This page only" or "Every <type> page", and says which pages
  that changes.
- **The order a value is taken in:** the page's own mapping, its type's mapping,
  then what decides it today (the page design, the site setting, the page name).
  The card says which of these each value came from.
- **Editors** see the card as now, read-only.

## Open questions

- **Where a type's mapping is kept.** Proposed: in the content type's schema file,
  so it is reviewed and deployed with the content model; editable here in
  development, and shown read-only in production, saying it changes with a
  deploy, as types are. The alternative is the database, editable anywhere at once
  but set up per environment.
- **Where a page's own mapping is kept.** Proposed: with the page, as part of its
  content, so it is versioned, previewed and published with it.

## Acceptance criteria

- [ ] The card "Searchable property values" lets an administrator
      edit each value; an editor cannot.
- [ ] A value is a fixed value, `{alias}` or `{#key}`, or a mix, with page
      properties and dictionary words suggested as they are typed.
- [ ] Saving asks for this page or every page of its type, and the rendered page's
      metadata follows it, a page's own mapping winning over its type's.
- [ ] The card says where each value came from.
- [ ] A browser test sets a type's title mapping from one page and sees it on
      another page of that type.
