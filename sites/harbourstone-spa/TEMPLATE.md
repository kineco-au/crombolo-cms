## What is in it

- the same Harbourstone content as the distillery template, with a members' cellar only members see;
- a single-page app in `web/`, built with Next.js as static files: every page is read from the site in the browser, so a change shows as soon as it is published, with no rebuild;
- members signing in from the app, drafts shown by the Preview button, and the contact form posted straight to the site;
- the simple redirects bundle.

## Where to look first

`web/components/app.tsx` turns the address into a page. The site itself draws only the page members sign in on, in `components/`. `bun run members` makes the Members page members-only, and `bun run dev` runs it for you; add a member in the back office's Members section, in the Members group, to sign in as.

To host the app, `cd web && bun run build` writes it to `web/out`: put that folder on any static host that answers an address with no file of its own with `index.html`, as `bun serve.ts` does. Search engines see only what runs JavaScript, so a site that needs them is better served by the Next.js version, `demo/harbourstone-next`.
