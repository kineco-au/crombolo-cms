# 396 — A workspace process that keeps failing is reported

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 378

## Story

As someone running a site with workspaces, I want to know when a workspace's process keeps
failing, so that I can tell its owner without the site itself looking unhealthy.

## Context

A workspace that changes code renders in a child process of its own (`378`). The node
stops one that sits idle, grows past its memory or is pushed out by another, and a render
that fails answers with an error. Nothing outside the node can tell a workspace whose
process fails on every start from one that was simply stopped: the site's health is the
same either way, as it should be.

## The design

- **Each failure is recorded in the database,** tagged with the node it happened on: a
  process that exits on its own, a render that runs out of its time (the node stops the
  process, as an endless loop does), or a process that never comes up ready. A template
  that throws on one page is the page's own: it shows on that page and is not counted, nor
  is a process stopped for idling, its memory, or another workspace needing its place.
  Rows older than an hour are pruned.
- **Each node records the processes it runs** beside its failures, so the answer is the
  site's from any node; a node no longer seen (`server.last_seen`) counts as running none.
- **`GET <plugin>/api/workspaces/processes`,** needing the Settings section, by cookie or
  bearer, lists the workspaces with a running process, and those with three or more
  failures in the hour: `{ key, name, owner, nodes, failures, lastError, since }`.
- **`/health` says how many are failing,** `workspaces: { failing: n }`, naming none and
  staying 200, so monitoring can alert without signing in.
- **A log line** `workspace.process.failed` with the workspace's key, the node and the
  reason, each time.
- **The node's health is unchanged** by a failing workspace.

## Decisions (2026-11-22)

- **D1 — kept in the database,** a table of its own (a migration in the next release), so
  the route answers for every node, whichever one is asked, and a restart forgets nothing.
- **D2 — a failure is a crash, a time-out or a failed start;** a page's own error is not.
- **D3 — the Settings section reads the route;** there is no health caller, since
  `/health` is anonymous, so it carries a count and no names.

## Acceptance criteria

- [x] **A process that exits three times in an hour** is listed with its last error.
- [x] **A render over its time** counts as a failure; **a template's own error** does not.
- [x] **A process stopped for idling, memory or room** is not counted as a failure.
- [x] **Failures on one node** are listed when another node is asked.
- [x] **`/health`** counts failing workspaces and stays 200.
- [x] **A caller without the Settings section** is refused the route.
- [x] **The site's own health** stays healthy while a workspace fails.
- [x] **Each failure** writes `workspace.process.failed`.
- [x] **Tests** on both dialects; `docs/` describes the route.

## Built (2026-11-22)

- **Recorded:** migration 092 (`AddWorkspaceProcesses`): `workspace_process` (node, workspace,
  started) and `workspace_process_failure` (node, workspace, reason, when), through
  `WorkspaceProcessRepository`; failures older than an hour are pruned as new ones land,
  and a node forgets what it ran as it starts.
- **What fails:** `workspace-processes.ts` tells its `reports` of each start and stop, and
  of a failure when the process exits on its own, or a render runs over its time (worded
  as a failed start when it never said it was ready). Idle, memory, room and closing stop
  it without one.
- **The node:** `server.ts` writes the reports, logs `workspace.process.failed` on the
  `workspaces` logger, answers `GET <plugin>/api/workspaces/processes` for the Settings
  section (`workspaceProcessList`), and adds `workspaces: { failing }` to `/health`,
  counted at most every five seconds and at once after a failure here.
- **Tests:** `tests/workspace-processes.test.ts`, on both dialects.
