# Starter

A header, a footer and a two-column page layout. Made with [Crombolo](https://github.com/kineco-au/crombolo-cms), from its `starter` template.

## What it is for

A starting point for a site of your own rather than a demonstration. Its text is placeholder text to replace.

## What is in it

- a type of page, and a search page
- a home page, with About, Contact and Search below it

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
│   ├── blocks/         one for each type of block
│   ├── pages/          one for each type of page
│   └── shared/         the parts pages share
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

Restyle the colours, the page title (`page-title`) and the rich text (`prose-site`) in `css/tailwind.css` and the Tailwind classes in `components/`, then replace the text in the back office.
