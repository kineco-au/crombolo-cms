# 379 — A workspace is looked at before it is merged

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 375

## Story

As someone reviewing a piece of work, I want to open a workspace's site at an address of
its own, so that I can see its pages as visitors would, and send the link to someone
else, before any of it is merged.

## Context

A draft has a preview link today (`368`), for one page and for half an hour. A workspace
is a whole version of the site, and a reviewer wants to click through it.

## The design

- **A workspace is named by the host a request arrives on.** A site sets a pattern for
  workspace hosts (`workspaces.host`), such as a label before its own name. A request on
  such a host is served from that workspace.
  - Caches and browsers keep workspaces apart because the host differs.
  - A workspace's pages are never indexable, and say so in their headers.
- **Who may see it:** someone signed in to the back office who is in the workspace, or
  the holder of a link the workspace's members make. Whoever makes a link chooses how
  long it lasts, up to a longest time the site sets (`workspaces.linkMaxDays`, 30 by
  default), and can withdraw it. A site can turn links off.
- **Published in a workspace** means served at its address. A draft there is reached by
  the preview link, as now.
- **The Delivery API on a workspace's host** answers from the workspace, so a front end
  built apart from the CMS can be pointed at it.
- **Nothing in a workspace reaches outside it until it is merged:**
  - no webhooks and no notifications;
  - no scheduled publish runs;
  - nothing in Shared's search or sitemap.
- **Where no pattern is set,** a workspace is reached with a signed link that sets it for
  that browser, on the site's own host.

## Decisions (settled 2026-11-20)

- **A host pattern, with a cookie as the fallback:** `CROMBOLO_WORKSPACES_HOST`, such as
  `{workspace}.preview.example.com`, the workspace key's 32 hex digits as its label, with a
  `{host}` token for a site with several hostnames, whose bound domains the workspace's copy
  of the site rewrites so its links stay inside. Where no pattern is set, a cookie on the
  site's own host switches the view, served `private, no-store`. A path prefix was rejected:
  a page's own root-relative links would lead back to Shared.
- **Someone signed in to the back office gets in by a single-use handoff:** "Open" answers a
  link with a signed token, used once within five minutes and swapped for a host-only cookie,
  checked again on every request (still a member, still enabled).
- **Links for others:** reusable until they expire (at most `CROMBOLO_WORKSPACE_LINK_MAX_DAYS`,
  30), withdrawable, and gone when their maker leaves the workspace; an app front end sends a
  link's secret in `Crombolo-Workspace-Link` on its Delivery API calls.
- **A page changed but not published in the workspace** is served as Shared had it published
  when the workspace first changed it.
- **The site's own code runs as on the site** (the maintainer's choice): routes and server
  actions are allowed on a workspace host, and what they write reaches Shared, a form's entry
  included.
- **Freshness:** a revision on the workspace, bumped by every workspace write and read with the
  access check; nothing on the cache instruction stream. At most 3 workspace sites per node,
  dropped after 15 minutes idle (settings).
- **Every response from a workspace** is `private, no-store`, `noindex`, with no ETag; `robots.txt`
  disallows everything and there is no sitemap. Search uses Shared's index, a documented gap.
  Schedules never run before the merge.
- **Uploads on a workspace's pages** are recorded in `workspace_upload` and served only at its
  address; media items are `390`'s.
- **Since `376`, `377` and `380` were revised:** a workspace's code and types are a copy frozen
  when it opens, so its site renders with its own views and types once those land; until then
  Shared's.

## Taken from `377` (2026-11-20)

- **A workspace's stylesheets and scripts are served at its address only.** `377`
  builds the workspace's views tree and renders a page in it; serving that, and its
  assets, is this story's.

## Taken from `390` (2026-11-20)

- **A workspace's media files are served at its address,** crops and resized versions
  included: `serveMedia` there reads the workspace's versions as well as Shared's.

## Acceptance criteria

- [ ] **A workspace's pages are served at its host,** with its pages, types and files.
- [ ] **A stranger** is refused; a member, and the holder of a link in date, are served.
- [ ] **A withdrawn or expired link** is refused.
- [ ] **A link longer than the site allows** is refused when it is made.
- [ ] **The Delivery API on a workspace's host** answers from the workspace.
- [ ] **A publish in a workspace** fires no webhook, runs no schedule and changes no
      search result in Shared.
- [ ] **A workspace's responses** are marked not to be indexed.
- [ ] **Tests;** the preview link of `368` takes a workspace.
- [ ] **A stylesheet or script changed in a workspace** is served changed at the
      workspace's address only.
- [ ] **A media file uploaded or replaced in a workspace** is served, with its crops
      and sizes, at the workspace's address only.
