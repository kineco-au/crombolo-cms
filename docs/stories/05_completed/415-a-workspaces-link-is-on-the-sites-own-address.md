# 415 — A workspace's link is on the site's own address

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 379, 410

## Story

As someone sending a link to a workspace's site, I want the link to be on the site's
real address, so that whoever I send it to can open it.

## Context

Reported by Crombolo Cloud on 2026-11-24, in 0.76.0 (its story 295), and confirmed
here by reading.

`workspaceLinks.make` (`packages/server/src/server.ts`) builds the link's address from
`publicOrigin(new Request('http://localhost/'), config)`. `publicOrigin` returns
`seo.publicUrl` when it is set; otherwise `originOf` takes the host of the request it
is given, and falls back to `applicationUrl` only when the request has none. The
stand-in request always has one, `localhost`, so `applicationUrl` is never reached.

So on a site with no public address set, every link is `…--localhost/?…` and opens
nothing. A site with `CROMBOLO_APPLICATION_URL` set gets no benefit from it.

`workspaceOpenUrl`, called with no request, uses the same stand-in and is wrong the
same way.

Also found (2026-11-24, by reading): **`open` does not follow its request either when
`seo.publicUrl` is set.** `workspaceOrigin` goes through `publicOrigin`, so the SEO public
address wins over the request, and an `open` on a site whose visitors are served by an
app elsewhere answers an address that app does not serve. Every caller of
`workspaceOpenUrl` passes a request today, and the command line makes no links, so the
no-request path serves only later callers and jobs.

## The design

- **The link is on the address the request to make it arrived on,** as `open`
  already answers for a member (`workspaceOrigin(workspace, request)`): the route
  passes its request to `make`.
- **Made with no request** (the command line, a job), it is on the site's configured
  address: `seo.publicUrl`, else `applicationUrl`. Never `localhost` unless that is
  what is configured.
- **No stand-in request anywhere an address is made:** one helper answers a
  workspace's origin from a request or, with none, from the configuration, and both
  `make` and `workspaceOpenUrl` use it.
- **`410`'s check still holds:** the built address must be on the workspace's own
  origin.

## Decisions (2026-11-24, the maintainer's)

1. **The request's address,** forwarded host and scheme included, with the workspace's
   label where workspaces have hosts of their own; with no request,
   `CROMBOLO_APPLICATION_URL`.
2. **`seo.publicUrl` is never used for a workspace's addresses,** for `open` and for
   links alike: a workspace's site is served by the CMS itself. This changes `open` on a
   site with a public address set; the release notes say so.

## Acceptance criteria

- [x] **A link made by a request** is on that request's address, with the workspace's
      label where workspaces have hosts of their own, and opens the workspace's site.
- [x] **Behind a proxy,** it follows the forwarded host and scheme.
- [x] **Made with no request,** it is on `applicationUrl`'s address.
- [x] **No link is on `localhost`** on a site configured with another address.
- [x] **The address `open` answers** follows its request even where `seo.publicUrl`
      is set, and is right with none.
- [x] **Tests** for each; `docs/workspaces.md` and the release notes updated.

## Implementation

- `workspaceOriginOf` (`packages/server/src/workspaces.ts`, pure): the request's origin,
  forwarded host and scheme followed (`originOf`), or `applicationUrl` with none, with the
  workspace's label where workspaces have hosts; never `seo.publicUrl`.
- `server.ts`: `workspaceOrigin` uses it, so `open` and a link do; the links route passes
  its request to `make`; no stand-in `localhost` request is left. `410`'s `onOrigin` check
  still holds the built address to the workspace's origin.
- Tests: `tests/workspace-sites.test.ts` (the function with and without a request and a
  host pattern; a link and `open` behind a proxy, with an SEO public address set).
