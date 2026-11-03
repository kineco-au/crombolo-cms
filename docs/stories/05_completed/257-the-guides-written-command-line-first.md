# 257 — The guides written command line first

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone learning Crombolo, I want the product site's guides to set a site up
with commands, and to find forms and users in guides of their own, so that I
learn the CLI as the way a site is built and meet the files only as what gets
committed.

## Context

These were story 256's first criteria. 256 was re-scoped (2026-11-03) to the
Getting started section and the CLI spec, and these guides were filed here.
Today:
- the schema-as-code guide (`sites/crombolo/docs/guides/schema-as-code.md`) is
  written around the files;
- the forms, approval workflows, user groups and webhooks commands (251) are
  documented only as sections of that guide;
- there is no forms guide or users guide;
- the deploying guide leads with files and configuration.

Story 256's walkthrough (`sites/crombolo/docs/getting-started/from-the-command-line.md`)
and its check of command lines against the CLI are the pattern to follow.

## Implementation (2026-11-03)

- **Content types** (`guides/schema-as-code.md`; the slug is kept so links
  still work) is rewritten around the commands:
  - seeing a site (`site show`, `types list|show`);
  - a new type, with the title and element defaults of 255;
  - properties and tabs, compositions, changing a type, data types, renaming,
    and languages and addresses;
  - how a change reaches the database, with the version raised when shipping;
  - checking in CI, and typed views;
  - "The files", the last section: the layout, a hand edit applied as a
    command's change is, `types export` and `types rewrite`.
- **Forms** (`guides/forms.md`), new: a first form; fields with kebab-case
  types (254); pages and fieldsets; conditions; workflows; the form on a
  page with `<Form>`; removing a form.
- **Users and groups** (`guides/users-and-groups.md`), new:
  - groups by plain permission and section names, and their listings (254);
  - changing a group;
  - users: `invite` prints the link;
  - approval workflows and their stages;
  - webhooks by plain event names.
- **Deploying** opens with "Shipping a site": a bundle (`bundle export
  --source`, `bundle build`, `start --bundle`), a deploy (`bundle deploy`) and
  a push. It says how the version is raised for each. The section on
  changes to the definitions is renamed.
- **Order:** forms and users and groups follow content types, and the guides
  after them are renumbered.
- 256's `tests/docs-commands.test.ts` covers every guide, these included.

## Acceptance criteria

- [x] **Content types:** the schema-as-code guide is rewritten around the
      `types` commands. Editing the files by hand is a short last section for
      those who want it.
- [x] **Forms**, a new guide: forms, fields, pages, conditions and workflows, by
      command, and rendering one on a page.
- [x] **Users and groups**, a new guide: groups, their permissions and sections
      (254), inviting users, approval workflows and webhooks.
- [x] **Deploying** is rewritten CLI first: bundles, remotes, `push` and
      `bundle deploy`.
- [x] The docs bundle is rebuilt (`bun run build:template`), and 256's check of
      command lines covers these guides too.
