# 174 — Renderers know which published changes they serve

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** L
**Depends on:** 011, 120

## Story

As someone operating several renderer nodes, I want to know which committed
published changes each node serves, so that I can detect stale content and
reload it consistently.

## Context

The architecture review scored published-content consistency **3.5/5**.
Version events, historical values, per-culture published references and
transactional cache instructions already exist.

`packages/render/src/published-cache.ts` uses a local generation counter to
share builds and stop older builds replacing newer ones. Its snapshot has no
durable content checkpoint. It loads documents, domains, languages, dictionary,
media, redirects and elements through separate reads. A local generation does
not prove those reads represent one coherent state or that another node has
caught up to a committed change.

The candidate is an explicit consistency contract and durable checkpoint. An
identifier allocated before commit is not automatically a safe committed
high-water mark; overlapping transactions must be accounted for.

## Decisions (2026-10-22)

- **A checkpoint counter moved inside each transaction.** One row,
  `content_checkpoint`, is incremented (`UPDATE … SET n = n + 1 RETURNING n`)
  inside every transaction that changes something a snapshot reads. The row stays
  locked until that transaction commits, so on both dialects checkpoint order is
  commit order: nothing can commit later with a smaller number. The latest
  committed checkpoint is therefore a safe high-water mark. Cache instructions
  carry the checkpoint and are only a wake-up. The cost is accepted: changes to
  published content commit one at a time across kinds (pages already do, under
  the tree lock).
- **One consistent read per build.**
  - *Postgres:* a `REPEATABLE READ, READ ONLY` transaction that reads the
    checkpoint first, then every source.
  - *SQLite:* a separate read-only connection, in one read transaction, which
    WAL makes a true snapshot. Builds never block writers and never see another
    request's uncommitted rows, as they can today on the shared connection.
  - A snapshot is labelled with exactly the checkpoint it read. It can be older
    than the newest, but never newer than its data.
- **Every write a snapshot reads moves the checkpoint**, inside its own
  transaction: pages (delete included), media (tree changes included),
  elements, domains (from the API and `domains.toml`), dictionary, redirects
  (tracked redirects join the publish's transaction), languages, URL settings,
  schema sync, imports and reverts.
- **Freshness is visible.**
  - Each node records in its `server` row the checkpoint it serves and when it
    built it.
  - `/health` reports the served checkpoint, the latest committed one and
    whether the node is behind. These are numbers and times only, never content.
  - The Servers health check warns when a node has been behind for more than a
    minute.
  - `crombolo cache rebuild` waits, within a bound, until every live node
    reports the new checkpoint, and says which did not.
- **Not chosen:** coalescing concurrent builds, which is left to story 175.

## Findings (2026-10-22)

- **`PublishedCache`** (`render/src/published-cache.ts`):
  - It keeps an in-memory generation and no checkpoint.
  - `invalidate()` makes the next read do a full rebuild.
  - Builds read ten sources one after another on the pool: published pages,
    domains, languages, the dictionary outline and entries, media, redirects,
    elements, type aliases and URL options. Nothing ties those reads to one
    state.
  - An older build never replaces a newer one, but every invalidate-then-read
    starts another full build. 25k pages × 3 cultures takes 1.28 s on SQLite
    and 1.04 s on Postgres (`docs/testing.md`).
- **The poller** (`server/src/schema.ts`):
  - It starts from `MAX(id)` and reads 100 ids behind its cursor (added in
    v0.24.0, untested).
  - It permanently skips a row that commits more than 100 ids late, or any id
    at or below its starting point that commits after boot. Long imports and
    schema syncs are the likely cases.
  - It records its position nowhere. Every instruction other than a
    components one causes a full invalidate, and the payload is ignored.
- **Writes that tell no other node:**
  - dictionary edits;
  - redirect deletes, and tracked redirects, which are written after the
    publish has committed and instructed, so another node can rebuild in
    between and miss them;
  - page deletes;
  - languages, which only reach other nodes through a schema-file sync.

  Elements, API domains, URL settings and media tree operations instruct after
  their change, outside its transaction. The `domains.toml` apply instructs
  without saying which node did it.
- **SQLite** is one connection per process with a transaction gate. A build
  can read another async chain's uncommitted rows, and an instruction written
  outside a transaction can land inside someone else's. The command line opens
  its own connections, so SQLite sites are multi-process too.
- **Published pages and elements are not read as of the node's schema state**
  (`adapters/documents.ts` calls `loadPublished()` without
  `asOfSchemaStateId`), unlike media.
- **Doc drift:** `docs/rendering.md` says invalidation happens inside the unit
  of work, but it happens after commit. `docs/schema-as-code.md` describes the
  poller without its window.
- **The `server` row** holds release and schema facts only. `/health` reports
  the views snapshot's generation (`snapshots.status()`), which is the
  precedent to follow. `crombolo cache rebuild` cannot tell whether any node
  applied its instruction.
- **Node ids** default to `host:pid`, so they are not stable across restarts
  unless `CROMBOLO_NODE_ID` is set.

## Plan

1. **Characterise.** Tests that fail today:
   - a late commit skipped by the poller (more than 100 ids behind, and at or
     below the starting point);
   - a build reading another chain's uncommitted rows on SQLite;
   - a dictionary or redirect change never reaching a second node;
   - a build mixing two states when a change commits part way through it.
2. **Migration (next release).**
   - A `content_checkpoint` table: one row, `n`.
   - A `checkpoint` column on `cache_instruction`.
   - `served_checkpoint` and `served_at` on `server`.
3. **Moving the checkpoint.** `advanceCheckpoint(tx, kind, payload, by)` in
   `data/src/cluster.ts` increments the row and writes the instruction in the
   caller's transaction. `appendCacheInstruction` becomes that, and refuses to
   run outside a transaction. Every writer named above is moved inside its
   transaction:
   - elements, API domains, URL settings and media tree operations through
     their repositories' transactions;
   - the dictionary and redirect repositories gain the call;
   - the redirect tracker's commit joins the publish's transaction through
     the operations' `commit`;
   - page delete gains one;
   - the `domains.toml` apply names its node;
   - language saves move the checkpoint when their schema sync applies.
4. **Consistent builds.**
   - `PublishedContentSource` gains `withSnapshot(fn)`. It opens the read
     transaction (the Postgres isolation level, or the SQLite read connection,
     a second `Database` opened read-only on the same file) and hands the
     loaders a reader bound to it, with the checkpoint read first.
   - `CacheSnapshot` carries `checkpoint` and `builtAt`.
   - The cache installs a build only if its checkpoint is newer than the one
     served, replacing the generation comparison for what is served. It keeps
     the generation for "has an invalidation happened since".
   - Published pages and elements are read as of the node's schema state.
5. **Applying instructions.**
   - The poller drops the id window. It reads the latest committed checkpoint,
     and invalidates if it is newer than the snapshot served.
   - Instructions only wake it, and `LISTEN` stays.
   - Because the checkpoint is commit-ordered, a late commit cannot be missed:
     it carries a higher number than anything already committed.
   - The writing node invalidates its own cache after commit, as now; its
     snapshot label shows whether it caught up.
6. **Diagnostics.**
   - `touchServer` writes `served_checkpoint` and `served_at`.
   - `/health` gains `content: { checkpoint, latest, behind, builtAt }`.
   - The Servers check warns when a live node has served an older checkpoint
     than the latest for more than 60 seconds.
   - `crombolo cache rebuild` waits up to 30 seconds (`--wait`) for every live
     node, then lists those behind.
7. **Story 121's hook.** The source takes an optional `atLeast(checkpoint,
   deadline)`. A replica reader polls the replica's `content_checkpoint` until
   it reaches the required one, or falls back to the primary at the deadline.
   It is documented and tested with a stub; replicas themselves stay in 121.
8. **Benchmarks.** `large-site.bench.ts` measures the snapshot transaction's
   cost against today's 1.28 s / 1.04 s. The writer queueing on the checkpoint
   row is measured under `tests/load/concurrency.load.ts`.
9. **Docs.** `docs/rendering.md` and `docs/schema-as-code.md` get the
   consistency contract, freshness, failure behaviour and the difference
   between content checkpoints and schema revisions. `docs/operations.md` gets
   the diagnostics and the stable `CROMBOLO_NODE_ID` advice. The README gets
   a pointer.

Tests on SQLite and Postgres cover:

- overlapping commits on two connections;
- an invalidation during a build;
- delayed instruction delivery;
- a restart, which picks up from the checkpoint;
- an older build finishing last;
- every writer moving the checkpoint;
- the snapshot never labelled newer than its data.

## Acceptance criteria

- [x] Snapshots identify the durable checkpoint whose changes they contain,
      with semantics valid across restart and renderer nodes.
- [x] Every included source follows the consistency contract; a snapshot cannot
      label older data with a newer checkpoint.
- [x] Tests cover overlapping commits, invalidation during builds, delayed
      instruction delivery, restart and older builds finishing last.
- [x] Instruction processing cannot permanently skip a late-committing change
      or report a node current while it serves older content.
- [x] Diagnostics expose the applied checkpoint and available freshness facts
      without exposing private content or implying unavailable information.
- [x] The source interface supports story 121 waiting for a replica to reach
      the required checkpoint or falling back to the primary within a bound.
- [x] SQLite and Postgres tests cover correctness; existing large-site benchmarks
      measure the cost of the chosen consistency approach.
- [x] README and architecture docs explain freshness, failure behavior and the
      distinction between content checkpoints and schema revisions.

## What was built

- **Migration 047 (`AddContentCheckpoint`, 0.25.0).** It adds
  `content_checkpoint(id, n)`, `cache_instruction.checkpoint`, and
  `server.served_checkpoint` / `served_at`. All four rewinds are updated:
  `tests/support/db.ts`, `tests/upgrade-from-release.test.ts`,
  `tests/permissions.test.ts` and `tests/integration/first-boot.integration.ts`.
- **Moving it.**
  - `appendCacheInstruction` (`data/src/cluster.ts`) runs in a transaction,
    joining the caller's when it has one. For `content` and `schema` kinds it
    upserts the checkpoint row, which holds the row to commit, and stamps the
    instruction. It answers the checkpoint; views instructions answer null.
  - It is an upsert because the Postgres test harness truncates tables between
    tests and took the seed row with it. An `UPDATE` then counted nothing and
    locked nothing.
  - Changes that now move it:
    - page delete, inside the transaction;
    - dictionary create, update, move and delete, inside the transaction;
    - dictionary import, just after;
    - redirect delete, inside the transaction;
    - tracked redirects, through the tracker's `instruct`.
  - Everything that instructed before still does, now numbered. A caller
    outside a transaction moves it just after its change, never before.
- **Reading consistently.**
  - `Db.readSnapshot`:
    - on Postgres, a `REPEATABLE READ, READ ONLY` transaction;
    - on a SQLite file, a lazily opened read-only connection with its own
      queue, in one `BEGIN`…`COMMIT`;
    - in memory, a transaction on the one connection.
  - `PublishedContentSource.withSnapshot` reads the checkpoint, then hands the
    build a source bound to the reader.
  - `CacheSnapshot` carries `checkpoint` and `builtAt`, and `PublishedCache.served()`
    reports them. A build with an older checkpoint is never installed over a
    newer one.
  - The URL-settings redirect capture keeps its old setting inside the
    snapshot.
- **Applying.**
  - `CacheInstructionPoller` takes `content: { served, behind }`. Each poll
    reads the latest checkpoint, and calls `behind` when it is past the one
    served, again after 30 seconds if not yet served.
  - The server's `behind` invalidates and rebuilds at once, so idle nodes
    catch up.
  - Content and schema instructions only wake the poll. Views instructions are
    still applied from the id window.
- **Diagnostics.**
  - `touchServer` records the served checkpoint.
  - `/health` gains `content: { checkpoint, latest, behind, builtAt }`.
  - The Servers health check lists what each node serves and warns after a
    minute behind (`freshnessResults`, `changedSince`).
  - `crombolo cache rebuild --wait <s>` (30 by default) waits for every live
    node and returns `checkpoint` and `behind`.
- **Story 121's hook.** `waitForCheckpoint(db, checkpoint, timeoutMs)` lets a
  reader that may lag catch up to a checkpoint, or report that it did not in
  time.
- **Tests** (`tests/content-checkpoint.test.ts`, both dialects):
  - writers move the checkpoint, and a rollback or a views change does not;
  - overlapping commits on two connections commit in checkpoint order;
  - a read snapshot does not see a later commit;
  - SQLite's read connection never waits for a writer and never sees
    uncommitted rows;
  - the cache labels its snapshot;
  - an older build finishing last does not win;
  - a change whose instruction was lost is still caught, and the node records
    what it serves;
  - `/health`, the Servers warning and `waitForCheckpoint`.
- **Docs:** `docs/rendering.md` ("Freshness: the content checkpoint", replacing
  an inaccurate claim about invalidating inside the unit of work),
  `docs/schema-as-code.md`, `docs/operations.md` ("Is every node serving the
  latest content?", stable `CROMBOLO_NODE_ID`), `docs/architecture.md` and the
  README.
- **Not changed:**
  - Builds are not coalesced (story 175), and replicas are story 121.
  - Published pages and elements are still read without an as-of schema state.
    Reading them as of the node's state hid every value a newer node saved, not
    only converted ones, so an older node stopped seeing new publishes during an
    upgrade (`tests/schema-boot.test.ts`). The finding stands for a story of its
    own: it needs conversions told apart from edits.

## Out of scope

Implementing replicas, globally linearizable reads on every visitor request,
or requiring a distributed cache service.
