# 290 — A starter site that shows what the CMS does

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As someone trying Crombolo for the first time, I want a full starter site with real content,
so that I can see the common features working together, and take it apart to learn from it.

## Context

`sites/starter` is a header, a footer and a two-column page with placeholder text.
`sites/harbourstone` and `sites/plain-signal` are themed demos with a fictional business and
magazine. Nothing shows the everyday features of a CMS together, with content about the
product itself, as Umbraco's starter kit does for Umbraco.

## Decisions (2026-11-07)

- **Our own site, in the same spirit:** similar feature usage, and original text, design,
  images and code. Nothing is copied, and nothing names Umbraco, Codegarden or its community.
- **Its content is about Crombolo:** its features, its blog and the people behind it.
- **It is a new site under `sites/`,** shipped with the CLI. `sites/starter` stays as the
  blank one to restyle.

## Acceptance criteria

- [x] `crombolo init --template` offers it, and it starts with its content published.
- [x] A home page built from blocks, with a hero, feature rows and calls to action.
- [x] A products or features listing, filtered by category, with a page for each.
- [x] A people page, from Library elements.
- [x] A blog with a paged list, tags and a page for each post.
- [x] A contact page with a working form.
- [x] An about page, a site search, navigation from a menu, a footer and site-wide settings.
- [x] Search and sharing details, and a sitemap, set up as a real site would have them.
- [x] Translated into a second language, to show culture variants.
- [x] Images are openly licensed (CC0), listed in `CREDITS.md`.
- [x] No text, name, link or asset mentions Umbraco's events or community.
- [x] Covering tests, as for the other sites, and `TEMPLATE.md` says where to look first.

## Findings (2026-11-07)

- **Most of it is already in the CMS.** Blocks, Library elements, `search()`, `menu()`,
  site settings, forms, `seoFields`, the sitemap and the dictionary all work today, and
  each is used by at least one demo. The site is mainly schema, views, styles and content.
- **Paging and filtering are the view's job.** `search()` takes `skip` and `take`, but a list
  of pages reads `nav.children` and slices it. That is fine at this size and is the same
  pattern a reader would copy.
- **There is no "pages with this tag" read.** The `tags.list` port only lists tags. The blog
  filters its posts on their `tags` value, in the view. No CMS change.
- **No site uses a second language yet.** No site has `schema/languages.toml`, so this is the
  first time variants, a translated dictionary and translated menus run together end to end.
  Expect to find gaps. Form labels in particular have not been checked.
- **A second language needs an address.** A varying page with no hostname for its culture has
  the URL `#`. Domains can carry a path (`example.com/es`), but no test covers one on the same
  page as the default culture, and links come out as `//host/es/...`.
- **`domains.toml` does not ship in a template** (`TEMPLATE_FILES` leaves it out), and a
  `${SITE_HOST}` that is not set leaves the hostname unbound.
- **The product site is not this site.** It has no images, is not distributed and is mostly a
  developer guide. Its Library text is a good source for feature copy; its views are not reused.
- **There are no images to reuse,** and no image tool on this machine beyond `sips`. The
  browser test container can turn drawn SVG into JPEG, which keeps crops and focal points.
- **`crombolo-sitemigration-sources` was not read,** and is not needed: AGENTS.md rules it out,
  and the acceptance criteria already give the feature list.

## What was built (2026-11-07)

- **`sites/crombolo-demo`, id `demo/crombolo`:** 23 pages, five people, a menu, nine CC0
  photographs, two forms and a dictionary, each in English and Spanish, covered by
  `tests/crombolo-demo.test.ts`.
- **The product site is `product/crombolo`.** Its bundle keeps the name `demo-crombolo`
  through `"bundle"` in `site.json`, so nothing changes for the hosted tenant. That replaced
  moving the bundle, because what the platform expects of the name can't be checked from here.
- **A path alone can be a hostname:** `host = "/es"` answers on every hostname and port. This
  replaced setting a host at `init`, which would also have broken on any port but the default.
  `domains.toml` now ships with a template.
- **A CMS bug fixed:** a Library element always read its default-language values.
- **Still single-language:** `seoFields` does not vary by culture, so the site passes a
  description to `<SeoHead>` from fields that do. A form has one set of labels, so each
  language has its own form. `[values]` does not mean the default language for a property
  that varies: those values go under `[values.en-US]`.

## Plan

1. **Rename the product site:** its id in `site.json`, `scripts/build-template.ts`,
   `tests/sites.test.ts` and the docs that name it. Nothing may read `demo/crombolo` as the
   product site after this. Its bundle moves with the id, so check what the hosted tenant
   expects from `bun run brochureware:publish --dry-run` before this lands.
2. **Prove the second language next,** with a small test before any content: one page in two
   cultures at `/` and `/es`, a translated dictionary item, a menu and a form. Fix what fails.
3. **Ship the addresses,** as decided below: `domains.toml` carried by a template, and a
   host that works on a fresh `init`.
4. **The site:** `sites/crombolo-demo/` with `site.json` (`"distribute": true`), `TEMPLATE.md` and
   `CREDITS.md`, and these types:
   - `homePage`, with hero, feature row, call to action and quote blocks
   - `featureList` and `feature`, with a category; `?category=` filters
   - `peoplePage`, showing `person` elements from the Library
   - `blogList` and `blogPost`, with tags and an author; `?page=` and `?tag=`
   - `contactPage`, `contentPage` for About, `searchPage` and `siteSettings`
5. **Views and styles:** one layout, a header from `menu('main')`, a footer from site settings,
   a language switcher, `<SeoHead>` on every page, and a design of its own.
6. **Content:** about 25 pages about Crombolo, then translated, with dictionary items for the
   words the views print. The product site's Library text is the starting point for features.
7. **Images,** as decided below, each with a row in `CREDITS.md`.
8. **Tests:** `tests/crombolo-demo.test.ts`, booted from the site as `tests/plain-signal.test.ts` is:
   each page type answers, filtering and paging, tag pages, search in both languages, the form
   posts, `/es` pages, `hreflang`, the sitemap, and a check that no text names Umbraco's events
   or community. `tests/sites.test.ts` gains the id.
9. **Docs:** `README.md`'s template list, `docs/features.md`, release notes.

No migration is expected. Step 1 could turn up CMS fixes, which would ship with this story.

## Decisions for the build (2026-11-07)

- **The second language (decided 2026-11-07):** Spanish, `es-ES`, at `/es` on the same host.
- **Its name (decided 2026-11-07):** `demo/crombolo`, in `sites/crombolo-demo`. The product
  site gives the id up and becomes `product/crombolo`, staying in `sites/crombolo`, so paths
  that name that folder don't change.
- **Images (decided 2026-11-07):** openly licensed photographs, as Plain Signal's are, each
  with its source and licence in `CREDITS.md`.
- **People:** invented, so no photograph of a real person stands in for one. Each `person`
  has an image field, and the site's people show a monogram when it is empty, which also
  shows how a view handles a missing value.
