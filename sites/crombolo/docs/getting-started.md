---
title: Getting started
summary: What you need, the two ways into a first site — the command line, or a template — and signing in to the back office.
order: 1
---

A crombolo site is a small Bun project. Your views are `.tsx` components, and the site, the back office and the API run as one process on SQLite or Postgres. You build it from the command line or in the back office, and everything you set up is kept in files you commit.

## What you need

| | |
| --- | --- |
| **Bun** 1.3 or later | runs the site, the command line and your tests |
| **Postgres** | optional. A new site uses SQLite, which needs nothing installed |

There is no Node toolchain, no .NET SDK and no separate database server to set up for a first site.

```sh
curl -fsSL https://bun.sh/install | bash
```

## Two ways in

**Build one from the command line.** [A site from the command line](/docs/getting-started/from-the-command-line/) walks you, a step at a time, from an empty folder to a running site you're signed in to, then on to your own pages, forms, approvals and shipping. Start here to learn how a site is put together.

**Start from a template.** A template brings types, views, styles and starting content, so there is something on the page at once. [Templates](/docs/getting-started/templates/) has a page for each, saying what is in it and how to start it:

```sh
bunx @crombolo/cli@latest init --template list
```

Either way, `init` scaffolds into an empty folder and says what to run next. Add `--postgres` to point the site at a Postgres database instead of SQLite.

## Sign in

The first start creates the database, then prints where the site is and how to sign in:

```text
┌─────────────────────────────────────────────────────┐
│ Crombolo is running                                 │
│                                                     │
│   backoffice  http://localhost:8080/crombolo        │
│   site        http://localhost:8080/                │
│                                                     │
│   Sign in with                                      │
│     username  admin@crombolo.local                  │
│     password  3ojND8TcMF0KjfD3                      │
└─────────────────────────────────────────────────────┘
```

On your own machine a fresh password is printed on every start, so what you see is always true. Set `CROMBOLO_ADMIN_PASSWORD` to keep the same one, or run `crombolo start --keep-admin` to leave it alone. A production site never does this; see [Deploying](/docs/guides/deploying/).

If port 8080 is taken, start on another: `PORT=3000 bun start`.

## Before you ship

```sh
bunx crombolo components check       # compile and type-check every view
bunx crombolo types check --static   # check the definitions without a database
bunx crombolo bundle build --check   # check the content files against them
bunx crombolo status                 # whether this environment is working
```

Each exits with a non-zero code when it finds a problem, so they drop straight into CI.

## Where next

- [A site from the command line](/docs/getting-started/from-the-command-line/), the whole walk.
- [Templates](/docs/getting-started/templates/), one page for each.
- [Content types](/docs/guides/schema-as-code/), [Forms](/docs/guides/forms/) and [Users and groups](/docs/guides/users-and-groups/): the rest of a site, by command.
- [Content files](/docs/guides/content-files/): content kept with the site.
- [Deploying](/docs/guides/deploying/): bundles, remotes and production.
- [The command line reference](/docs/reference/command-line/): every command, generated from the CLI itself.
