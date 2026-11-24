# 410 — A workspace's address is only ever on its own site

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 379

## Story

As someone opening a workspace's site, I want the address I am sent to always to be
that workspace's own, so that no link can send me, and the sign-in it carries, to
another site.

## Context

Reported by Crombolo Cloud on 2026-11-24 (found building its story 295) and
confirmed here.

`POST <plugin>/api/workspaces/{key}/open { path }` (`379`) answers the address of the
workspace's site at that path, carrying a signed hand-off that signs the person in
there for the next five minutes (`WORKSPACE_HANDOFF_SECONDS`). The route takes any
`path` that starts with `/` (`packages/server/src/workspaces.ts`), and
`workspaceOpenUrl` (`packages/server/src/server.ts`) resolves it against the
workspace's origin with `new URL(path, origin)`. A path can therefore name another
host:

| `path` | Answered address |
|---|---|
| `//other.test/x` | `https://other.test/x?…hand-off…` |
| `/\other.test/x` | the same |
| `/<tab>/other.test/x` | the same |

So the answer can be on a host that is not the workspace's, **with the hand-off in its
query string**. That is more than a redirect to somewhere else: whoever runs that host
receives a value that signs in as the person on the workspace's site while it lasts.

The request needs a signed-in member of the workspace, so nobody outside can make it
themselves. It is reached through a caller that passes on a path it was given, such as
a "return to" address on a sign-in screen, and then follows the answer. Crombolo Cloud
now refuses such paths before calling and follows only an answer on the expected host.
The back office's own caller and the address made for a page being edited
(`workspaceOpenUrl(…, shown?.url ?? '/')`) should be read for the same thing.

## The design

- **One rule for a path on a workspace's site,** used by the route and by
  `workspaceOpenUrl` itself, so no later caller can skip it: it starts with exactly
  one `/`, holds no backslash and no control character, and names no scheme or host.
- **The route refuses a path outside the rule** with a 400 saying a path on the site is
  needed. It does not quietly open the home page instead.
- **The built address is checked, not only the text:** after it is made, its origin
  must equal the workspace's origin, or nothing is answered. This is the guard that
  holds whatever the parser accepts.
- **The same check wherever a hand-off or a shared link is put on an address,** so
  the value never leaves the workspace's own host.

## Decisions (2026-11-24, the maintainer's)

1. **Refuse with 400,** saying a path on the workspace's site is needed ("Give a path on
   the workspace's site, such as /about."). Today's silent fallback to `/` for a path
   without a leading slash goes too.
2. **A hand-off is already spent on first use:** `accessFromHandoff` (`server.ts`) uses
   it through `SingleUseTokens`, and `tests/workspace-sites.test.ts` checks that a second
   use sets nothing. Nothing to add.
3. **Released with 409 as 0.76.1,** the release notes naming 410 under Security.

## Notes

- A shared link's address (`links.make` in `server.ts`) is made from `/` on the
  workspace's host, so it cannot name another today; it gets the origin check too, so a
  later change cannot make it.
- The back office calls `open` with `/` (`workspace-switch.js`, `workspacesApi.address`).

## Acceptance criteria

- [x] **`//other.test/x`, `/\other.test/x`, a path with a tab or newline,
      `https://other.test/` and `about` (no leading slash)** are each refused with 400,
      and no address is answered.
- [x] **`/`, `/about`, `/about?x=1#top`** answer an address on the workspace's host
      with the hand-off.
- [x] **No answer from the route is ever on another host,** shown by a test that tries
      a list of such paths against the built address's origin.
- [x] **The address made for a page being edited** passes through the same rule.
- [x] **The back office's own "open" still works,** in a workspace with its own host
      and one without.
- [x] **Tests** on both dialects; `docs/workspaces.md` and the release notes updated.

## Implementation

- `isSitePath`, `onOrigin` and `pageSitePath` (`packages/server/src/workspaces.ts`): the one
  rule for a path on a workspace's site, the built address checked against the
  workspace's origin, and a page's own address reduced to its path.
- `POST /{key}/open` refuses a path outside the rule with 400; no path opens `/`.
- `workspaceOpenUrl` (`server.ts`) builds through `onOrigin`, so the editing page's address
  and every later caller pass the same check; a shared link's address does too.
- A hand-off was already single-use (`SingleUseTokens`): nothing added.
- Tests: `tests/workspace-sites.test.ts` (the rule, every hostile path refused with no
  address answered, on a workspace with its own host and one without).
