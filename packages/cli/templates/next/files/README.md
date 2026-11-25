# Next.js

An empty site with a Next.js front end in `web/`. Made with [Crombolo](https://github.com/kineco-au/crombolo-cms), from its `next` template.

## What it is for

A starting point for a site of your own drawn by Next.js.

## What is in it

- no types or pages yet
- a Next.js app with preview, a cache cleared when a page is published, and member sign-in

## Run it

```sh
bun install
bun run dev
```

The back office is at <http://localhost:8080/crombolo>, and the start prints how to sign in.

## Folders

```text
├── components/         the views that draw the site
│   └── blocks/         one for each type of block
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
│   ├── webhooks/       calls made when something is published
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
├── package.json        packages and scripts
├── server.ts           starts the site for development
└── tsconfig.json       TypeScript settings
```

The first start adds the database, unless it is on Postgres, with `media/`, `logs/` and `.crombolo/`. Git leaves them out.

## Where to look first

Add a type and a page with `bunx crombolo types new` and `bunx crombolo content new`, then draw it in `web/app/`.
