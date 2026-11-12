# 341 — A new site opens on a welcome page

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 163, 180

## Story

As someone who has just run `crombolo init`, I want the site to start with a page
type, a template and a page to look at, so that the first thing I see is a working
site I can edit rather than an empty tree and a 404.

## Context

A plain `crombolo init` scaffolds the files and no content: no type, no view, no
page. The `basic` template (`--template basic`) had one home page type with a title
and a body, opt-in only.

## The design

- **Files, from a plain `init`.** The `basic` template becomes the welcome starter
  and the default when no `--template` is given. Everything is a file the developer
  owns and can delete: the type in `schema/`, the template in `components/`, the
  Home page in `content/pages/` and the logo in `content/media/`. The first
  `bun start` applies them, as for any template with content.
- **A Content Page type**: a title, an image and a description. Its template shows
  whatever a page holds, so a second Content Page is not a second welcome.
- **The welcome is content.** The Home page is seeded with the title "Welcome to
  Crombolo", the Crombolo logo as its image and a short introduction as its
  description, all changed in the back office.
- **`crombolo init --empty`** keeps the bare scaffold, for a site built from
  nothing, as the command-line walkthrough does.

## Acceptance criteria

- [x] A plain `crombolo init` writes the Content Page type, its template, the Home
      page and the logo; `bun start` serves the welcome page at `/`
- [x] The Content Page has a title, an image and a description, and its template
      renders each only when it is set
- [x] `crombolo init --empty` writes the files and no content; `--empty` with
      `--template` is refused
- [x] `--template list` and the docs say what a plain `init` gives you

## Built

- `packages/cli/templates/basic` is the welcome starter: `schema/content-types/content-page.toml`
  (title, image, description, with an `[seo]` table taking the description and image),
  `components/contentPage.tsx`, `content/pages/home.toml` and the logo in `content/media/`.
- `crombolo init` uses it when no `--template` is given (`DEFAULT_TEMPLATE`,
  `cli/src/commands/init.ts`); `--empty` scaffolds without it and is exclusive with
  `--template`.
- The walkthroughs that build every page themselves (`docs/building-a-site-from-the-cli.md`,
  the product site's "A site from the command line") start with `--empty`, as do the
  integration tests that do the same.
- Tests: `tests/templates.test.ts` (the type, and the seed's welcome page and logo),
  `tests/site-terms.test.ts` (plain and `--empty`), and `new-site.integration.ts`, which boots
  a plain `init` and fetches the welcome page and its logo.
