# 447 — Shared answers the workspace routes

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 379, 401, 408, 446

## Story

As a tool that works with a site's workspaces, I want Shared to answer the same routes
as any workspace, under a key of its own, so that looking at, checking and linking to
what the site holds is one path, not a workspace's path and a special case for Shared.

## Context

Shared is what the site holds and serves, and a workspace is an overlay on it
([`../../workspaces.md`](../../workspaces.md)). In storage Shared is the base
(`workspace_id IS NULL`), and that stays. Over HTTP, though, a tool must treat it
differently: it has no key, so `render`, `pages`, `errors` and `check` can't be asked of
it, and it has no `open` or `links`, so nobody can be given a way to look at it.

That matters once a site is open only to its back-office users (`446`). A workspace's
link still lets a browser with no account look at the workspace, but nothing lets one
look at Shared. A tool whose browser has no back-office session (an agent's, say) can
look at every workspace but not at the site itself.

## The design

- **A reserved key, `shared`,** that every workspace route under
  `{pluginPath}/api/workspaces` takes in place of a workspace's key. No workspace can
  have it.
- **The routes it answers,** reading Shared as the site serves it:
  - `GET /shared`: its name ("Shared"), `shared: true`, no owner or members, and
    `mine: false`; everyone who may use workspaces may read it;
  - `GET /shared/render?path=`, `GET /shared/pages`, `GET /shared/errors?since=`,
    `POST /shared/check`: as for a workspace, over Shared's published pages and views;
  - `GET /shared/diff?against=base` answers nothing: Shared is its own base;
  - `POST /shared/open { path }`: a single-use way in for the caller, at the site's own
    address (it has no host of its own), swapped for a host-only cookie;
  - `GET|POST|DELETE /shared/links`: links for someone else to look, held to the same
    rules as a workspace's (`379`, `410`), and withdrawn the same way.
- **What a Shared link or `open` lets in:** the site at its own address, past `446`'s
  gate: pages, media, the site's routes and the Delivery API, as a signed-in user would
  see them, with the rights in decision 4. Never the back office or the Management API.
- **The limit:** `links.maxDays` (decision 2), fractional days as now.
- **Refused, each with a sentence saying why:** renaming, discarding or deleting it,
  members, merging *from* it, `update`, `conflicts`, `pending` and `site-files`.
- **Listed:** `GET /` puts Shared first, so a list of places to work starts with it. A
  host that lists only people's own work leaves it out by `shared: true`.
- **The header:** `Crombolo-Workspace: shared` on the Management API is the same as no
  header.
- **The command line:** `--workspace shared` wherever a workspace is named, with the same
  refusals.
- **Audited** as a workspace's link is: who made, used and withdrew one.

## Decided (2026-11-27)

1. **The key is `shared`.** It's reserved, so no workspace can be given it, and
   workspace keys are UUIDs anyway.
2. **One setting caps every link,** for a workspace and for Shared:
   `links.maxDays` (`CROMBOLO_LINK_MAX_DAYS`), `0` (off) by default. It replaces
   `CROMBOLO_WORKSPACE_LINK_MAX_DAYS`, which is still read for one release with a
   warning at start-up naming the new setting. **Upgrade note:** workspace links stop
   working unless `CROMBOLO_LINK_MAX_DAYS` is set. Keeping two settings was considered
   and set aside. `open` isn't limited by it.
3. **Who may make a Shared link:** anyone who may use workspaces (the Content
   section). A link stops working when its maker loses Content access, or is disabled
   or deleted, as well as when it is withdrawn or lapses.
4. **What a link lets the holder do:**
   - **A link made by a user who isn't an administrator** lets its holder look:
     `GET` and `HEAD` only. Any other method without a real back-office session is a
     `401` with problem details saying a link only lets them look.
   - **An administrator** chooses when making a link: look only, or everything a
     signed-in user could do on the public side, forms and member routes included.
   - **`open`** follows the same rule by the role of the person who opens it.
   - **No link reaches the back office or the Management API.**

## The plan

- **The router:** a `shared` branch in `workspaces.ts` before a workspace is looked up.
  - `GET /shared` answers a descriptor, and `GET /` lists Shared first.
  - `render`, `pages` and `check` go through Shared's own check (`406`,
    `shared-check.ts`).
  - `errors` are stored under the key `shared` in `workspace_error`, whose
    `workspace_key` is text, so no migration is needed there.
  - `diff?against=base` answers empty.
  - The refused routes say why.
- **Links:** a `shared_link` table (an expand migration, release 0.83.0): the secret's
  hash, its maker, created, expires, withdrawn, and `writes`, which only an
  administrator's link can have. Adding a table avoids rebuilding `workspace_link` on
  SQLite to make its `workspace_id` nullable.
- **The way in:** `open` is a single-use hand-off at the site's own address, swapped for
  a host-only `crombolo-shared` cookie that carries its link or hand-off and its rights.
  `446`'s gate accepts the cookie. The back office and the Management API never read
  it.
- **The header and the command line:** `Crombolo-Workspace: shared` is treated as no
  header, and the CLI takes `--workspace shared` with the same refusals.
- **The audit** records who made, used and withdrew each link.

## Acceptance criteria

- [x] **Each read route** answers for `shared` as the site serves its pages, and the
      refused ones say why.
- [x] **`open` for `shared`** lets the caller's browser in at the site's own address on
      a site open only to its users (`446`).
- [x] **A Shared link** lets a browser with no account read the site, not its back
      office or Management API; withdrawn or lapsed, it doesn't.
- [x] **`CROMBOLO_LINK_MAX_DAYS`** caps workspace and Shared links, `0` by default
      refuses both, and the old `CROMBOLO_WORKSPACE_LINK_MAX_DAYS` is read with a
      warning.
- [x] **A non-administrator's link** lets its holder look only; an administrator's lets
      them write when made so; neither reaches the back office or Management API.
- [x] **A link whose maker loses Content access** stops working.
- [x] **No workspace can be given the key.**
- [x] **`GET /`** lists Shared first; `Crombolo-Workspace: shared` changes nothing.
- [x] **The command line** takes `--workspace shared`.
- [ ] **Tests** on both dialects; `docs/workspaces.md`, `docs/configuration.md`,
      `docs/changes.md` and the release notes updated.

## Built

- **The router:** `sharedRoute` in `packages/server/src/workspaces.ts`, reached when the
  first part after `<plugin>/api/workspaces` is `shared`, before a workspace is looked up.
  `GET /shared` answers `SHARED_VIEW`; `GET /` (and `?all=true`) lists it first.
  `render` renders with the shared renderer as a check does (`renderForCheck`);
  `pages` and `check` go through `createSharedCheck` (`since`, `all`, `failing`), a
  `since` the site doesn't hold answering 404; each failing page is noted in
  `workspace_error` under `shared` and read back by `errors`. `diff` and `changes` answer
  empty. `SHARED_REFUSALS` answers 400 with a sentence for rename, discard/delete,
  `members`, `merge` (and `POST /merge` naming `shared`), `update`, `conflicts`,
  `pending`, `site-files`, `files`, `marks` and `change`.
- **The key:** `SHARED_WORKSPACE_KEY` in `@crombolo/data`; `WorkspaceRepository.open`
  refuses it and `byKey` never finds it.
- **Links:** migration **106 `AddSharedLinks`** (expand, release 0.83.0), `shared_link`
  (`secret_hash`, `made_by`, `writes`, `created_at`, `expires_at`, `withdrawn_at`), with
  `SharedLinkRepository`. `POST /shared/links { days, writes? }`: `writes: true` only from an
  administrator (403 otherwise). `GET` lists the caller's own, or every one for an
  administrator; `DELETE` withdraws one's own, or any for an administrator. Audited as
  `Link`, `LinkUsed` and `Unlink` on `Workspace`/`shared`.
- **The way in:** `packages/server/src/shared-access.ts`. `open` answers
  `?crombolo-shared=<hand-off>` (signed for a purpose of its own, single use, five
  minutes) at the site's own address; a link `?crombolo-shared-link=<secret>`. `route()`
  swaps either, on a `GET`/`HEAD` past the back office, for a host-only `crombolo-shared`
  cookie and a 303, clearing a workspace's cookie where workspaces have no hosts; the
  workspace site handler steps aside for it.
- **The gate:** on a closed site, a request not signed in and not on a preview link is
  given to `sharedRefusal`: no valid cookie, the usual `notSignedIn`; a valid one, let in
  for `GET`/`HEAD`; anything else a 401 problem saying a link only lets them look, unless
  its rights write, and then only from the same origin. The Delivery API's check asks
  the same. Rights are read on every request (`sharedRights`): for `open`, the opener's
  stamp, Content section and administrator role; for a link, not withdrawn or lapsed,
  `links.maxDays` above 0, its maker still with Content (approved, not locked out, not
  deleted), and `writes` only while the maker is an administrator. The back office, the
  Management API and the plugin's routes never read the cookie, and the site's code is
  never shown it (`withoutBackOfficeCookies`).
- **Deviation: a Bun quirk.** `new Request(request, { headers })` keeps the original's
  cookie when the headers given hold none at all, so a request whose only cookie was
  hidden still showed it to the site; `siteSeenRequest` now deletes it explicitly. This
  affected 446's stripping too, for a request carrying only back-office cookies. With
  it fixed, protected media was refused to a back-office user whose request carried
  nothing else, because the media check had been reading the site's copy: it now reads
  the request as it came (`siteRequestAsked`), as preview does.
- **The setting:** `links.maxDays` / `CROMBOLO_LINK_MAX_DAYS`, 0 by default, in place of
  `workspaceLinkMaxDays`; `CROMBOLO_WORKSPACE_LINK_MAX_DAYS` is read where the new one is
  unset, and `replacedLinkSetting()` is logged as a warning at start-up.
- **The header:** `workspaceHeaderOf` treats `Crombolo-Workspace: shared` as none, in the
  scope and in the served-view check.
- **The command line:** the CLI names a workspace by its argument, not a `--workspace`
  flag, so `shared` is taken there (`workspaceNamed`), naming the place `… (shared)`; the
  server's refusals come back as `refused`. `workspace list` shows Shared first. The back
  office's own list leaves it out by `shared: true`.
- **Tests:** `tests/shared-workspace.test.ts` (each read route and refusal, the reserved
  key, the header, `open` and links past a closed site's gate and not into the back office
  or Management API, read-only and administrator write links, cross-site writes, the cap,
  withdrawn and lapsed links, a maker losing Content or disabled, the audit, the migration);
  `tests/config-env.test.ts` (the setting, its default and the old variable's warning);
  `tests/workspace-sites.test.ts` (0 refuses a Shared link too); `tests/workspace-cli.test.ts`
  (`shared` from the command line); the migration lists in `tests/upgrade-from-release.test.ts`,
  `tests/media-access.test.ts`, `tests/permissions.test.ts`, `tests/support/db.ts` and
  `tests/integration/first-boot.integration.ts`. No browser journey: nothing in the back
  office changed but its list leaving Shared out.
