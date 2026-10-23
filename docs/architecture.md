# Architecture

## Repo layout

```
crombolo/
├── docs/
├── packages/
│   ├── crombolo/                 # the package a site installs: crombolo() + the CLI
│   ├── server/                   # composition root: config, ports, adapters, createServer
│   ├── core/                     # domain: entities, services, notifications — no I/O
│   ├── contracts/                # OpenApi.json + generated types
│   ├── data/                     # dialect seam: schema, migrations, repositories
│   ├── content/                  # document writes: actors, permissions, approvals, events
│   ├── auth/                     # OAuth2 server, token store, cookies, providers
│   ├── api-management/           # <backOfficePath>/management/api/v1/** handlers
│   ├── api-delivery/             # /crombolo/delivery/api/v2/** over the published cache
│   ├── backoffice-host/          # SPA shell, importmap, static assets, manifests
│   ├── schema/                   # schema-as-code: model, parser, validator, writer, sync
│   ├── import-umbraco/           # opt-in: an Umbraco backup → a report, schema files, a bundle, view stubs
│   ├── backoffice-dist/          # the built backoffice (dist/ generated, upstream-static/ committed)
│   └── render/                   # TSX renderer, published cache, front-end routing
├── apps/site/                    # the reference site: config, server.ts, components/, schema/
├── scripts/
└── tests/
```

Bun workspaces. Every package is `@crombolo/<name>` with an `exports` map and its
dependencies declared as `workspace:*`; the umbrella `@crombolo/crombolo` depends on all of
them but `import-umbraco`, which a site adds only when it is importing one. There are no tsconfig `paths` — resolution is ordinary package resolution,
which is what makes the packages consumable outside this repo.

## Dependency rules

- `core` depends on nothing but its own types — all business rules live here
- `data` implements `core`'s repository interfaces and is the only package that
  knows SQL exists
- `content` depends on `core` and `data` only — never on a transport. It holds
  every document write and the rules each follows (below)
- `api-management` depends on `core`, never on `data`. From `content` it imports
  values only through `@crombolo/content/rules` (actors, permission tables, event
  mappings), which reaches no database; the operations themselves are handed to
  it as a port
- `api-delivery` depends on `core`, `contracts` and `render`, never on `data`: it
  reads the published cache, and the server hands it the member and protection
  lookups it needs
- `render` depends on `core` and a content source interface; it never queries drafts.
  It also depends on `@types/react`, for types only: each tag's attributes are
  React's, adapted (`jsx-attributes.ts`), and nothing of React runs. A site
  installs it with `@crombolo/crombolo`, and the view editor is served it (with `csstype`)
- `transfer` depends on `core` and `data`, mirroring `schema`: it owns the bundle
  format and reads content through the repositories rather than any SQL of its own
- `import-umbraco` depends on `schema`, `transfer`, `core` and `data` for the
  formats it writes, and on `@kineco-au/bacpac-importer` to read a `.bacpac`. It
  writes no rows and no files: it returns a report and a list of files. Nothing
  depends on it — the CLI loads it on demand — so a site that never imports
  anything does not carry it (`umbraco-import.md`)
- `auth` owns identity and tokens; the API packages receive a resolved principal
- `cli` depends on `server` for the site operations it drives and owns no rules of
  its own; `@crombolo/crombolo` depends on `cli` only to expose the bin, so a site that
  never shells out still gets the same binary
- composition happens in `apps/site` and the CLI

## Document writes

Every change to a page — create, save, publish, unpublish, schedule, publish a
branch, trash, delete, empty the bin, restore, move, copy, sort, roll back,
domains and public access — is a method on `DocumentOperations`
(`packages/content/src/operations.ts`, story 170). The backoffice handlers, the
command line, scheduled publishing, approvals and form workflows all call it, so
the rules do not depend on what started the change.

- **An actor is passed to every operation.** A `user` is checked against their
  permissions, start nodes, languages and property writes, and gated by
  approvals. An `operator` (the command line) is not checked — they hold the
  database — but approvals still apply unless they say `skipApproval`, which is
  recorded. `system` (the schedule, an approved request, a form) acts on what
  was already decided: no checks, no gate.
- **One change is one transaction.** `DocumentRepository.atomically` takes the
  tree lock and a transaction; create-and-publish, save-and-publish and
  publishing several pages either all happen or none do.
- **A refusal is a value**, not an exception: `notFound`, `forbidden`,
  `needsApproval`, `invalid`, `conflict`, `blocked`, `validation`, `stale` or
  `revisionRequired`, with the status a transport would answer and the reason
  in words. Each transport turns it into its own shape — a problem-details
  response, a CLI error.
- **A user writes from a revision** (story 172). `save`, `saveAndPublish`,
  `publish` and `rollback` take the revision the user's copy was read at, and
  the repository compares it after taking the tree lock. A user's draft-
  replacing write needs one; the operator and the system act on the page as it
  stands. The HTTP shape is `ETag` / `If-Match` (`api-contract.md`).
- **What happened is an event**, recorded through an `EventSink` inside the
  change's transaction (`record`), with what only a running server does after
  the commit (`afterCommit`). The event goes to the audit log and the outbox
  in that same transaction (story 171). The
  mappings from event to audit entry, webhook, change notification and live
  backoffice event are pure functions in `content`; the server's sink
  (`packages/server/src/content-events.ts`) does the writing. The command line
  wires the same sink without the live part (`siteDocumentOperations`). The
  Management API router skips its own derivation for these operations
  (`DOCUMENT_WRITE_OPERATIONS`), so nothing is announced twice.
- file I/O a save needs (placing uploads) reaches the repository as a
  _value intake_ the server supplies, so `data` stays free of the file system
- image processing adds no dependency: Bun's `Image` resizes and encodes, and
  crops and padding go through a small PNG codec in `server/imaging.ts`

## Server composition

One Bun `serve()` with an ordered router:

Requests on `<backOfficePath>/management/api/…`, `/crombolo/delivery/api/…`
and the two hubs under the back office are first routed as the contract names
them (`contractPathFor`), so the table below is written in those terms.

| Order | Prefix | Handled by |
| --- | --- | --- |
| 1 | `/umbraco/backoffice/*`, `/umbraco/login/*`, `/packages/*` | `backoffice-host` static |
| 1 | `…/security/back-office/graphics/*` | `backoffice-host` (not in the contract) |
| 2 | `/umbraco/management/api/v1/security/back-office/*` | `auth` (not in the contract) |
| 2 | `/umbraco/management/api/v1/*` | `api-management` |
| 3 | `/umbraco/management/api/v1/security/back-office/*` | `auth` |
| 4 | `/umbraco`, `/umbraco/login` | `backoffice-host` HTML shells |
| 5 | `/umbraco/delivery/api/*` | `api-delivery`, on nodes that serve the site ([`delivery-api.md`](delivery-api.md)) |
| 6 | `*` | `render` — front-end content routing |

## Contract-first handlers

`packages/contracts/OpenApi.json` is vendored, and types are generated from it with the
same generator the client uses. Handlers are registered in a typed route table
keyed by `operationId`:

- an operation present in the spec with no handler is a **compile-time** gap
  (it resolves to a `501` stub that the coverage report counts)
- a handler whose response shape drifts from the schema is a **type error**
- in test mode every response is validated against its schema at runtime

`bun run coverage:api` emits `docs/api-coverage.md` — implemented vs. total
operations per area — and fails CI if an implemented operation regresses.

## Cross-cutting infrastructure

- **The content checkpoint** (story 174): one counter, moved inside every
  transaction that changes published content, so its order is the commit
  order. Each published cache snapshot is read in one read snapshot and
  labelled with the checkpoint it holds. Nodes compare it with the latest
  committed one to know they are behind (`rendering.md`, "Freshness").
- **The event outbox** (story 171): a page or media change records what it
  announces in `content_event`, inside its own transaction.
  `createContentDispatcher` (`server/src/content-dispatch.ts`) turns each event
  into webhook deliveries and change notifications, then marks it dispatched,
  in one transaction. The queues' unique keys make a repeat harmless. Cache
  instructions are a separate broadcast log that every node reads. They are
  written in the same transactions and pruned after a day.
- **Lock abstraction** (`data/locks`): named write locks around content-tree
  mutation. SQLite → WAL plus a single-writer queue; Postgres → an in-process
  queue in front of a transaction-scoped advisory lock. Every document, media
  and member write takes its tree's lock (content, media, member), as every
  Umbraco content-service write does, and reads the node it acts on inside it.
  Waiters queue in-process, so a node keeps at most one pooled connection
  blocked on each advisory lock; without that, a pool full of waiters left the
  holder no connection to work on. A wait is bounded by
  `CROMBOLO_LOCK_TIMEOUT_SECONDS` (15s) both in-process and as Postgres's
  `lock_timeout`; a deadlock outside any enclosing transaction is retried once.
  Contention that outlasts that (`data/busy`) is answered by the Management API
  as 503 with `Retry-After`, never a 500. Story `081`; the load test is
  described in `testing.md`.
- **Background jobs** (`core/jobs`): interval scheduler for version cleanup,
  scheduled publishing, temporary-file cleanup, log scrubbing, keep-alive.
- **Problem details**: RFC 7807 responses and the `Umb-Notifications` header
  convention the backoffice reads for toast messages.

## Toolchain

| Tool                   | Version  | Why                                                                                                                                                                             |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun**                | ≥ 1.3    | runtime, test runner, bundler and package manager — the whole build; built and tested against 1.4.2                                                                             |
| **TypeScript**         | ^7.0     | typecheck only (`tsc --noEmit`)                                                                                                                                                 |
| **Biome**              | ^2.5     | format and lint, one tool, one config                                                                                                                                           |
| **openapi-typescript** | **^6.7** | generates `contracts/generated/` from the vendored contract — see below                                                                                                         |
| **LogTape**            | ^2.3     | the server's logging: message templates with properties, as Serilog's, written as Serilog's compact JSON for the log viewer — zero dependencies of its own                      |
| **Docker Compose**     | v2       | supplies Postgres for the test suite, runs the stack and the test suites in containers — `oven/bun:1-alpine`, `postgres:18-alpine` and Playwright's image for the browser suite |

Docker is optional: it supplies Postgres for the test suite and can run the stack,
but `bun test` against SQLite needs nothing but Bun. Nothing in the build, test or
run path needs Node, npm scripts, or .NET/NuGet.

### Why openapi-typescript is held at v6

TypeScript 7 is the native port, and its package no longer exposes the JavaScript
compiler API:

```js
// typescript@7.0.2 package.json
"exports": { ".": "./lib/version.cjs", "./unstable/ast": …, … }
```

The main entry now provides `version` and `versionMajorMinor` and nothing else, so
any tool reaching for `ts.factory` fails. `openapi-typescript@7` builds its output
as a TypeScript AST and dies with `Cannot read properties of undefined (reading
'createKeywordTypeNode')`.

**v6 emits strings and has no `typescript` dependency at all**, so TypeScript's
version is irrelevant to it. The output shape is compatible with everything
`packages/contracts/src/types.ts` consumes — `responses[200].content['application/json']`
is identical between the two majors — and generation takes ~50 ms.

The trade-off is that v6 is superseded. Its output omits the `parameters` and
`requestBody` placeholder members v7 emits for operations that have none, which is
harmless for `ResponseOf`/`RequestOf`/`ParamsOf` today but is the thing to check
first if a future need seems to hit a gap. The alternative, when it matters, is a
small emitter of our own rather than reintroducing a second TypeScript.
