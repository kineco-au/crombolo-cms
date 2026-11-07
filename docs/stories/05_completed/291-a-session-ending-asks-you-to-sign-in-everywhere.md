# 291 — A session ending asks you to sign in, on every screen

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As someone whose session has ended, I want to be asked to sign in whichever screen I am on,
and to carry on from there, so that I never see an error that only means I was signed out.

## Context

The sign-in dialog opens when one of the client's own API calls gets a 401. About 20 of the
plugin's screens use plain `fetch` with the session cookie, which the client never hears of.
Forms showed "forms responded 401" above "There are no forms yet", with no dialog.

## What was built (2026-11-07)

- **`session-guard.js`,** an entry point that wraps `window.fetch`, so no screen had to change.
  `session-guard-model.js` is the pure part, covered by `tests/session-guard.test.ts`.
- **A request that gets a 401** renews the session, or opens the dialog and waits for sign-in,
  then is sent again, so the screen never sees the 401. That is safe for a save too: a 401
  means none of it was acted on. It gives up after two tries.
- **While signed out,** requests wait rather than being sent, which saves a run of 401s.
- **Left alone:** other sites, signing in itself, and the client's calls, which carry a token
  and have their own queue. The browser logs one 401 for each of those, and any first 401, and
  that can't be hidden.

## Acceptance criteria

- [x] A screen using plain `fetch` opens the sign-in dialog when the session has ended.
- [x] It shows no error and no empty list while the dialog is open.
- [x] After signing in, the request is sent again.
