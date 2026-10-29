# 217 — Pages only an app renders

**Epic:** F — Headless · **Priority:** could · **Size:** S
**Depends on:** 208

## Story

As a developer whose site is rendered entirely by an app (208's Next.js front
end, or any other), I want content types with no template to count as pages:
listed in the sitemap, found by site search, and offered by the Delivery API.
Then I don't keep CMS templates nobody visits just so the CMS counts the pages.

## Context

Umbraco treats a page with no template as having no address, and Crombolo
follows it in two places:
- `sitemapEntries` (`packages/render/src/sitemap.ts`) skips pages without a
  template;
- `siteEntriesFor` (`packages/data/src/site-search.ts`) indexes nothing for a
  type with none.

The route lookup and the item endpoints serve such pages already. Building
`demo/harbourstone-next` (208) found this: with the templates removed, its
sitemap was empty, so nothing was built ahead, and search found nothing. The
site keeps Harbourstone's templates for now.

## Decisions before implementation

- **What says a site is rendered by an app.** Recommended: the Delivery API on
  with `seo.publicUrl` set, as an app-served site already sets them. Or an
  explicit `pages.withoutTemplates: true`.
- **Where the setting reaches.** The search index is written by background
  jobs and by `crombolo index rebuild`. Both must see the same setting, so it
  belongs in what `SearchIndex` is constructed with.

## Acceptance criteria

- [ ] On a site an app renders, pages whose type has no template are in the
      sitemap, the Delivery API's `sitemap`, and site search, as pages with a
      template are.
- [ ] A site the CMS renders keeps Umbraco's rule.
- [ ] `docs/seo.md` and `docs/search.md` say so. Unit tests cover both kinds of
      site.
