# 219 — Server actions

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** 211

## Story

As a developer used to Next.js, I want a form on a page, or an island, to call
a server function directly (`'use server'`), with the form working without
JavaScript. Then a form a developer writes, such as registration completion or
profile edits (207), needs no hand-made endpoint.

## Context

Split from 211 when planning it (2026-10-29), so route handlers could ship on
their own. In Next.js, `<form action={save}>` posts to a function marked
`'use server'`. Inside it, `cookies().set()`, `redirect()` and
`revalidatePath()` work, and `useActionState` gets its result. Crombolo pages
are plain HTML, so an action is a real form post. Islands (209) can call one
from the browser.

There is no server-side page cache, only CDN lifetimes and purge tags, so
`revalidatePath` and `revalidateTag` have nothing to clear until there is a
story for purging a CDN.

## Decisions before implementation

- **How actions are found.** Recommended: `'use server'` modules are found and
  transformed while views are snapshotted, as 209 does for client modules.
  Each export becomes a signed action id. Alternatively, actions are
  registered explicitly in the config, as 210's middleware and 211's routes
  are.
- **Without JavaScript.** Recommended: `<form action={save}>` renders a POST to
  the action endpoint with the signed id and the member's anti-forgery token.
  Success answers 303 to the page or the action's `redirect()`. A returned
  `unprocessableContent` answers 303 back with the errors in a flash cookie,
  as core forms do, and the page renders them.
- **From an island.** Recommended: the stub hands the island a function that
  posts to the same endpoint and resolves to the action's `Result`.
- **CSRF.** The same as 211: same origin or the anti-forgery token.
- **Revalidation.** Recommended: none until the CDN purge story. `cookies().set()`
  works inside an action, as in a route handler.

## Acceptance criteria

To be written when the decisions above are taken.
