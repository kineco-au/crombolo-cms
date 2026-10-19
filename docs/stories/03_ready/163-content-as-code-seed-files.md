# 163 — Content as code: seed files

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer standing a site up from the command line, I want to write its
pages, Library elements and media as files in the repository and apply them,
so that a working, populated site comes from a clone and one command, with no
one typing content into the back office.

## Context

Everything but content can already be set up from files or commands (the
schema, components, hostnames, settings). Content cannot: there is no command
that creates a page or sets its values. A bundle carries content, but bundles
are machine-written — an integrity hash, keys everywhere, values in the shape
each editor stores — and are exported from a site that already holds the
content.

The way through is already proven inside the repository.
`scripts/build-template.ts` builds every demo site's content in TypeScript —
helpers `page`, `element`, `image`, `pick` and `richtext` over
`DocumentRepository` — in a throwaway site, then exports it as the bundle each
template ships. Seed files make that a feature: a format a person writes, and a
command that turns it into the **existing bundle format** and applies it
through the **existing import** — so a seed gets the dry run, the conflict
findings, one transaction with schema before content, revert, `--publish` and
`push` without a second write path.

This reverses the Epic P line "editing content… stays in the back office": the
back office stays where content is *edited*; seed files are how a site's
starting content, and content that belongs with the code (legal pages, the docs
section of the product site, fixtures), is *declared*.

## Decisions

- **Seed files, compiled to a bundle.** Not imperative `content create`
  commands: deep values (blocks, pickers) would be JSON on a command line, and
  ordering and idempotency would be every script's problem. A few imperative
  verbs for day-two work are story 165.

## Acceptance criteria

- [ ] **Layout.** A `seed/` directory at the site root: `seed/content/` (the
      content tree), `seed/library/` (Library elements) and `seed/media/` (the
      files, in the folders they go in). The folder tree is the content tree;
      each item is one TOML file named for its URL segment, with its children
      in a folder of the same name
- [ ] **Identity.** An item may give a `key`; otherwise its key is derived from
      its path, so a rebuild names the same node and the bundle does not churn.
      Renaming a file is a new node, and `seed check` says so
- [ ] **Order.** Siblings are sorted by an `order` field, then by name
- [ ] **Values by property alias, with a shorthand per editor:** rich text as
      Markdown or HTML; a content picker or link by content path; a media picker
      by media path; an element picker by Library path; block list and block
      grid items as `{ type = "<element alias>", values = {…}, settings = {…} }`;
      multi-URL picker, tags, dates, numbers and toggles in their natural TOML
      form. Anything else may be given in the editor's stored shape
- [ ] **Cultures and segments.** Variant values and names per culture
      (`[values.en-US]`); a culture the site has no language for fails the check
- [ ] **Media.** A file under `seed/media/` becomes a media item of the type its
      extension implies; an optional sidecar (`photo.jpg.toml`) gives its name,
      alt text and focal point. The bytes travel in the bundle
- [ ] **Template and publish state.** An item may name a template (default: its
      type's) and `published = false`; everything else is published by
      `seed apply --publish`
- [ ] `crombolo seed check` validates every file against the site's schema
      (unknown type or property, a value the editor cannot take, a path that
      resolves to nothing, a missing culture) and exits 20 with each finding,
      file and line
- [ ] `crombolo seed build --out <dir>` writes the bundle; `crombolo seed apply
      [--publish] [--dry-run]` builds and imports it, showing the import's own
      findings (new, changed, conflicting) and taking its resolution flags
- [ ] **Idempotent.** Applying an unchanged seed changes nothing; a value edited
      in the back office since is a conflict the import reports, never
      silently overwritten
- [ ] `crombolo start --seed` applies the seed once per seed version, as
      `--bundle` does today, so a fresh clone starts populated
- [ ] `crombolo seed export <path>…` writes seed files from content already in
      a site, so an existing site can move to seeds
- [ ] Commands in `crombolo schema` (clispec), with `-o json`
- [ ] A seed guide in `docs/` and on the product site's docs section; the Epic P
      line in `docs/stories/README.md` updated
- [ ] Tests on SQLite and Postgres: every shorthand, cultures, media with
      sidecars, ordering, re-apply without changes, a conflicting re-apply,
      and a round trip (`seed export` then `seed apply` onto an empty site)

## Out of scope

- Public access rules, users and members in seed files: story 166, after the
  open question in 162.
- Content templates (blueprints): a later addition once the format settles.
- Turning the demo sites into seeds: story 164.
