# 422 — A large change is taken wherever workspaces are on

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 383, 399, 420

## Story

As a host promoting changes into a site that has workspaces on and remote access off,
I want a change that carries more media than the usual request limit to be taken, so
that a promotion or a publish adding a large file is not refused, and I do not have to
turn remote access on only to send it.

## Context

Asked for by Crombolo Cloud on 2026-11-24, on 0.79.0. Decided below; it reverses a choice made while building `420`.

A change bundle carries the media it added under `media/`. Until 0.79.0 a site
listened with the larger limit (`CROMBOLO_REMOTE_MAX_UPLOAD_GB`, 50 GB unless set)
whenever the remote or workspaces were on. `420` turned workspaces on everywhere and,
so that a default site did not listen with 50 GB, left the larger limit to remote
access alone (`listeningBodyLimit`, `packages/server/src/config.ts`). A site with
workspaces on and `CROMBOLO_REMOTE_ACCESS` off therefore refuses any change over
`CROMBOLO_MAX_REQUEST_BODY_MB` (32 MB): Bun closes the request before a route sees it.

Crombolo Cloud's hosted sites are exactly that: remote access off, every change
through the Management API (`PUT <back office>/crombolo/api/changes?stage=true[&into=]`).
Turning the remote on for the limit alone would also let anyone with Pull copy the
site from the command line.

What is already there (`packages/server/src/server.ts`, `serveOptions.fetch`): when
the listening limit is the larger one, every request is held to 32 MB by its
`content-length` (413), and one with no length is refused (411), unless it is one of
the remote's uploads (`remote.isUpload`) or the Management API's `PUT changes`
(`managementChange`). The change routes stream the body to a file
(`streamBody`, `remote-changes.ts`) and never hold it in memory. So the per-route
check `420` was wary of lacking exists; it is only switched on by the remote.

Two things found on reading:

- `PUT changes/from-site` (`399`) is not among the exempt routes, so a site bundle
  staged as a change is held to 32 MB even with remote access on.
- `PUT changes` checks Apply changes before reading the body; `changes/from-site`
  should be confirmed to do the same.

## The design

- **The site listens with the larger limit when workspaces are on,** as when the
  remote is: `listeningBodyLimit` answers `remote.maxUploadBytes` for either.
- **Only the routes that take a change are let past 32 MB:** the Management API's
  `PUT changes` and `PUT changes/from-site`, beside the remote's own uploads. Every
  other route keeps `CROMBOLO_MAX_REQUEST_BODY_MB`, refused from its headers before
  any of the body is read. No workspace route takes a bundle today; one that comes to
  is added to the same list.
- **Rights before the body:** a caller who is not signed in, or without Apply changes,
  is refused before the body is read, on both routes.
- **A site with workspaces off and remote access off** listens with 32 MB, as now.
- **`CROMBOLO_REMOTE_MAX_UPLOAD_GB` keeps its name** and says in its description that it
  is also the largest change a site with workspaces takes. (Alternative: a setting of
  its own for changes. One number is simpler, and the remote's change route already
  uses it.)

## Decisions (2026-11-24)

1. **A site with workspaces on listens with the larger limit,** remote access or not,
   reversing `420`: the per-route check holds every other route to 32 MB, and Apply
   changes is checked before the body is read.
2. **One setting:** `CROMBOLO_REMOTE_MAX_UPLOAD_GB`, its description saying it is also
   the largest change a site with workspaces takes.
3. **50 GB by default,** as for the remote: a change streams to a file, so the disk is
   the real limit.
4. **It ships in 0.79.0,** which is not yet tagged, so the 32 MB limit `420` brought is
   never released and 0.79.0's upgrade note about it goes.

## Plan

1. **`listeningBodyLimit`** (`packages/server/src/config.ts`): the larger of
   `maxRequestBodyBytes` and `remote.maxUploadBytes` when `config.remote.enabled` or
   `config.workspaces`; `maxRequestBodyBytes` otherwise.
2. **The routes let past 32 MB** (`serveOptions.fetch`, `packages/server/src/server.ts`):
   a predicate `takesAChange(request, url)` beside `remote.isUpload`, true for the
   Management API's `PUT changes` and `PUT changes/from-site`
   (`managementChange` answering either). The remote's own `PUT .../changes/from-site`
   joins `remote.isUpload` (`packages/server/src/remote.ts`), so a site bundle is taken
   either way. The guard is otherwise unchanged: 413 over `CROMBOLO_MAX_REQUEST_BODY_MB`
   by `content-length`, 411 with none.
3. **Rights before the body:** `changes/from-site` already refuses without Apply changes
   before `receiveSite`; `PUT changes` is confirmed to do the same, and both are tested
   with a body that would fail if read.
4. **`streamBody`** keeps `remote.maxUploadBytes` as the change routes' own cap, so a
   change over it answers 413 `too-large` (confirm `receiveSite` uses the same).
5. **Setting description** (`packages/server/src/settings.ts`), then `docs/configuration.md`
   regenerated (`settingsMarkdown`).
6. **Tests:**
   - `tests/security.test.ts` "the request body limit": 32 MB listening with workspaces
     and remote access off; the larger limit with workspaces on; with workspaces on and
     remote off, a POST elsewhere over the limit is 413, one with no length 411.
   - `tests/remote.test.ts` "the body limit", or a new `tests/change-body-limit.test.ts`:
     with workspaces on and remote off, `PUT changes?stage=true` larger than a 1 KB
     `maxRequestBodyBytes` is staged with its media; the same for
     `PUT changes/from-site`, remote on and off; over a small `maxUploadBytes` 413
     `too-large`; without Apply changes 403 before the body is read.
   - `tests/workspaces-default.test.ts`: the listening limit follows workspaces.
7. **Docs:** `docs/workspaces.md` (how large a change may be), `docs/remote-protocol.md`
   (the routes taken past the usual limit), and 0.79.0's release notes: the upgrade
   note about 32 MB is replaced by a feature bullet (422) and a short note that a site
   with workspaces listens with the larger limit, every other route held to
   `CROMBOLO_MAX_REQUEST_BODY_MB`.

## Acceptance criteria

- With workspaces on and remote access off, `PUT changes?stage=true` takes a change
  larger than `CROMBOLO_MAX_REQUEST_BODY_MB` and stages it, its media with it.
- The same for `PUT changes/from-site`, with remote access on or off.
- A change larger than `CROMBOLO_REMOTE_MAX_UPLOAD_GB` answers 413 `too-large`.
- Any other route sent more than `CROMBOLO_MAX_REQUEST_BODY_MB` answers 413, and 411
  with no length, with workspaces on and remote access off.
- A caller without Apply changes is answered 403 on both routes without the body
  being read.
- With workspaces off and remote access off the site listens with
  `CROMBOLO_MAX_REQUEST_BODY_MB`.
- `docs/configuration.md`, `docs/workspaces.md` and the release notes say what the
  limit is and when it applies; the upgrade note in 0.79.0's section is replaced.

## Built (2026-11-24, 0.79.0)

As planned. `listeningBodyLimit` raises the limit when `workspacesOn(config)` (a locked
site included) or the remote is on; `serveOptions.fetch` lets the Management API's
`changes` and `changes/from-site` past the usual limit, and `remote.isUpload` takes the
remote's `changes/from-site`. Both routes already checked Apply changes before reading
the body. Tests: `tests/changes-management-api.test.ts` ("a large change, remote access
off"), `tests/security.test.ts` (32 MB with workspaces off).
