# 164 — The demo sites from seed files

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 163

## Story

As someone reading a crombolo template to learn how a site is put together, I
want its content to be seed files I can open and change, so that the demo sites
show the way a real site is built rather than a script only this repository
has.

## Context

Every template's content is written by `scripts/build-template.ts`: one
TypeScript builder per site (`BASIC`, `STARTER`, `HARBOURSTONE`, `CROMBOLO`),
with fixed keys, run in a throwaway database and exported as each site's
committed bundle. The product site's docs section (story 157) is generated into
the same builder. Once seed files exist (story 163), the builders are a second,
private way of doing the same thing.

## Acceptance criteria

- [ ] `sites/harbourstone` has a `seed/` directory holding all its content —
      the pages, the Library elements (tasting notes, highlights) and the
      photographs with their alt text — replacing its builder
- [ ] The same for `sites/starter`, `sites/crombolo` and the `basic` template
- [ ] The product site's generated docs pages (story 157) are written as seed
      files by the docs build, so the guides and references stay generated
      while everything else is hand-written
- [ ] Node keys stay the same as today's bundles, so a site already holding a
      demo's content sees an unchanged import, not a new site
- [ ] `bun run build:template` builds each bundle from its seed with `seed
      build`, and the builders in `scripts/build-template.ts` are removed
- [ ] `crombolo init --template <id>` writes the seed into the new site beside
      the schema and components, so a new site can edit its starting content as
      files
- [ ] The tests that check the committed bundles against a fresh build keep
      passing; `tests/templates.test.ts` and `tests/docs-site.test.ts` updated
