## What is in it

- an empty site: no types or pages yet;
- a Next.js app in `web/`, wired to the CMS for preview, cache revalidation when a page is published, and member sign-in.

## Where to look first

Add a type and a page from the command line ([A site from the command line](/docs/getting-started/from-the-command-line/)), then render it in `web/app/`. The app reads the site through the Delivery API with `@crombolo/delivery-client`.
