# 311 — A Deno process per extension

**Epic:** I — Hardening · **Priority:** must · **Size:** XL
**Depends on:** 310

## Story

As someone running a site with extensions, I want each one to run apart from the
CMS, holding nothing it was not granted, so that a hostile or broken extension
cannot read the site's secrets or database, reach the network it was not given, or
stop the site.

## Context

An extension's server half runs in the CMS process, with the CMS's environment, its
database connection and its filesystem. See `extension-threat-model.md`, T1, T2, T7,
T11, T14, and decisions D1 and D3.

## Decisions (2026-11-09)

- **Each extension runs under Deno, the CMS stays on Bun.** The CMS must run
  locally without Docker on macOS, Linux and Windows, which rules out bubblewrap,
  `sandbox-exec` and namespaces.
  - Bun has no permission model, and stripping its APIs is a blocklist, not a
    boundary.
  - Deno's permissions are enforced by the runtime, path by path and host by host,
    on every platform.
  - Moving the whole CMS to Deno was weighed and rejected: Deno's permissions apply
    to the whole process, so extensions loaded into the CMS would inherit everything
    it may do. It would also mean rewriting about 170 Bun API uses and 286 test
    files, a new SQLite driver, and the image and password code.
  - Node's `--permission` was ruled out: Node says it is not a boundary against
    malicious code.
- **Deno arrives through npm:** `deno` is a dependency of `@crombolo/server`, with a
  binary per platform, so `bun install` brings it and no one installs anything by
  hand. Its version is pinned and kept current, as a security dependency.

## Decisions (2026-11-09, building)

- **The Docker image moves to Debian slim** (`oven/bun:1-slim`): the `deno` npm
  package ships glibc binaries only, so Alpine would need an unpinned Deno.
- **Middleware is site code only.** An extension can no longer declare `middleware`,
  and the install refuses a version that does: it would put a round trip to every
  extension on every page.
- **Postgres roles, or refuse.** When the CMS's database user cannot create the
  extension's role, an extension with tables does not start, and the health check
  says to grant `CREATEROLE` or create the role. Extensions without tables run.
- **Form field types wait for 312.** A field type's `render` returns markup inside
  the page render, which an out-of-process call cannot answer. Until 312 renders
  an extension's markup in its own process, the install refuses a version that
  adds field types. Form workflow types run over the channel.
- **One story:** the process, the channel, tables, and the macOS and Windows CI
  runners land together.

## The design

- **One Deno process per extension:**
  - started when the extension is first needed (a route, an event, a job, a
    template render);
  - restarted after a crash, with a back-off;
  - stopped after it has been idle a while, unless it serves routes or templates;
  - a call that cannot be answered in time fails with a timeout, and the site goes on.
- **Its permissions**, as the CMS starts it:
  - `--allow-read`: its own package directory, and the SDK it runs on, and nothing else.
  - `--allow-write`: only its own data directory, `.crombolo/extensions/<id>/`, when
    it needs one.
  - `--allow-net`: the origins its granted `http.outbound` names, and nothing when it
    asks for none.
  - Deno's defaults deny the rest: its environment is empty (no `--allow-env`), it
    cannot run programs (no `--allow-run`), load native code (no `--allow-ffi`),
    open other files, or reach the site's `.env`, database file or code.
  - `--no-prompt`, `--no-remote` and `--cached-only`: it loads only what is installed,
    and asks for nothing at run time.
- **The channel:**
  - The CMS and the extension talk over the process's standard input and output, in
    length-prefixed messages.
  - The CMS serves the host API (story 308's catalogue) and checks every call against
    the grant (story 309).
  - Routes, events, jobs and template renders go to the extension as messages, with
    requests and responses as data. Bodies are streamed in chunks, so an upload or a
    download is not held whole.
  - Reads are batched where a render needs many.
- **The extension SDK** is what an extension imports in place of
  `@crombolo/crombolo/bundle`.
  - It runs on Deno, carries only the channel client and the types, and keeps the
    API extensions code against today as close as an async channel allows.
  - An extension that uses Bun-only APIs (`Bun.file`, `bun:sqlite`) does not run,
    and the install says so. Simple Redirects and Entra use only the host API.
- **Its own tables** go through the channel. The CMS runs the queries on a
  connection that reaches only that extension's tables:
  - Postgres: a login role that owns only its schema;
  - SQLite: its own file, with attaching other databases refused.
  - The extension never holds a database connection or credentials.
  - To verify while building: how `bun:sqlite` refuses `ATTACH` (an authorizer, or
    `SQLITE_LIMIT_ATTACHED` set to 0).
- **Outbound:** two checks. Deno's `--allow-net` lets it reach only its declared
  origins. The host's `fetch`, which it may use instead, adds the address rule
  (story 301).
- **Footprint** (measured 2026-11-09, on Bun; to measure again on Deno): about 30 MB
  and 50 ms to load an extension with today's SDK, and about 10 µs for a call over a
  pipe. A slim SDK lowers the first two. The Deno binary adds about 100 MB to an
  install.
- **Development:** the same on every platform. There is no unconfined mode to opt in
  to.
  - A developer working on an extension can widen its permissions in the config for
    their machine only (`extensions: { <id>: { dev: { allowRead: [...] } } }`).
  - The CMS refuses that setting when `NODE_ENV` is `production`.

## Acceptance criteria

- [x] An extension's process has no environment, and its attempts to read the site's
      `.env`, its SQLite file and its `crombolo.config.ts` are refused by Deno.
- [x] A `fetch` to an origin it did not declare, or to a private address, is refused.
      So is a raw connection.
- [x] It cannot run a program or load native code.
- [x] An extension that throws, hangs or exits fails its call, and the site keeps
      serving. It is restarted for the next call.
- [x] Its own tables are reachable through the channel, and no others. On SQLite, an
      `ATTACH` is refused.
- [x] Simple Redirects and Entra run in their own Deno processes, on the extension
      SDK, their tests unchanged apart from setup.
- [x] The same tests pass on macOS, Linux and Windows CI runners, with no Docker.
- [x] The threat model's "what isolation does" table is confirmed by tests, one per
      threat.

## Implemented (0.57.0)

- **The SDK,** `@crombolo/extension` (`packages/extension`): `route`,
  `defineBundleTables`, `hasSection`, `hasCultureAccess`, the `Result` helpers and
  the types, with the channel (`channel.ts`) and the Deno-side runner
  (`runner.ts`). `@crombolo/data` exports `./tables-builder` and `@crombolo/core`
  `./sections`, so the SDK takes the pure parts only.
- **The build:** Deno will not strip TypeScript under `node_modules`, so the CMS
  builds each extension with Bun into `.crombolo/extensions/<id>/build/server.js`:
  its code, its dependencies and the SDK, in one file. That also leaves Deno one
  directory to read. `@crombolo/crombolo/bundle` and `@crombolo/common` resolve
  to the SDK. A Bun macro is refused, since Bun has no switch to turn macros off.
- **The process** (`packages/server/src/extension-process.ts`): the flags as
  designed, plus `--no-npm`, `--no-lock` and `--node-modules-dir=none`, a 256 MB
  heap, and an environment of Deno's own settings only. The binary is the
  `deno` package's platform binary, found without its install script, or
  `CROMBOLO_DENO`.
- **Mounting:** the runner describes the extension, and `isolatedBundle` builds
  the `ServerBundle` the host mounts and checks as before. Routes, events, jobs,
  form workflows and table backfills are calls; each call's functions and
  signals travel as numbers, and stop working once it answers.
- **Its tables:** the extension's Kysely sends operation trees; the CMS compiles
  them on the owner's handle and runs only one statement that reads or writes rows
  (`extension-sql.ts`).
- **Failures:** a call times out after 30 s (`extensions.<id>.timeoutMs`). A
  process that then misses a ping is stopped; a stopped one restarts on the next
  call after a back-off. One that cannot start is left off, with
  `couldNotStart` in Installed and a warning in the health check.
- **Docker:** `docker/Dockerfile.cms` is `oven/bun:1-slim`.
- **CI:** an `extensions` job runs the extension tests on macOS and Windows.
- **Differences from the plan:**
  - **Postgres** keeps the CMS's connection confined by `SET LOCAL ROLE`, not a
    login role per extension: the statement check is what stops the
    extension's SQL from undoing the role. A login role would need a password per
    extension and password logins in `pg_hba`. A role the CMS cannot create
    leaves that extension off, as decided.
  - **A server half the config imports** still runs in the CMS: importing a
    module runs it, so it is the site's own code. The boot warns.
  - **Refusals happen at start, not at install:** middleware, form field types and
    Bun APIs are found when the extension is built or described, so Installed
    shows them after the restart.
  - **A form workflow's `validate`** is not called, since the designer checks
    synchronously. Its settings are held to their declarations.
  - **The footprint** is measured on Deno: about 30 ms to start and 27 MB
    resident.
- **Tests:** `tests/extension-isolation.test.ts`, and the discovery, Simple
  Redirects and Entra tests, which now run their extensions in Deno.
