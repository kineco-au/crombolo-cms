# 243 — Form entries from the command line

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As a site owner, I want to list, export and delete form entries from the CLI,
so that a script can collect entries on a schedule, and a request to delete
someone's data does not need the back office.

## Context

Found 2026-11-02, reviewing the CLI's gaps. `crombolo forms new` writes a form,
and Forms → Entries lists entries and downloads them as CSV
(`<form>/entries`, `<form>/entries.csv` in `server/src/server.ts`), filtered
by Library form (story 239). The CLI has none of it. Deleting entries on a
schedule is story 092; this is deleting them on request.

## Acceptance criteria

- [ ] `crombolo forms list` lists the site's forms and their Library forms, with
      a count of entries each
- [ ] `crombolo forms entries <form> [--library <path>] [--since <date>]`
      lists entries; `--csv <file>` writes the same CSV as the back office
- [ ] `crombolo forms entries delete <form> (--id <id>… | --where <field>=<value>)`
      deletes entries, `--dry-run` showing which
- [ ] `--remote <name>` on a remote; reading needs the pull permission, deleting
      needs the push permission
- [ ] `-o json`, audited; tests on SQLite and Postgres
