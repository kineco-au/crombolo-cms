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

- [ ] **A workspace with a changed component** is rendered by a process of its own.
- [ ] **An endless loop in a workspace's template** times out, and pages of Shared are
      served throughout.
- [ ] **A crash** in it is reported against the workspace, and the next request starts
      it again.
- [ ] **Idle, over its memory limit, merged or discarded,** the process ends.
- [ ] **Over the limit on processes,** the least recently used ends.
- [ ] **A workspace without changed files** starts no process.
- [ ] **Tests;** `docs/` says what the limits are and how to set them.
