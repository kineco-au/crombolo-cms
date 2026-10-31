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

There is no server-side page cache (checked 2026-10-31): a template's
`revalidate` becomes a `Cache-Control` lifetime for browsers and CDNs
(`revalidateLifetime` in `packages/server/src/server.ts`), and nothing stores
rendered HTML or API answers. What the server keeps are the inputs: the
published content snapshot, the media cache, the compiled views, and the
search-and-sharing settings and form definitions for a few seconds. Since story
`175` a write waits for the snapshot to rebuild, so the page an action
redirects to is current on the node that ran it; another node behind the load
balancer has it once it next polls. A Next.js app's data cache
(`@crombolo/next-integration`, cleared by the `next-revalidate` webhook) is
Next.js's own and outside this story, as a Next.js app uses Next.js's server
actions.

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

3. **From an island, an action is passed as a prop** (2026-10-31).
   - The island stub writes an action prop as `{"$action": "profile.save"}`;
     an action the config does not list fails the render, naming the fix, as
     a form does.
   - The browser rebuilds it as an async function: it posts with the
     anti-forgery header, asking for JSON, and resolves to a real `Result`
     (rebuilt from `@crombolo/common`). A redirect navigates.
   - The server answers a JSON caller with the result and its status, and a
     plain form post as in 2.
   - It fits React 19's `<form action>` and `useActionState`.
   - Typed as `ClientAction<typeof profile.save>`, with a `clientAction(...)`
     wrapper as the fallback.
   - Not chosen: calling by name (`callAction('profile.save', formData)`),
     unchecked by the compiler and outside React's form patterns; both, two
     ways to do one thing.

4. **No revalidation** (2026-10-31). Actions export no `revalidatePath` or
   `revalidateTag`: the server keeps no copy of a page to clear (see Context),
   and the page an action redirects to is current on the node that ran it. A
   CDN's copies are purged as they are today, by the publish webhook
   (`docs/operations.md`, "Purging on publish"), until a story for purging a
   CDN. `cookies().set()` works inside an action, as in a route handler.
   - Not chosen: exported but doing nothing, which would mislead in
     production; `revalidateTag` raising a purge event, which is that CDN
     story's work and needs its decisions.

## Plan

1. **The contract** (`packages/common`): `ServerAction`, `ActionContext` (a
   route's context without `params`: `url`, `cookies`, `setCookie`, `site`,
   `member`, `signal`), `ClientAction<A>` and `clientAction(...)`, and
   `actionState(action)` on the template side.
2. **The config** (`packages/server/src/config.ts`): `actions: { profile }`,
   module by module. At boot, an export that is not a function, or two
   actions on one id, is refused by name. A function-to-id map is built from
   the modules as the config imported them.
3. **The endpoint** (`packages/server/src/actions.ts`, beside `routes.ts`):
   `POST /crombolo/actions/{id}`, through 211's pipeline (`createRoutes`), so
   CSRF, the rate limit, the time limit and story `224`'s signal apply.
   - `__antiforgery` and `__return` are read and removed from the `FormData`;
     `__return` must be a path on this site, else the post returns to `/`.
   - A form post: success answers 303 to `__return`, or where `redirect()`
     sends it; an `Outcome` answers 303 back. The result goes in a signed
     flash cookie keyed by the action's id: status, message, field errors,
     submitted values less passwords and files, a success's value, within the
     cookie's size limit as core forms' is (`form-submit.ts`, generalised
     rather than copied).
   - A JSON caller (`Accept: application/json`): the `Result` and its status,
     or `{ redirect }` for a redirect.
   - Answered where routes are (`all` and `web`), never on an `api` node.
4. **Rendering** (`packages/render`):
   - `<form action={fn}>` renders `method="post"
     action="/crombolo/actions/{id}"`, and `<button formAction={fn}>` and
     `<input type="submit" formAction={fn}>` their `formaction`; the attribute
     types accept a `ServerAction` there. A function the config does not
     list fails the render, naming the fix.
   - The form gets `__return` (the page's path) and, while a member is signed
     in, `__antiforgery`.
   - `actionState(fn)` reads the flash for that id once, and makes the page
     `private, no-store`, as reading cookies does.
5. **Islands** (`packages/render/src/islands.ts`, `islands-loader.ts`):
   `serializeProps`, which refuses a function today, writes a listed action as
   `{"$action": id}` and still refuses any other function. The loader rebuilds
   it as an async function that posts the `FormData` (or an object, as form
   fields) with the anti-forgery header `crombolo.fetch` sends, asks for JSON,
   resolves to a `Result` rebuilt with `@crombolo/common`, and navigates on a
   redirect. Checked with React 19's `<form action>` and `useActionState`.
6. **Templates and the demo:** `crombolo init`'s templates ship the
   `#actions/*` import and an `actions/` folder; the Harbourstone demo's
   enquiry form gains an action used from a page and from an island.
7. **Tests:** boot refusals; the endpoint's form and JSON answers, `__return`
   on and off the site, the flash read once, CSRF, rate and time limits, an
   `api` node refusing; rendering `action` and `formAction`, an unlisted
   function failing; an island prop round trip in the loader; the views-cache
   copy holding the very function the config listed.
8. **Docs:** `docs/rendering.md` (a "Server actions" section beside route
   handlers), `docs/writing-components.md`, the release notes.

## Acceptance criteria

- [x] An action module listed in `actions` makes each export an action at
      `module.export`; a non-function export or a repeated id is refused at
      boot by name.
- [x] `<form action={profile.save}>` posts to it without JavaScript, and
      `<button formAction={…}>` to another; an unlisted function fails the
      render, naming the fix.
- [x] A post runs through route handlers' CSRF, rate and time limits, with
      `cookies()`, `headers()`, `site()` and navigation working inside it.
- [x] Success answers 303 to the page or to `redirect()`'s target; a
      `__return` off the site is not followed, and the post returns to `/`;
      an `Outcome` answers 303 back.
- [x] `actionState(action)` reads the result once, `undefined` on an ordinary
      visit, and makes the page private.
- [x] An island given an action as a prop calls it from the browser, gets a
      `Result`, follows a redirect, and works with `useActionState`; any other
      function prop is still refused.
- [x] Actions answer on `all` and `web` nodes, never on an `api` node.
- [x] No `revalidatePath` or `revalidateTag`; the docs say why and point at the
      publish webhook.
- [x] `docs/rendering.md` and `docs/writing-components.md` document actions;
      templates ship the `#actions/*` import; tests cover the above.

## Out of scope

Actions from a server bundle, revalidation and CDN purging, and Next.js apps,
which use Next.js's own server actions.

## What was built

- **The contract** (`packages/common/src/actions.ts`): `ServerAction`,
  `ActionContext`, `ActionState`, `ClientAction`, `clientAction`,
  `reviveActions` and `ACTIONS_PATH`; `Outcome.of(status, init)` rebuilds an
  outcome from JSON. `@crombolo/crombolo/routes` binds the types to the site's
  services and member; `@crombolo/crombolo` exports `actionState`.
- **The config:** `actions`, module by module; `actionRegistry`
  (`packages/server/src/actions.ts`) refuses a non-function export, a dotted
  key or one function listed twice, and the boot stops on them.
- **The endpoint:** `POST /crombolo/actions/{id}`, answered in `route()` beside
  the island loader and never on an `api` node, through `siteRoutes.invoke`.
  `__return` (a path on this site, else `/`) and `__antiforgery` are taken out;
  a thrown outcome (`redirect()`) is caught. A form post is a 303 with the
  result in `crombolo-action`, signed with the forms' secret
  (`writeSignedFlash` and `readSignedFlash`, generalised from core forms'); a
  JSON caller gets the result, or `{ redirect }`. Fields named like a password
  are not sent back.
- **Rendering:** `withAction` in `jsx-runtime.ts` writes a function `action` as
  the action's address with `method="post"`, `enctype="multipart/form-data"` and
  the hidden fields, and a function `formAction` as `formaction`; the attribute
  types accept an action. `actionState(fn)` reads the flash once and makes the
  page private; `renderPage` clears it.
- **Islands:** `serializeProps` writes a listed action as `{"$action": id}`;
  the React mount revives it; `#actions/…` is server-only to client modules.
- **Templates:** a rendered site's `package.json` maps `#actions/*` and it gets
  `actions/`; a template's `files/actions/*.ts` are copied and listed in the
  generated config.
- **The demo:** Harbourstone's bottlings have a "Remind me" form
  (`actions/bottlings.ts`, `components/shared/remind-me.tsx`).
- **Tests:** `tests/server-actions.test.ts`; the CLI end-to-end suite renders
  and checks the demo's action on a new site.
- **Docs:** `docs/rendering.md` ("Server actions"), `docs/writing-components.md`,
  the release notes.
- **Not built:** the demo's island does not use an action; the island path is
  covered by the tests above.
