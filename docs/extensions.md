# Extensions in their own process

Story 311. An extension's server half runs in a Deno process of its own, apart
from the CMS, holding nothing it was not granted. The CMS stays on Bun. Why
Deno, and why not the whole CMS, is decision D1 in
[`extension-threat-model.md`](extension-threat-model.md); what an extension may
ask for is [`bundles.md`](bundles.md), "Permissions".

## What runs where

| | Where it runs |
|---|---|
| The CMS, its database connections, its secrets | The Bun process, as before |
| An installed extension the CMS starts (granted, listed under `extensions` or granted in Installed) | A Deno process per extension |
| An extension the site's `crombolo.config.ts` still imports | The Bun process: importing a module runs it, so it is the site's own code, unconfined. The boot warns, and says to list it under `extensions` instead |
| An extension's screens | The back office, in the browser (story 313) |

## Starting one

At boot, for each granted extension (`packages/server/src/extension-discovery.ts`):

1. **It is built** (`buildExtension`, `extension-process.ts`): Bun bundles the
   package's server entry, its own dependencies and the extension SDK into one
   file, `.crombolo/extensions/<id>/build/server.js`. Nothing of it runs in the
   CMS while it is built: a Bun macro, which would, is refused.
   `@crombolo/crombolo/bundle`, `@crombolo/extension` and `@crombolo/common` all
   resolve to the CMS's own copy of the SDK.
2. **It is started** under Deno, with:

   | Flag | What it allows |
   |---|---|
   | `--allow-read` | its package directory, its build, and its data folder |
   | `--allow-write` | its data folder, `.crombolo/extensions/<id>/data`, and nothing else |
   | `--allow-net` | the hosts of the origins its grant gives `http.outbound`; nothing when it asks for none |
   | `--v8-flags=--max-old-space-size=256` | a 256 MB heap |
   | `--no-prompt --no-remote --cached-only --no-config --no-npm --no-lock --node-modules-dir=none` | it loads only what it was built with, and asks for nothing at run time |

   Everything else is Deno's default, which is no: no environment (`Deno.env`
   is refused, and the process is started with none of the site's), no other
   files (`.env`, the SQLite file, `crombolo.config.ts`), no programs, no native
   code, no other hosts.
3. **It describes itself:** the SDK's runner calls the factory `crombolo.server`
   names with the extension's settings, and sends back its id, section,
   capabilities, routes, tables, events, jobs, schedules, media folders and form
   workflow types.
4. **It is mounted** (`isolatedBundle`): an ordinary `ServerBundle` built from
   that description, whose handlers send each call to the process. The host's
   checks (`bundles.ts`, story 309's grant) run on it exactly as on one
   in-process, before anything is sent.

One that cannot start is left off and the site starts without it. Installed
shows "Could not start" with the reason, and so does the health check
"Installing code". The reasons:
- it fails to build, or to load under Deno: a Bun API such as `Bun.file` or
  `bun:sqlite`;
- its factory throws;
- it offers `middleware`, which only the site's own code may (it would put a
  round trip on every request);
- it adds form field types, whose markup renders inside the page (story 312);
- on Postgres, its tables' role cannot be created by the CMS's database user
  (`OwnerSetupNeededError`, which says what to run).

## The channel

The CMS and the extension talk over the process's standard input and output, in
frames of JSON, each prefixed with its length (`@crombolo/extension/channel`).
The extension's console is sent to the site's log, since standard output is the
channel.

- **Calls from the CMS:** a route, an event, a job, a form workflow's run, a
  table step's backfill. Each carries what the handler is given, encoded:
  - data as data, dates, bytes, maps, URLs, errors and a route's `Result`
    tagged so they arrive as themselves;
  - each function (a capability method, `setCookie`, `member()`,
    `job.progress`) as a number in that call's table, which the extension calls
    back. The table is dropped when the call answers, so a capability kept for
    later no longer works;
  - each `AbortSignal` as a number, aborted on the other side when it aborts
    here.
- **Bodies are streamed** in 64 KB chunks: a request's body is sent as the
  extension reads it, and a response's as the extension writes it. A route that
  hands its own request to `media.create` sends it back by reference, unread.
- **`site()`** is not offered: an extension reads content through `bundle.api`.

## Its own tables

`context.bundle.database` is a Kysely in the extension, whose driver sends each
query's operation tree to the CMS. The CMS compiles it with the extension's own
handle, on the connection that reaches only its tables (Part 4 of
[`bundles.md`](bundles.md)), and runs it only if it is one statement that
reads or writes rows (`extension-sql.ts`). That refuses `ATTACH`, `PRAGMA`,
`RESET ROLE`, `SET ROLE`, `set_config`, `COPY` and a second statement. The
extension never holds a connection or a credential. Transactions are held open
in the CMS between `begin` and `commit`.

On Postgres the connection is the CMS's, confined with `SET LOCAL ROLE` to the
extension's role, which owns its schema and nothing else. The statement check
is what stops the extension's SQL undoing the role.

## When it fails

| It | Then |
|---|---|
| throws | that call fails: a route answers 500, an event or a job is retried as any other |
| exits or crashes | every call in flight fails, and the next call starts it again, after a back-off that doubles from a second to a minute |
| hangs | its call fails after 30 seconds (`extensions.<id>.timeoutMs`); a process that then does not answer a ping in 2 seconds is stopped, and started again |
| is idle | stopped after 5 minutes without a call, unless it answers routes; the next event or job starts it |

The site keeps serving throughout.

## Writing one

An extension imports `@crombolo/extension` (a dev dependency for its types;
the CMS supplies its own copy when it builds it). The API is
`@crombolo/crombolo/bundle`'s, which still works: `route`, `defineBundleTables`,
`hasSection`, `hasCultureAccess`, the `Result` helpers, and the types. It runs on
Deno, so it uses web APIs, `node:` built-ins Deno supports, and the host's
capabilities; not Bun's.

A form workflow type's `run` is called over the channel. Its `validate` is not,
since the form designer checks settings synchronously: its settings are held to
their declarations.

**On a developer's machine**, an entry can widen what its process may read and
reach while it is being worked on. The CMS refuses this when `NODE_ENV` is
`production`:

```ts
extensions: {
  crm: {
    grant: ['content.read'],
    dev: { allowRead: ['/Users/me/crm/fixtures'], allowNet: ['http://localhost:4000'] },
  },
},
```

## Deno

- **Where it comes from:** `deno` is a dependency of `@crombolo/server`, pinned,
  with a binary per platform, so `bun install` brings it. The CMS finds the
  platform's binary itself, so its install script is not needed (Bun blocks it).
  `CROMBOLO_DENO` names another binary.
- **Platforms:** macOS, Windows, and glibc Linux. Deno publishes no musl build,
  so a container is `oven/bun:1-slim`, not Alpine; on Alpine the CMS says so
  rather than starting extensions.
- **It is a security dependency:** its permission checks are the boundary, so its
  version is kept current.

## Footprint

Measured on macOS, arm64, Deno 2.9.6, with Simple Redirects (2026-11-09):

| | |
|---|---|
| Starting an extension (spawn, load, describe) | about 30 ms; 190 ms the first time, with its build |
| Its memory | about 27 MB resident |
| The Deno binary | 78 MB on disk |

## Tests

- `tests/extension-isolation.test.ts`: one test per threat the process answers
  (T1, T2, T7, T11, T14), a job over the channel, and an extension that cannot
  run apart being left off.
- `tests/extension-discovery.test.ts`, `tests/simple-redirects.test.ts` and
  `tests/entra-bundle.test.ts` run their extensions in Deno.
- CI runs these on macOS and Windows as well as Linux (`extensions` in
  `.github/workflows/ci.yml`).
