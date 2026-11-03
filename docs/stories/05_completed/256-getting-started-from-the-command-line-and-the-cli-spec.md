# 256 — Getting started from the command line, and the CLI spec

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 252, 253

## Story

As someone trying Crombolo, I want the product site's Getting started section
to build a site with commands alone, and to tell me how to start each template
site, so that the CLI is how I meet the product. As someone reviewing a change,
I want the command line's spec in the repository, generated from the code, so
that a change to a command shows in the diff.

## Context

Split from 252 at its planning (2026-11-03), then re-scoped (below). Today:
- `sites/crombolo/docs/getting-started.md` is one page. It shows the `schema/`
  layout, writes a page with `printf` into a content file, and mentions the
  templates in a paragraph.
- `docs/building-a-site-from-the-cli.md` is the worked example. Its flow is run
  end to end by `tests/integration/cli-site.integration.ts` (252).
- The CLI is already described from its code twice:
  - `crombolo schema` prints a clispec v0.3 document (`packages/cli/src/clispec.ts`);
  - `build:template` turns the command metadata into the product site's
    Reference → Command line pages (`packages/cli/src/reference.ts`).

  Neither is kept in the repository, so a change to a command's flags, outputs
  or errors does not show in review.
- The templates `crombolo init --template list` offers:
  - the CLI's own `basic` and `next`;
  - each `sites/*` site whose `site.json` says `distribute`: `starter`,
    `demo/harbourstone`, `demo/harbourstone-next` and `demo/plain-signal`.

## Decided (planning, 2026-11-03)

- **Two outputs.**
  - The product site's Getting started section: a walkthrough from
    `crombolo init` to a site served with commands alone, and a page for each
    template site saying how to start it.
  - A CLI spec in the repository, generated from the code.
- **Out of this story:** rewriting the other guides command line first (the
  schema-as-code guide around the `types` commands, a forms guide, a users and
  groups guide, deploying). They were 256's first criteria and need a story of
  their own.
- **The spec is a snapshot and a Markdown document.**
  - `docs/cli/clispec.json` is the machine spec, the same document
    `crombolo schema` prints.
  - `docs/cli/commands.md` gives every command with its arguments, flags,
    effects, output fields and errors, readable on GitHub.
  - Both are written by one script from the code. A test fails when either is
    stale, as `tests/api-surface.test.ts` does for `docs/api/surface.json`.
- **Template pages are generated, with an optional written part.**
  - The build makes one page per template from its manifest: the name, the
    description, `crombolo init --template <id>`, and how to start it (`bun
    start`, or `bun run dev` with a Next.js front end, and the address to open).
    It also gives the bundles it brings.
  - A template may add a `TEMPLATE.md`, saying what is in it and where to look
    first, which the page folds in.
  - A new template gets a page with no extra work.

## Plan (2026-11-03)

1. **Getting started becomes a section** (`scripts/docs-site.ts`).
   `sites/crombolo/docs/getting-started.md` becomes the section's opening page
   and `sites/crombolo/docs/getting-started/` holds its pages, read as the
   guides folder is. The opening page is cut to:
   - what you need;
   - two ways in: build one with the CLI, or start from a template;
   - signing in to the back office.

   The `schema/` layout and the `printf` content file go.
2. **The walkthrough:** `getting-started/from-the-command-line.md`.
   - It runs from `crombolo init` to a site served, by command alone:
     - types, a block list and a composed page;
     - a view;
     - pages and a block (253);
     - a form on a page, a user group, an approval workflow and a webhook,
       with plain names (254);
     - publishing, and `bun start`;
     - shipping, with `bundle export --source` and `bundle build`, then
       `start --bundle` on another site, as the end-to-end test does.
   - `site show` and `types show` are shown where they help.
   - The files appear once, as what to commit.
   - `docs/building-a-site-from-the-cli.md` keeps its record of the walk and
     its gaps table, and points at the page as the one to follow.
3. **Template pages:** `getting-started/templates/<slug>`, generated.
   - `templatePages()` reads the CLI's `templates/*/template.json` and each
     distributed site's `site.json`, plus any `TEMPLATE.md` beside it.
   - Each page gives:
     - what it is;
     - `mkdir`, `crombolo init --template <id> --name …` and `bun install`;
     - how to start it (`bun start`, or `bun run dev` with web/ on :3000) and
       the address to open;
     - signing in;
     - the bundles it brings;
     - the written part.
   - A "Templates" page lists them all, each with its one-line description.
   - `TEMPLATE.md` is written for the four demo and starter sites, and for
     `basic` and `next`.
4. **The CLI spec:** `scripts/cli-spec.ts`, run as `bun run cli:spec`.
   - `docs/cli/clispec.json` is `clispecDocument` over the commands, formatted
     as the repository formats JSON.
   - `docs/cli/commands.md` is grouped by topic, as the reference index is.
     Each command has:
     - its summary and description;
     - its usage line;
     - its arguments and flags, with types, defaults and choices;
     - its effects and cardinality;
     - its output fields, its errors and outcomes, and its exit codes.

     It is a heading per command, so GitHub's outline navigates it.
   - `tests/cli-spec.test.ts` regenerates both in memory and compares them
     with the files. A deliberate change runs `bun run cli:spec` and commits
     the result.
5. **Checked against the CLI:** a test reads every `crombolo …` line in the
   Getting started pages. It checks that each names a command the CLI has and
   only flags that command takes, using the same manifest. A guide cannot
   drift from the CLI.
6. **Docs:**
   - the README names `docs/cli/` and `bun run cli:spec`;
   - `docs/testing.md` covers the two tests;
   - the release note;
   - `bun run build:template` rebuilds the docs bundle.

## Implementation (2026-11-03)

- **Getting started is a section** (`scripts/docs-site.ts`). A top page's
  folder holds its pages: `getting-started.md`, then `getting-started/*.md`.
  - The opening page was cut to: what you need, the two ways in, signing in,
    the checks before shipping, and where next.
  - `getting-started/from-the-command-line.md` is the walkthrough. Its
    commands are the ones `tests/integration/cli-site.integration.ts` runs,
    which now uses the plain names of 254.
- **Template pages:** `templateInfos()` reads the CLI's own templates
  (`listTemplates`) and the sites whose `site.json` says `distribute`
  (`listSites`). `templatePages()` makes a Templates page with a table, and a
  page per template:
  - its line;
  - creating it;
  - starting it, with `bun run dev` for a Next.js front end;
  - its content applied on the first start, said only when it ships content;
  - the back office, and its bundles.

  `TEMPLATE.md` beside each template (`packages/cli/templates/<id>/`,
  `sites/<dir>/`) is folded in. It is not copied into a scaffold: only the
  template's files are.
- **The spec:** `cliMarkdown` and `cliSpecJson` in
  `packages/cli/src/reference.ts`, from the same clispec document as
  `crombolo schema` and the reference pages.
  - `scripts/cli-spec.ts` (`bun run cli:spec`) writes `docs/cli/clispec.json`
    and `docs/cli/commands.md`.
  - The JSON leaves out the version, so a release bump does not make it
    stale.
  - The Markdown is grouped as the reference pages are. Each command has its
    usage, an argument table, its output fields, errors and outcomes, and the
    page ends with the exit codes.
- **The checks:**
  - `tests/cli-spec.test.ts` checks the spec is current.
  - `tests/docs-commands.test.ts` checks every `crombolo` command line in
    `sites/crombolo/docs/` against the manifest. It reads continued lines,
    quotes and comments as a shell does, and accepts `--no-` for a flag that
    allows it.
  - A test in `tests/docs-site.test.ts` checks the walkthrough and a page for
    every template offered, each with its own words.
- **`bundle deploy`** raises the version as `bundle build` and `push` do. It
  sends only what is committed, so after raising it the deploy is refused,
  with a hint to commit the new version.
- **Docs:** the README indexes `docs/cli/`, `docs/testing.md` covers the
  tests, and the release note is written.

## Acceptance criteria

- [x] **Getting started** is a section: an opening page, a walkthrough from
      `crombolo init` to a site served and shipped with commands alone, and a
      page for each template site.
- [x] **Each template's page** says what it is and how to create and start it,
      generated from its manifest with its `TEMPLATE.md` folded in. Every
      template `init --template list` offers has one.
- [x] **The CLI spec** is in `docs/cli/`: `clispec.json` and `commands.md`,
      generated from the code by `bun run cli:spec`. A test fails when either
      is stale.
- [x] Every `crombolo` command line in the Getting started pages names a real
      command and only its flags, checked by a test.
- [x] The docs bundle is rebuilt (`bun run build:template`).
