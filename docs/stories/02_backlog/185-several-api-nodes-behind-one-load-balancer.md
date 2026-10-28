# 185 — Several API nodes behind one load balancer

**Epic:** M — Running at scale · **Priority:** should · **Size:** L
**Depends on:** 176

## Story

As someone running a site on several nodes, I want to run more than one node
in the `api` role at once behind an ordinary load balancer, so that the back
office and every write keep working when a node fails or is replaced, and I can
add capacity for editors and integrations the way I already can for visitors.

## Context

`CROMBOLO_ROLE` is `all`, `api` or `web` (`server/src/config.ts`,
`SERVER_ROLES`). `web` nodes serve the public site and scale out freely; `api`
and `all` serve the back office and the Management API and are the nodes that
"own" the site at boot (`owns` in `server/src/server.ts`): they bootstrap the
database, sync the schema, mount bundles' server halves and run the background
jobs. Splitting roles already needs Postgres (`docs/configuration.md`). The
documented and tested topology is one owning node plus any number of `web`
nodes; nothing refuses a second `api` node, but nothing proves it safe either.

Much of the coordination is already in the database rather than in a process,
and should carry over unchanged:

- **The write gate** (`assertNodeMayWrite`, `data/src/schema-state.ts`) runs
  inside every editor write transaction and reads the schema state and the
  pause flag there, so it is correct on any number of writers.
- **Content-tree locks** (`data/src/locks.ts`) are an in-process queue in front
  of `pg_advisory_xact_lock`, so writes on different nodes serialise.
- **Migrations** (`migrate`, `data/src/migrations.ts`) run under the
  `KeyValues` lock, and production boot refuses pending steps outright
  (`UpgradePendingError`, `server/src/database.ts`): `crombolo upgrade` runs
  them, once.
- **Background jobs** (`server/src/jobs.ts`) claim each schedule and queued item
  atomically, so a job running on two nodes still does each piece of work once
  (story 171's outbox; `docs/forms.md`).
- **Sessions and tokens** live in the database (`auth/src/store.ts`); external
  sign-in flow state and preview and form tokens are signed with secrets held in
  the database, so a request can land on any node with no sticky sessions.
- **Temporary uploads** go to the media store, not local disk
  (`server/src/media-files.ts`), when the store is shared.
- **Cache instructions** are a broadcast log every node polls, woken by
  `LISTEN`/`NOTIFY` on Postgres (`CacheInstructionPoller`,
  `server/src/schema.ts`), and each node records itself in `server`
  (`liveNodes`, `data/src/cluster.ts`).

What still assumes one owning node:

- **A runtime schema change drains the other API nodes.** A schema import
  (`/crombolo/api/schema-import`, or a content-type save through the back
  office) advances the schema state and refreshes *that* node's state in place
  (`docs/schema-at-runtime.md`). Every other `api` node's poller then finds
  itself behind, answers 503 on `/health` and has its writes refused by the
  write gate until it is restarted. That is right after an upgrade, when the
  code is older; it is wrong for a peer running the same code whose only gap is
  files it has not re-read.
- **Live updates reach only the node they happened on.** The back office's
  event hub (`server/src/server-events.ts`) broadcasts to sockets on its own
  process: a document changed, a bundle reloaded (`BUNDLES_CHANGED_EVENT`) or a
  job's outcome on one node is never heard by an editor connected to another.
- **Some request state is held in memory.** Branch publishing's task
  (`branchTasks`, `api-management/src/handlers/document.ts`) is looked up on the
  node that started it, so a status poll routed elsewhere is not found. The
  setup and host-token `AttemptLimiter`s (`server/src/setup.ts`,
  `server/src/server.ts`) count per process, so N nodes allow N times the
  attempts.
- **Files written by the back office are local unless shared.** Templates
  under `componentsDir` (the views snapshot announces a hash, but the bytes are
  on the node that saved them, `docs/rendering.md`), the schema directory
  without a schema store, and Marketplace installs into `node_modules`
  (`runtimeInstalls`, which is already off when a schema store is configured
  because "an install there reaches one node"). `reloadBundles()` reloads only
  the node it is called on.
- **First boot on an empty database.** Seeding (`installDatabase`) runs after
  migration and is idempotent, but concurrent first boots of several owning
  nodes have never been exercised.
- **The development watcher** re-syncs schema files on change; it is development
  only and must stay that way.

Story 176 decides which processes run jobs and who owns migration and readiness
per role; this story builds on those answers rather than inventing a second set.

## Acceptance criteria

- [ ] Two or more `api` nodes on one Postgres database serve the back office and
      Management API behind a round-robin load balancer with no session
      affinity: sign-in, save, publish, media upload then save, preview and
      sign-out each succeed when consecutive requests land on different nodes.
- [ ] Concurrent first boots of several owning nodes against an empty database
      produce one install: one administrator or API client, one set of built-in
      types, one ledger entry per migration step.
- [ ] Production boot behaviour is unchanged: pending migrations are still
      refused at boot and run once by `crombolo upgrade`; a concurrent second
      upgrade waits on the lock and finds nothing to do.
- [ ] A runtime schema change made on one `api` node is picked up by the other
      `api` nodes running the same code version, which follow it (re-read the
      schema and refresh their state) instead of draining; a node behind on
      *code* version still drains as it does today.
- [ ] Each scheduled job and queued item runs once across all owning nodes,
      including a node killed mid-claim, using story 176's claim and recovery
      rules.
- [ ] Back-office live updates — document changes, bundle reloads, job outcomes
      — reach editors connected to any `api` node, through the cache instruction
      log or an equivalent database broadcast.
- [ ] No request-scoped state that a later request may need is held only in
      process memory: branch publishing's task status, and anything else found,
      can be read from any node.
- [ ] Attempt limits for setup and host tokens hold across the cluster, not per
      node.
- [ ] Template, schema and bundle changes made through the back office reach
      every `api` node, or the feature is refused with a clear message when the
      storage it needs is not shared — the way `runtimeInstalls` is today.
      `reloadBundles()` on one node is either fanned out or documented as the
      host's job to call on every node.
- [ ] `/health` and `liveNodes` report each `api` node's state so a load
      balancer drains only the node that cannot save, never the healthy set.
- [ ] Multi-API is **Postgres only**. Starting a second owning node on SQLite is
      refused at boot with a message naming the setting, and single-node SQLite
      behaviour is unchanged; the SQLite suite covers both.
- [ ] Tests run two or more owning nodes in one test process against Postgres
      (PGlite where it can stand in, a real server where `LISTEN`/`NOTIFY` or
      advisory locks need it) for each criterion above, and the existing `all`
      and `api` + `web` suites stay green on both dialects.
- [ ] `docs/operations.md` ("Running a cluster") and `docs/configuration.md`
      describe the topology, what must be shared between `api` nodes (database,
      media store, schema store, components), and what each node needs set
      identically (`CROMBOLO_SECRET_KEY`, bundles, code version).

## Open questions

- **How a node knows it is one of several.** Infer it from `liveNodes`, require
  an explicit setting, or behave as if always clustered when the role is `api`?
  Inference changes behaviour when a second node appears; a setting can be
  forgotten.
- **Follow or leader.** Should a peer follow a runtime schema change by
  re-materialising and importing the same files itself, or should one node apply
  it and the others only reload their in-memory view? The second is simpler if
  the schema state already carries everything a peer needs.
- **Does anything need a leader at all?** Jobs, migrations and installs are
  already claim- or lock-based. A leader (an advisory lock held for the
  process's life) would only be worth it for singleton work that cannot be
  claimed row by row; list any before adding one.
- **Shared components.** Is a mounted shared directory enough for templates, or
  do they need a store like the schema store? Until then, should template editing
  be refused on a multi-API site without shared storage?
- **Cluster-wide limits.** Move `AttemptLimiter` into the database, or accept
  per-node counting and divide the limits by the node count?
- **Rolling replacement.** During a rolling deploy, old and new `api` nodes
  write side by side on an expand-only change. Is the existing expand/contract
  rule (`docs/packaging-and-upgrades.md`) sufficient for writers, or only for
  readers as it is proven today?

## Out of scope

- Active-active across regions or databases; one primary database remains the
  single source of truth.
- Reading from replicas on `api` nodes (story 121 covers `web` nodes).
- Provisioning load balancers, shared storage or orchestration.
