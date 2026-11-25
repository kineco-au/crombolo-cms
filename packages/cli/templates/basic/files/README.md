# Basic

One type of page and one page. Made with [Crombolo](https://github.com/kineco-au/crombolo-cms), from its `basic` template.

## What it is for

A starting point for a site of your own: what `crombolo init` makes when no template is named.

## What is in it

- a type of page with a title, an image and a description
- a home page welcoming you to Crombolo

## Run it

```sh
bun install
bun start
```

The back office is at <http://localhost:8080/crombolo>, and the start prints how to sign in.

## Folders

```text
├── actions/            code the pages call on the server
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
│   ├── workflows/      approvals
│   └── schema.toml     the version of these definitions
├── scripts/            scripts for the browser
├── .env                secrets and local settings: never commit it
├── .gitignore          what git leaves out
├── AGENTS.md           a guide for coding agents
├── README.md           this file
├── crombolo.config.ts  the site's settings
├── package.json        packages and scripts
├── server.ts           starts the site for development
└── tsconfig.json       TypeScript settings
```

The first start adds the database, unless it is on Postgres, with `media/`, `logs/` and `.crombolo/`. Git leaves them out.

## Where to look first

Open `components/contentPage.tsx` and change what the page shows.
