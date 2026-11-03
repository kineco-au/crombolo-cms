## What is in it

- the same Harbourstone content as the distillery template;
- a Next.js front end in `web/`: drafts shown in Draft Mode, the cache cleared by a webhook when a page is published, and a comparison of bottlings chosen in the browser;
- the simple redirects bundle.

## Where to look first

`web/app/` renders the pages through the Delivery API. The CMS keeps its own views in `components/`, so you can compare the two ways of rendering one site.
