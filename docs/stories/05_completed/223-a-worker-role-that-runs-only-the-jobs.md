# 223 — A worker role that runs only the jobs

**Epic:** M — Running at scale · **Priority:** could · **Size:** L
**Depends on:** 187

## Story

As someone running a site on several nodes, I want a node whose only work is
the background jobs, so that a long import or a nightly export never competes
with editors on the api node or visitors on the web nodes.

## Context

`CROMBOLO_ROLE` is `all`, `api` or `web` (`server/src/config.ts`,
`SERVER_ROLES`). Jobs start on a node that owns writes (`owns` in
`server/src/server.ts`): core's own queues, and since `187` the site's and its
bundles' jobs and schedules. That node is also the back office, so a
100,000-row import shares a process with every editor's save.

Everything a second consumer needs is already in the database. `187`'s queue
claims each job and each schedule's occurrence atomically, releases a job whose
node dies and runs a missed occurrence once; `171`'s outbox does the same for
core's work. What is missing is a process that boots to consume and nothing
else.

Where such a node runs, and whether a deployment has one, is the deployment's
decision; this story gives it the role.

## Decided

- **A fourth role, `worker`.** It opens the database, runs the schema check an
  owning node runs, mounts the site's code and bundles' server halves so their
  job handlers exist, and starts the job runners. It serves no pages, no back
  office and no Management API: the diagnostics port alone, so a health check
  and the troubleshooting report work as on any node.
- **An owning node can be told to leave jobs alone.** `CROMBOLO_JOBS=off` on an
  `api` or `all` node stops it starting the runners, so a deployment with a
  worker has one consumer. Queueing is unaffected: a route on any node can
  still enqueue. The default is unchanged, so a single-process site and today's
  api-plus-web topologies behave as they do now.
- **A worker is a writer.** It records itself in `server` with its role, is
  held by the write gate like an owning node, and is drained by a schema change
  as an owning node is. It needs Postgres, as every split role does.
- **A worker never migrates.** Pending migrations are refused at boot as in
  production today; `crombolo upgrade` runs them, once.
- **Stopping releases.** A worker stopping finishes or releases its running
  job within the runner's grace, as an owning node does; the job runs again on
  whoever claims it next, once.

## Decisions (2026-10-30)

1. **A worker answers `/health` alone, on `PORT`; any other path gets no
   answer.** The answer carries the role, the schema state, whether it is
   behind or paused, and the runner's state: the job it is running and its last
   claim. An orchestrator probes it as it probes any node. The troubleshooting
   report is `crombolo health` against the database, which already works for
   any node, so the worker has no Management API route. Not chosen: the report
   over HTTP too, which brings sign-in onto a node with no users; no HTTP at
   all, which platforms that probe only over HTTP cannot check.

2. **The worker builds the published cache and the renderer for e-mail, and
   mounts no route to a page.** Form-workflow e-mails and content notifications
   render through the site's components, so they look the same from whichever
   node sends them; a site job's `site()` reads the published cache, which is
   built when a job first asks, so a worker whose jobs never read content holds
   no snapshot. No page, back office, Management API or Delivery API route is
   mounted. Not chosen: leaving those e-mails on the `api` node, which keeps a
   consumer there after `CROMBOLO_JOBS=off`; plain-text e-mails from the
   worker, which would change a site's e-mails by the node that sent them.

3. **With jobs off, a save records its work and wakes the worker with a
   `NOTIFY`.** The writing node no longer dispatches the outbox or indexes
   search itself; it sends a `NOTIFY` on a jobs channel, as cache instructions
   already do (`cluster.ts`), and the worker runs the dispatch and the indexing
   at once. Webhooks and search stay as quick after a save as they are now; the
   worker's poll is the fallback for a notification it missed. Not chosen:
   dispatching at commit as now, which keeps bundle event handlers and indexing
   on the editor's node; waiting for the poll, which lags a webhook or a search
   by up to fifteen seconds.

4. **No worker running is reported, and drains nothing.** Work queues safely
   and runs when a worker starts. When jobs are off and no live worker has been
   seen in `server` for five minutes, `/health` on `api` and `all` nodes stays
   200 and reports it (`jobs: { here: false, worker: null }`), the Background
   jobs screen warns that background work is waiting with nothing running it,
   and the log warns once when the gap begins. Not chosen: a 503 from the api
   nodes, which turns a stopped worker into an outage for editors; silence,
   which lets a scheduled publish quietly not happen for hours.

5. **The worker is its own composition, on a core extracted from
   `server.ts`.** What every node needs (the database and schema check, the
   site's code and bundles, the published cache, document operations, e-mail
   and its rendering, the outbox, the job runners and `/health`'s state) moves
   into a shared core. `createServer` builds the core and adds the back office,
   the APIs and the site; `createWorker` builds the core and answers `/health`.
   Not chosen: one table of duties per role inside `server.ts`, which keeps
   every role in one composition; `role === 'worker'` checks where needed,
   which spreads the role logic further. This makes the story an L.

6. **A lint rule keeps the core and the worker clear of the editor's and the
   site's halves.** Biome's restricted imports, on the core's and the worker's
   files, refuse `@crombolo/api-management`, `@crombolo/api-delivery`,
   `@crombolo/backoffice-host` and the page router. It sees direct imports
   only, so the core is kept to files of its own rather than shared helpers
   that reach further. Not chosen: an import-graph test, which also catches
   indirect imports at the cost of a build in the unit tests; no check beyond
   the role tests, which would not notice a worker loading the Management API
   without mounting it.

## Plan

1. **Extract the core** (`packages/server/src/core.ts`): the database and
   schema check, bundles and grants, the site's code and tables, the published
   cache (built when first asked), document operations, e-mail and its
   renderer, the outbox and dispatcher, both job runners, the node's `server`
   row and `/health`'s state. `createServer` builds it and adds the rest; no
   behaviour changes, proven by the full suites before anything else moves.
2. **`worker` role and `CROMBOLO_JOBS`** in `config.ts`: the role in
   `SERVER_ROLES`, Postgres only; `CROMBOLO_JOBS=off` accepted on `api` and
   `all`, refused on `web` and `worker`.
3. **`createWorker`** (`packages/server/src/worker.ts`): the core, the runners
   started, a fetch handler answering `/health` alone, pending migrations
   refused, stopping within the runners' grace. `crombolo start` boots it for
   the role.
4. **Jobs off on a writer:** the runners not started; the dispatcher and the
   search indexer record and `NOTIFY` a jobs channel instead of running; the
   worker listens and runs them, its poll the fallback.
5. **No worker seen:** `/health`'s `jobs` block, the Background jobs screen's
   warning, one log warning per gap.
6. **The lint rule** on the core's and the worker's files.
7. **Tests**, on Postgres: what a worker mounts and starts; `CROMBOLO_JOBS`
   accepted and refused; one `api` node with jobs off and one worker running
   every job, schedule, delivery and index once, including a worker killed
   mid-claim and restarted; a save waking the worker; the warning with no
   worker; the write gate and refused migrations.
8. **Docs:** `docs/configuration.md` (the role, `CROMBOLO_JOBS`),
   `docs/operations.md` (the api, web and worker topology and what each node
   needs), the README's architecture note, release notes.

## Acceptance criteria

- [x] `CROMBOLO_ROLE=worker` boots, runs core's, the site's and its bundles'
      jobs and schedules, and answers on the diagnostics port; the back office,
      the Management API, the Delivery API and page routes are not mounted, and
      a request for a page gets no answer from it; e-mails render through the
      site's components as on any node.
- [x] `CROMBOLO_JOBS=off` on an `api` or `all` node leaves every job to a
      worker, while its routes can still enqueue; on a `web` or `worker` node
      it is refused as meaningless.
- [x] With one `api` node and one worker on one database, every job and every
      scheduled occurrence runs exactly once, including when the worker is
      killed mid-claim and restarted; both engines where split roles are
      supported, so Postgres.
- [x] The worker is in `server` with its role, is held by the write gate, and
      refuses pending migrations at boot as an owning node does.
- [x] Role tests cover what the worker starts and what it does not, beside the
      existing tests of `api` and `web`.
- [x] `docs/configuration.md` lists the role and `CROMBOLO_JOBS`;
      `docs/operations.md` shows the api-web-worker topology and what each node
      needs.

## Out of scope

More than one worker, choosing which jobs a worker takes, a worker that
migrates, and anything about where workers are placed or priced.

## What was built

- **The core** (`packages/server/src/core.ts`, `createCore`): everything every
  node needs, extracted from `createServer` in the order it boots:
  - the database and schema, the site's tables, bundles and their grants;
  - the published and media caches, the views and the renderer;
  - e-mail, the media store, webhooks, the outbox and its dispatcher;
  - the document and media operations, the server bundles and the site's
    services;
  - both job runners.
  What only a serving node has (live reload, drafts, the event hubs, member
  files) comes in through `CoreHooks`.
- **Operations built once** (`node-operations.ts`, `createNodeOperations`):
  document and media operations, approvals and redirect tracking. The
  Management API (`createDeps`), the jobs and the command line
  (`content-operations.ts`) now share them; they were wired three times.
- **`createWorker`** (`worker.ts`, also `@crombolo/server/worker`): the core and
  `/health` alone. It reports the role, the schema state and the runner's
  running job and last claim, and gives every other path a 404 with no body.
  `crombolo start` boots it for `CROMBOLO_ROLE=worker`, and refuses `--bundle`
  and `--seed` there. `createServer` refuses the role.
- **`CROMBOLO_ROLE=worker` and `CROMBOLO_JOBS`** (`config.ts`, `settings.ts`): a
  worker needs Postgres. `CROMBOLO_JOBS=off` is accepted on `api` and `all` and
  refused on `web` and `worker`; any other value is refused.
- **Waking the worker** (`job-wake.ts`, `notifyJobs` and `JOBS_CHANNEL` in
  `@crombolo/data`). With jobs off, a save, a queued job or a search queue entry
  sends a `NOTIFY`. The worker listens, and runs the outbox, the indexer or the
  runner at once. `JobRunner` gains `wake()`, `state()` and `onEnqueued`.
- **No worker running** (`worker-watch.ts`): each minute an `api` or `all` node
  with jobs off looks for a live worker in `server`. When none has been seen
  for five minutes:
  - `/health` says so in `jobs`, and stays 200;
  - the jobs list carries `waitingSince`, and Settings → Background jobs shows
    a warning;
  - one warning goes in the log.
- **The boundary** (decision 6):
  - `@crombolo/api-management/domain` and `@crombolo/backoffice-host/registry`
    export those packages without the router, the handlers or the back office.
    The server's modules import them.
  - A Biome `noRestrictedImports` override on the core's and the worker's files
    refuses the packages' roots, `@crombolo/api-delivery`, `server.ts`,
    `ports.ts` and `routes.ts`.
  - A one-off build of `worker.ts`'s whole import graph found none of the
    router, handlers, back-office shell or static serving, Delivery API,
    `server.ts` or `ports.ts`.
- **Tests:** `tests/worker.test.ts`:
  - the role and the setting, accepted and refused;
  - on Postgres, an `api` node with jobs off and a worker on one database: the
    worker answers `/health` alone, and runs what the `api` node queues once,
    woken at once;
  - a worker stopped mid-job releases it, and the next worker runs it once;
  - a job claimed by a dead node is released and run once;
  - the warning while no worker runs, cleared once one does.
