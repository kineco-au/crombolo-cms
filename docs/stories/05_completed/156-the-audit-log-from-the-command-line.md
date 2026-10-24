# 156 — The audit log from the command line

**Epic:** P — The command line · **Priority:** could · **Size:** M
**Depends on:** —

## Story

As whoever answers for a site's security, I want to query the audit log from the
command line and stream it out as structured records, so that it can feed a SIEM
or answer an auditor without screenshots of a dashboard.

## Context

The audit log (story 083, `audit-log.md`) is read through the Settings
dashboard, over `GET <backoffice>/crombolo/api/audit`, which needs a back-office
sign-in. Entries are deleted after `CROMBOLO_AUDIT_RETENTION_DAYS`, so anyone who
must keep them longer needs a way to get them out first.

## Decisions (2026-10-24)

- **Two commands.** `crombolo audit list` pages newest first and answers a
  `next` cursor. `crombolo audit stream [--follow]` prints NDJSON, oldest
  first. clispec gives a command one output kind, so a paged list and a stream
  are two commands. Both take the same filters.
- **Following is by id, simply.** The cursor is an entry's `id`. `--after <id>`
  resumes past it, and `--follow` keeps reading past the last id it printed.
  - **Accepted:** on Postgres, an entry that commits after one with a higher
    id (one written inside a long import, say) is never printed to a follower
    that has already passed it. SQLite commits in id order and is not
    affected.
  - **Not chosen:** a low-water cursor that re-reads gaps.
- **Remote as well as local.** Either command reads the site's own database,
  or, with `--remote <name>`, a hosted site through the remote protocol (a new
  optional `audit` capability). The remote rule is the dashboard's rule: the
  person needs the Settings section, so neither route shows anyone more than
  the other.
- **Never writes, enforced.** Locally the database is opened read-only, not
  through `bootstrapDatabase`, which migrates and seeds:
  - SQLite is opened read-only, and must already exist;
  - Postgres runs read-only transactions and skips `CREATE EXTENSION`.

  Reading, locally or remotely, writes no audit entry.

## Findings (2026-10-24)

- **`AuditLog.query`** (`data/src/audit.ts`) filters by user key, entity key,
  category, action, `since`/`until` and text. It pages by skip and take, and
  orders by `occurred_at`, then `id`.
  - Nothing records an entry with an explicit `occurredAt`, so id order is
    write order.
  - The indexes cover `occurred_at`, `(entity_key, occurred_at)` and
    `(user_key, occurred_at)`; `id` is the key.
- **The dashboard's reads** (`createAuditHost`, `GET <plugin>/api/audit`) need
  the Settings section and answer an entry as `{ id, occurredAt, category,
  action, source, user: {key, name}, item: {type, key, name}, ipAddress,
  forwardedFor, detail }`. The command line uses the same shape.
- **Users:** entries carry `user_key` and `user_name` (the name at the time,
  or the login a failed sign-in tried). `--user <email>` therefore resolves to
  an account's key, and falls back to the login for entries with no account.
- **Opening the database:**
  - Every CLI read command opens through `bootstrapDatabase`, which migrates
    and seeds.
  - `connect` creates a missing SQLite file and runs `CREATE EXTENSION IF NOT
    EXISTS citext` on Postgres.
  - `Db.readSnapshot` (story 174) already has a read-only SQLite connection
    and `READ ONLY` Postgres transactions.
- **The remote protocol** (`docs/remote-protocol.md`, `server/src/remote.ts`)
  serves environments, jobs, pulls, pushes and media. Capabilities are
  optional and advertised in discovery. `may` in the environments listing says
  what the person may do there. The conformance suite is read-only unless
  `--push`.
- **The CLI's remote plumbing** (`connectRemote`, `RemoteClient.json`) signs
  in with the device grant, keeps tokens in the keychain, and picks the only
  environment when there is one.
- **Retention:** entries are pruned after `CROMBOLO_AUDIT_RETENTION_DAYS`
  (default 365) by a job. A follower resuming past a cursor that has been
  pruned cannot tell what it missed.

## Plan

1. **A read-only connection** (`data/src/database.ts`).
   - `connect({ readOnly: true })` opens SQLite read-only without creating it,
     and refuses a missing file with the path it looked for.
   - On Postgres it skips `CREATE EXTENSION` and makes every transaction read
     only: the session's `default_transaction_read_only`, set through the
     client's connection parameters, with reads going through `readSnapshot`
     as the fallback.
   - A test proves a write through it is refused on both dialects.
2. **Keyset reads** (`AuditLog.page`).
   - Signature: `page(filter, { before?: number; after?: number; limit })`.
     `before` gives newest first (`id < before`), `after` oldest first
     (`id > after`).
   - It answers `{ items, next }`, where `next` is the last id, or null at the
     end.
   - The filter gains `user`: an email, username or key. It resolves to the
     account's key, else matches `user_name`, so a failed sign-in by that
     login is found.
   - The entry's wire shape moves beside it as `auditRecord(entry)`, which the
     dashboard uses too.
   - A cursor older than the oldest entry kept is reported (`truncated: true`)
     so a follower knows retention has passed it.
3. **The remote capability** (`server/src/remote.ts`, `docs/remote-protocol.md`).
   - `audit` joins `capabilities`, and `may.audit` joins the environments
     listing.
   - `GET <api>/environments/{id}/audit?before|after&limit&since&until&user&category&action&entity`
     answers `{ items, next, truncated }`.
   - It needs the Settings section (403 `forbidden`) and limits to 1–500
     (400 `too-many`).
   - Reading is not audited.
   - The conformance suite checks it when the capability is offered.
4. **Commands** (`packages/cli/src/commands/audit/{list,stream}.ts`,
   `support/audit.ts`). One source interface, `AuditSource.page(filter,
   cursor)`, with a local implementation (the read-only connection) and a
   remote one (`RemoteClient`). The commands don't know which they have.
   - **`audit list`:**
     - flags `--since`, `--until`, `--user`, `--category`, `--action`,
       `--entity`, `--limit` (default 50, at most 500), `--before <cursor>`,
       `--remote`, `--env`;
     - text output is one line per entry: time, category, action, who, the
       item, and where from;
     - `-o json` gives `{ items, next, truncated }`;
     - spec: `read_only`, `bounded`.
   - **`audit stream`:**
     - the same filters, plus `--after <cursor>`, `--follow` and `--interval
       <seconds>` (default 5);
     - prints NDJSON on stdout, one entry per line, oldest first, `id`
       included for resuming;
     - with `--follow` it polls until interrupted, and exits 0 on SIGINT or
       SIGTERM;
     - a truncated cursor is a warning on stderr;
     - spec: `read_only`, `output_kind: stream`.
   - Neither declares `static audit`.
5. **Tests.**
   - **Data, on both dialects:** keyset order both ways, filters, `user`
     resolution (account and failed login), `truncated`, and the read-only
     connection refusing a write.
   - **Remote, on both dialects:** the capability, `may.audit`, a reader
     without Settings refused, filters and cursors, and no audit entry from
     reading.
   - **CLI, on SQLite:**
     - list paging with `--before`;
     - JSON shape;
     - stream NDJSON order and `--after`;
     - `--follow` printing an entry added while it runs, then stopping on
       SIGTERM;
     - nothing written: the database file's modification time and the entry
       count are unchanged;
     - `--remote` against a harness server.
   - **The clispec checks** still pass.
6. **Docs.**
   - `audit-log.md`: getting entries out, the follow trade-off, keeping them
     past retention.
   - `remote-protocol.md`: the capability, the endpoint, and its error codes.
   - `operations.md`, `release-notes.md`, and the story index.

No migration.

## What was built (2026-10-24)

- **`connect({ readOnly: true })`** (`data/src/database.ts`):
  - SQLite is opened read-only, and a missing file is refused ("There is no
    database at …") rather than created.
  - On Postgres every statement runs in a `READ ONLY` transaction, and no
    extension is created.
- **`AuditLog.page(filter, { before | after, limit })`** pages by id and
  answers `{ items, next, truncated }`.
  - The filter gains `user`: an e-mail address, login or key resolves to the
    account's key, and a login with no account matches `user_name`.
  - `truncated` is set when the `after` entry is gone and every older one
    with it.
  - `auditRecord` is the one wire shape, now used by the dashboard too.
- **Remote:**
  - the `audit` capability and `may.audit`;
  - `GET <api>/environments/{id}/audit`, whose query is parsed by
    `readAuditPageQuery`, needs the Settings section (403 `forbidden`; 400
    `bad-query`) and is not audited;
  - the conformance suite checks it when it is offered.
- **Commands** (`commands/audit/{list,stream}.ts`, `support/audit.ts`):
  - one `AuditSource`, local or `--remote`;
  - `list` (`read_only`, `bounded`, `--before`, `--limit`);
  - `stream` (`output_kind: stream`, `--after`, `--follow`, `--interval`);
    it stops cleanly on SIGINT or SIGTERM and warns on a truncated cursor;
  - an `audit` topic, on the "Users and access" reference page.
- **Tests:**
  - `tests/audit-read.test.ts`, on both dialects: page order both ways,
    filters, `user`, `truncated`, a write refused through the read-only
    connection, the remote capability, and a reader without Settings refused;
  - `tests/cli-audit.test.ts`, on SQLite: list paging and text, stream order
    and `--after`, `--follow` printing an entry written while it runs then
    exiting 0 on SIGTERM, and reading leaving the entry count and the
    database file's modification time unchanged.
- **Test runs:** SQLite 2779 pass and Postgres 2777 pass. The one failure on
  each was `remote.test.ts` pinning the capability list and `may`, now updated
  for `audit`; the remote tests pass on both dialects. Integration: 92 pass,
  4 todo (story 180).

## Acceptance criteria

- [x] `crombolo audit [--since <time>] [--until <time>] [--user <email>]
      [--category <c>] [--entity <uuid>]` lists entries, newest first,
      paginated with a cursor
- [x] NDJSON output, one entry per line, oldest first with `--follow`, for
      shipping to a log store
- [x] Reading the log is not itself audited, and never writes to the database
- [x] `--remote <name>` reads a hosted site through the remote protocol's
      `audit` capability, for a person with the Settings section
- [x] Tests on SQLite and Postgres
