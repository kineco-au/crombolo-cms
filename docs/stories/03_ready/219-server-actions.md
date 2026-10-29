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

## Decisions (2026-10-29)

1. **An action is a plain function meeting a published contract**, in
   `@crombolo/common` beside middleware and routes:

   ```ts
   type ServerAction = (formData: FormData, context: ActionContext) =>
     Response | Result<unknown> | Promise<Response | Result<unknown>>
   ```

   - **Listed in the config a module at a time:**
     `import * as profile from '#actions/profile.ts'` and
     `actions: { profile }`. Each export is an action, and its id is the
     module's key plus the export's name, `profile.save`.
   - **Refused at boot:** an export that isn't a function, and two actions on
     one id.
   - **Not chosen:** `'use server'` files found when views are snapshotted,
     inline `'use server'` with closures, a wrapper such as
     `action('name', fn)`, or hand-written ids.
   - **Where they live.** Actions live outside `components/`, e.g. in
     `actions/`, and views import them through the site's subpath import
     (`"imports": { "#actions/*": "./actions/*" }` in `package.json`). Pages
     render from a copy of `components/` in the views cache, where a relative
     path would break. The alias resolves from the copy and from the config to
     the same module, so the page holds the very function the config listed;
     this was checked with a small experiment. Templates ship the alias.
   - **How the renderer finds the id.** By the function itself: rendering an
     action the config doesn't list fails, naming the fix.
2. **A form without JavaScript posts and is redirected back** (Post/Redirect/Get):
   - **Rendering:** `<form action={profile.save}>` renders `method="post"
     action="/crombolo/actions/profile.save"`. `<button
     formAction={profile.remove}>` posts the same form to another action.
   - **Hidden fields:**
     - `__antiforgery`, the member's token, written only while a member is
       signed in;
     - `__return`, the page's own path, rather than `Referer`, which privacy
       settings can strip. Only a path on this site is accepted.

     Both are removed from the `FormData` before the handler sees it.
   - **Checks:** the post runs through 211's: CSRF, the rate limit and the
     time limit. Inside the handler, 206's `cookies()`, `headers()`, `site()`
     and navigation work.
   - **Success** answers 303 to `__return`, or to wherever `redirect()` sends
     it. An `Outcome` answers 303 back.
   - **The result** travels in core forms' signed flash cookie: the status,
     message, field errors, submitted values (passwords and files left out),
     and a success's value, a few KB at most.
   - **On the page,** `actionState(profile.save)` reads it once, keyed to the
     action. It is `undefined` on an ordinary visit and
     `{ ok, value?, errors?, values? }` after a post. Reading it makes the
     page private, as reading cookies does.

## Still to decide

3. **From an island.** Proposed: the island stub writes an action prop as
   `{"$action": "profile.save"}`, and the browser rebuilds it as an async
   function.
   - It posts with the anti-forgery header, asking for JSON, and resolves to a
     real `Result` (rebuilt from `@crombolo/common`). A redirect navigates.
   - The server answers a JSON caller with the result and its status, and a
     plain form post as in 2.
   - It fits React 19's `<form action>` and `useActionState`.
   - Typing is `ClientAction<typeof profile.save>`, with a
     `clientAction(...)` wrapper as the fallback.
   - Alternatives: call by name (`callAction('profile.save', formData)`), or
     both.
4. **Revalidation.** Proposed: none until a story for purging a CDN.
   `cookies().set()` works inside an action, as in a route handler.

## Acceptance criteria

To be written when the decisions above are taken.
