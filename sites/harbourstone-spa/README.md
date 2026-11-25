# Harbourstone Distillery (single-page app)

The Harbourstone distillery as a single-page app in `web/`. Made with [Crombolo](https://github.com/kineco-au/crombolo-cms), from its `demo/harbourstone-spa` template.

## What it is for

A demonstration of an app that reads a Crombolo site in the browser. Harbourstone is fictitious: the company, its whisky and its words are invented.

## What is in it

- the same content as the Harbourstone template, with a members' cellar only members see
- every page read in the browser, so a change shows as soon as it is published
- members signing in from the app, and drafts shown by the Preview button
- a contact form, and redirects

## Run it

```sh
bun install
bun run dev
```

The back office is at <http://localhost:8080/crombolo>, and the start prints how to sign in.

To host the app, `cd web && bun run build` writes it to `web/out`, for any static host that answers an unknown address with `index.html`.

## Folders

```text
├── components/         the views that draw the site
│   ├── blocks/         one for each type of block
│   └── pages/          one for each type of page
├── content/            the starting content, as files
│   ├── library/        shared content
│   ├── media/          pictures, each with a file describing it
│   └── pages/          pages, in folders as the site's tree is
├── css/                stylesheets
├── public/             files served as they are
├── schema/             what the site can hold
│   ├── content-types/  types of page, block and Library item
│   ├── data-types/     the editors fields use
│   ├── forms/          forms and their fields
│   ├── media-types/    types of media
│   ├── member-types/   types of member
│   ├── workflows/      approvals
│   └── schema.toml     the version of these definitions
├── scripts/            scripts for the browser
├── web/                the front end
│   ├── app/            its pages and routes
│   ├── components/     its components
│   └── lib/            how it reads the site
├── .env                secrets and local settings: never commit it
├── .gitignore          what git leaves out
├── AGENTS.md           a guide for coding agents
├── README.md           this file
├── crombolo.config.ts  the site's settings
├── dev.ts              starts the site and the front end together
├── members.ts          makes the Members page members-only
├── package.json        packages and scripts
├── serve.ts            serves the built app
├── server.ts           starts the site for development
└── tsconfig.json       TypeScript settings
```

The first start adds the database, unless it is on Postgres, with `media/`, `logs/` and `.crombolo/`. Git leaves them out.

## Where to look first

`web/components/app.tsx` turns the address into a page.

## Credits

Where its pictures come from: https://github.com/kineco-au/crombolo-cms/blob/main/sites/harbourstone-spa/CREDITS.md
