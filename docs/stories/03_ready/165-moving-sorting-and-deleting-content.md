# 165 — Moving, sorting and deleting content

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As an operator scripting changes to a running site, I want to move, copy, sort
and delete pages and media from the command line, so that a restructure can be
scripted and rehearsed rather than done by hand.

## Context

`crombolo content publish` and `unpublish` exist; nothing else changes the
tree. The document and media ports already move, copy, sort and trash
(`createDocumentPort`, `createMediaPort`; the `document` and `media` areas of
the Management API). Seed files (story 163) declare starting content; these are
the day-two verbs that seeds deliberately do not have.

## Acceptance criteria

- [ ] `crombolo content move <path|uuid> --to <path|uuid>` and
      `crombolo media move …`
- [ ] `crombolo content copy <path|uuid> --to <path|uuid> [--descendants]`
- [ ] `crombolo content sort <parent> <child>…` sets the order of the named
      children; children not named keep their order after them
- [ ] `crombolo content delete <path|uuid>` moves to the recycle bin;
      `media delete` likewise. A permanent delete stays `recycle-bin empty`
- [ ] Each takes `--dry-run`, checks the whole selection before writing (as
      `content publish` does), refuses what an editor could not do (moving under
      a type that does not allow it), and writes an audit entry
- [ ] A move records the redirect an editor's move would (story 042)
- [ ] In `crombolo schema` (clispec), with `-o json` and the usual exit codes
- [ ] Tests on SQLite and Postgres
