# 396 — A workspace process that keeps failing is reported

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
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

- **Each node counts failures per workspace:** a process that exits on its own, or fails
  a render with an error that isn't the page's own, over a sliding hour.
- **`GET <plugin>/api/workspaces/processes`** (any caller holding the Settings section, or
  the node's own health caller) lists the workspaces with a running process, and those
  with three or more failures in the hour: `{ key, name, failures, lastError, since }`.
- **A log line** `workspace.process.failed` with the workspace's key and the reason, each
  time.
- **The node's health is unchanged** by a failing workspace.

## Acceptance criteria

- [ ] **A process that exits three times in an hour** is listed with its last error.
- [ ] **A process stopped for idling, memory or room** is not counted as a failure.
- [ ] **The site's own health** stays healthy while a workspace fails.
- [ ] **Each failure** writes `workspace.process.failed`.
- [ ] **Tests**; `docs/` describes the route.
