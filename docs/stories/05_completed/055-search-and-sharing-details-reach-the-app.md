# 055 — Search and sharing details reach the app

**Epic:** F — Headless · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As a front-end developer, I want each page's title, description, sharing image
and indexing rules from the API, worked out as the rendered site works them out,
so that my app's head tags match what the editors set.

## Context

`effectiveMeta(content, context, overrides)` is the one place the per-page
fields and the site-wide defaults are combined
([`seo.md`](../../seo.md)): the title suffix, the fallback description, the site
sharing image, the preferred address, hide from search engines. `<SeoHead>` and
the sitemap read it; the Delivery API only returns the raw `seo*` properties,
so every app has to reimplement the fallbacks and the site defaults it cannot
see.

`/sitemap.xml` and `/robots.txt` list the CMS's own hostnames, which are wrong
when the public site is an app on another host.

## Acceptance criteria

- [x] An item can include its worked-out search and sharing details (on request,
      for example `fields=seo` or a parameter, so default answers do not grow):
      title, description, sharing image URL and size, canonical URL, and robots
      directives
- [x] The answers match what `<SeoHead>` renders for the same page, tested side
      by side
- [x] A site can set its public base URL, used for canonical URLs, the sitemap
      and `robots.txt` when the site is served by an app
- [x] The sitemap can be read as JSON from the Delivery API, so an app can serve
      its own
- [x] Documented in `delivery-api.md` and `seo.md`

## What was built

- **Details.** `SeoHost.details(content, request)` in `packages/server/src/seo.ts`:
  `effectiveMeta` with the site defaults, the page's language versions
  (`urlsIn`) and the public origin, shaped for an app; image sizes from the
  media item when there is one. The Delivery API adds them in its one `respond`
  when `seo=true`, through a new `seo` port, so every content answer gets them.
- *Decision:* a query parameter, not `fields=seo` — `fields` is Umbraco's grammar
  for properties, and folding another meaning into it would make the vendored
  contract's parser lie.
- **The public address**, `seo.publicUrl` / `CROMBOLO_PUBLIC_URL`, in config
  only — it is a fact about the deployment, like `applicationUrl`, not a setting
  an editor changes. `publicOrigin` uses it for preferred addresses, the sitemap,
  `robots.txt`, the backoffice preview and the origin rendered pages are given;
  `originOf` stays for sign-in.
- **The sitemap as data**, `GET v2/sitemap`, from `SeoHost.sitemapItems`, which
  shares `/sitemap.xml`'s entries (`openEntries`) and its on/off rules.
- Tests: `tests/delivery-seo.test.ts` (side by side with a rendered
  `<SeoHead>`, only when asked, the public address in all three places, the
  sitemap as data and off); the setting in `tests/config-env.test.ts`.
