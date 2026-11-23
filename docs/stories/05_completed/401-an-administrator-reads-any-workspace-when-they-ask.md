# 401 — An administrator reads any workspace, when they ask to

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 384, 386

## Story

As an administrator of a site a host stages changes into, I want to read any workspace,
a person's own included, when I ask to, so that I can check a change whoever staged it,
and a host's boards can show what each workspace holds.

## Context

An administrator may list every workspace (`?all=true`) and discard any, to clear one
left behind, but reads only those they own or are a member of (`384`). A change a host
stages lands in a workspace its stager owns, so no other administrator can look at it
before it is merged.

## The design

- **Only when asked.** An administrator reads a workspace they are not in only with
  `includePrivate=true` on the request (the command line's `--include-private`).
  Without it they are refused as anyone else is, so nothing private is read by accident.
- **Every read route:** the workspace, `changes`, `merge` (the preview), `conflicts`,
  `diff`, `errors`, `pages`, `files`, `render`, `POST check`, and opening its site
  (`POST open`), whose handoff and cookie carry that it was opened by an administrator
  and are honoured only while they still are one.
- **Writes stay with its owner and members.**
- **Not audited:** reading is not, as a member's reads are not.
- **The view does not change:** `member` stays false for an administrator who is not in
  the workspace.

## Acceptance criteria

- [x] Without `includePrivate`, an administrator who is not in a workspace is refused
      its reads (404), as before
- [x] With it, they read the workspace and each read route, a person's own included
- [x] With it, a write is still refused
- [x] Someone who is not an administrator is refused with or without it
- [x] The command line's workspace commands take `--include-private`
- [x] `docs/workspaces.md` and `docs/remote-protocol.md` say so

## Decisions

- The opt-in is `includePrivate` (`--include-private`): it names what it reaches.
- Reads are not audited.
- Opening its site is allowed, its cookie honoured only while they are an administrator.

## Implementation

- `ADMIN_READS` and `adminRead` in `packages/server/src/workspaces.ts` let an administrator
  who asks past the read routes and `POST check` and `open`; writes still need `mayUse`.
- The handoff and cookie carry `admin` (`workspace-access.ts`); `stillAllowed` in
  `server.ts` honours it only while the user is in the administrators' group.
- The CLI: `--include-private` in `siteFlags`; `includingPrivate` marks each workspace
  route and lists with `?all=true`.
- Tests: `tests/workspace-admin-read.test.ts`, `tests/workspace-sites.test.ts`.
