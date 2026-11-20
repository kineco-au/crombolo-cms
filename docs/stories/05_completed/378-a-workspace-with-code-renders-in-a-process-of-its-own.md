# 378 — A workspace with code renders in a process of its own

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** L
**Depends on:** 377

## Story

As the person running a site, I want unfinished code in a workspace to run apart from
the process serving visitors, so that a template somebody is halfway through cannot slow
or stop the site.

## Context

`377` lets a workspace change components. Each save loads a new copy of the modules it
renders, and nothing unloads the old ones. A half-written template can also hang or
crash. In the process that serves the site, either is a risk to every visitor, and
workspaces may be on for a live site.

## The design

- **One child process per workspace that has changed files,** on each node that is asked
  for it, started on the first request and given that request.
- **A workspace with no changed files** needs none: it renders in the node's own process
  from the site's own files.
- **Recycled** when idle for a set time, when its memory passes a limit, and when the
  workspace is merged or discarded.
- **Contained:** a crash or a hang in it answers that request with an error naming the
  workspace, and touches nothing else. It is given a time limit per render.
- **A limit on how many run at once** per node. Over it, the least recently used is
  stopped. The limits are settings.
- **It reads what the node reads:** the same database, the workspace named on its
  connection's reads, and its own view of the published cache, which is Shared's plus
  the workspace's changes.
- **It writes nothing of the site's own:** saves go through the node, as now.

## Decisions (settled 2026-11-20)

- **A Bun child process** (`Bun.spawn`) per workspace with changed files, speaking the
  extensions' framed channel (`extension-process.ts`, `@crombolo/extension/channel`). A
  crash, a hang or its leaked modules end with it; its memory is read per process.
- **Its own read connection.** It opens a read-only connection to the site's database,
  naming the workspace on its reads, and builds its own published cache (Shared's plus
  the workspace's) when first asked. It writes nothing; saves still go through the node.
  On SQLite the file is opened read-only alongside the node's, in WAL.
- **Generous defaults,** each a setting: at most 10 processes per node
  (`CROMBOLO_WORKSPACE_PROCESSES`), stopped after 30 minutes idle
  (`CROMBOLO_WORKSPACE_PROCESS_IDLE_MINUTES`), over 1 GB
  (`CROMBOLO_WORKSPACE_PROCESS_MEMORY_MB`), and 30 seconds per render
  (`CROMBOLO_WORKSPACE_RENDER_SECONDS`).
- **Everywhere, development included.** Once this lands, a workspace with changed files
  always renders in its process, and `377`'s in-process trees and their budget
  (`CROMBOLO_WORKSPACE_VIEWS_LIMIT`) go.

## Acceptance criteria

- [x] **A workspace with a changed component** is rendered by a process of its own.
- [x] **An endless loop in a workspace's template** times out, and pages of Shared are
      served throughout.
- [x] **A crash** in it is reported against the workspace, and the next request starts
      it again.
- [x] **Idle, over its memory limit, merged or discarded,** the process ends.
- [x] **Over the limit on processes,** the least recently used ends.
- [x] **A workspace without changed files** starts no process.
- [x] **Tests;** `docs/` says what the limits are and how to set them.

## Built (2026-11-20)

- **`workspace-processes.ts`:** one Bun child per workspace that changed a view, started
  at its first render; `rendererFor` gives the workspace's site a renderer that resolves
  the page and settles access on the node, then has the process render it by key
  (published, or its draft for a preview); everything else is Shared's renderer's. Over
  its time or on a crash the render answers an error naming the workspace and the
  process is stopped; a sweep stops it idle, over its memory (reported every two
  seconds) or past the node's limit; a merge, discard or the server's close stop it.
- **`workspace-render-child.ts`:** opens its own connection, builds the workspace's
  published cache and its views tree (`createWorkspaceViews`, now only the child's), and
  renders with site search; it writes nothing.
- **Settings:** `CROMBOLO_WORKSPACE_PROCESSES`, `CROMBOLO_WORKSPACE_PROCESS_IDLE_MINUTES`,
  `CROMBOLO_WORKSPACE_PROCESS_MEMORY_MB`, `CROMBOLO_WORKSPACE_RENDER_SECONDS`;
  `CROMBOLO_WORKSPACE_VIEWS_LIMIT` is gone.
- **Departures from the plan:** messages go over Bun's own IPC rather than the
  extensions' framed channel, which carries no more than plain values here either; and
  the connection is an ordinary one, which the child never writes through. A database
  in memory cannot be opened from another process, so there (the SQLite unit tests) a
  workspace renders on the node as before; the story's own tests use a file.
- **Not carried to the process:** a page's actions and signed deferred parts, which need
  the node's secrets and services.
- **Tests:** `tests/workspace-processes.test.ts`, on both dialects.
