# Crombolo

A site about Crombolo itself, in English and Spanish. Made with [Crombolo](https://github.com/kineco-au/crombolo-cms), from its `demo/crombolo` template.

## What it is for

A demonstration of the everyday features of Crombolo working together on one site, and a place to try them. The people and some of the quotes on it are invented.

## What is in it

- a home page, a page for editors and a page for developers, built from blocks
- features filtered by category, a blog with tags and paging, and search
- getting started pages, and documentation of every command and setting
- people and the menu in the Library, a dictionary, and site settings for the banner and footer
- a contact form, and a language switch on every page

## Run it

```sh
bun install
bun start
```

The back office is at <http://localhost:8080/crombolo>, and the start prints how to sign in.

## Folders

```text
├── actions/             code the pages call on the server
├── components/          the views that draw the site
│   ├── blocks/          one for each type of block
│   ├── pages/           one for each type of page
│   └── shared/          the parts pages share
├── content/             the starting content, as files
│   ├── library/         shared content
│   ├── media/           pictures, each with a file describing it
│   ├── pages/           pages, in folders as the site's tree is
│   └── dictionary.toml  the words the views print, in each language
├── css/                 tailwind.css: the theme and plugins
├── public/              files served as they are
├── schema/              what the site can hold
│   ├── content-types/   types of page, block and Library item
│   ├── data-types/      the editors fields use
│   ├── forms/           forms and their fields
│   ├── media-types/     types of media
│   ├── member-types/    types of member
│   ├── workflows/       approvals
│   ├── languages.toml   the site's languages
│   └── schema.toml      the version of these definitions
├── scripts/             scripts for the browser
├── .env                 secrets and local settings: never commit it
├── .gitignore           what git leaves out
├── AGENTS.md            a guide for coding agents
├── README.md            this file
├── crombolo.config.ts   the site's settings
├── domains.toml         the address of each language
├── package.json         packages and scripts
├── server.ts            starts the site for development
└── tsconfig.json        TypeScript settings
```

The first start adds the database, unless it is on Postgres, with `media/`, `logs/` and `.crombolo/`. Git leaves them out.

## Where to look first

`components/blocks/` has a view for each block, and `content/pages/home.toml` a page made of them.

## Credits

Where its pictures come from is in `CREDITS.md` in the repository: https://github.com/kineco-au/crombolo-cms/blob/main/sites/crombolo-demo/CREDITS.md
