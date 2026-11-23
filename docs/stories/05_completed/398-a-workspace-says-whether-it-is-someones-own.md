# 398 — A workspace says whether it is someone's own

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 380, 384

## Story

As a host listing a site's workspaces, I want to know which are a person's own and which
are named pieces of work, so that I can show the named ones without every editor's own
changes.

## Context

Where a workspace is required, each editor's changes land in their own unnamed workspace
(`380`), named `Changes by <person>`. The workspace already records that it is someone's
own (`workspace.personal`), but its view (`GET <backoffice>/crombolo/api/workspaces`,
`/{key}`, `/mine`, with `?all=true` for an administrator) leaves it out, so a host can
only guess from the name. `mine` in the view says the caller owns it, which is not the
same thing.

## The design

- **The view gains `personal`:** `true` for a person's own workspace, `false` for a named
  one, wherever a workspace is answered: the list, one workspace, and `mine`.
- **The remote protocol's `workspaces`** answers it too, so a host reaching a site that way
  sees the same.
- Nothing else changes: a person's own workspace is still listed, opened and merged as
  before.

## Acceptance criteria

- [x] `GET workspaces`, `GET workspaces/{key}` and `GET workspaces/mine` answer `personal`
- [x] A person's own workspace is `personal: true`; one opened by name is `false`
- [x] The remote protocol's workspace list answers it as well
- [x] `docs/workspaces.md` and `docs/remote-protocol.md` say so

## Implementation

- `personal` on `WorkspaceView` (`packages/server/src/workspaces.ts`), from `workspace.personal`; the remote protocol answers its workspace routes through the same handlers.
- Tests: `tests/workspace-merge-api.test.ts` (a site that requires a workspace).
