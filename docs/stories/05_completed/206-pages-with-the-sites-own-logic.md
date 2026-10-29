# 206 — Pages with the site's own logic

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer building a site in VS Code or the back office's template editor,
I want a page's components to read the request, load data for the signed-in
member and stop with a redirect, a not-found or another status. I want this
the way the Next.js App Router does it, so what I know from Next.js works
here unchanged, and member pages render on the server rather than as empty
shells the browser fills in.

## Context

A Crombolo template is already close to a React server component: an async TSX
function that renders on the server, awaits what it needs and reads the page
through `usePage()`, from a render scope held in `AsyncLocalStorage`
(`packages/render/src/context.ts`). What it cannot do:
- **Read the request.** `PageProps.request` is `{ origin, url }`: no parsed
  query, headers or cookies.
- **Stop the render.** A component cannot redirect, answer not-found or set a
  status. Only the page's own `umbracoRedirect` and public access can.
- **Reach the site's data as the visitor.** There is nothing for the site's own
  schema (189), members or media scoped to whoever is asking. Async components
  can fetch, but only over HTTP.

Nature's Calendar's member pages need all three. In `WT-NC`,
`Web/Controllers/RenderMvc/MyRecordsSpeciesController.cs` redirects when the
query lacks a species, and `RecentObservationsController.cs` loads observations
before rendering. See `docs/natures-calendar-gaps.md`, gap 1.

## Decided (2026-10-29)

- **Next.js App Router conventions.** There is no loader and no controller.
  The page component is async and awaits its data. The request comes from
  `searchParams`, `cookies()` and `headers()`. Outcomes are thrown by
  `redirect()`, `notFound()`, `forbidden()` and the rest, from modules that
  mirror `next/navigation` and `next/headers`. A Next.js developer's habits
  carry over, and so does the model of a site built on 208's Next.js front end.
- **Throwing is safe here.** Crombolo renders the whole page before it answers,
  so an outcome thrown at any depth never meets a half-sent response. Next.js
  needs streaming workarounds for this; Crombolo does not.
- **Results stay in the data layer.** The site's services (`site()`) return a
  `Result`, so data code composes with `map` and `andThen` and its failures
  are typed. A component ends the chain with `unwrap()`, which returns the
  value or throws the outcome. Results end at the component boundary.
- **Status names as extras.** Next.js's own helpers come first. The
  HTTP-named helpers (`foundAt`, `movedPermanentlyTo`, `seeOther`,
  `badRequest`, `gone`, `unprocessableContent`) are extras, for answers
  Next.js has no helper for.
- **Our own `Result`, not a library.** It is public API, so a library's major
  versions would become ours. Its failure side is a closed set of HTTP
  outcomes.
- **Not bundle-shaped.** A bundle stays the way a site's code travels between
  sites (192), not the way a page is built.

Considered and set aside, in order:
- controllers declared in a server bundle;
- a Remix-style `loader` returning `Result`s, with throwing as the escape
  hatch;
- returning marker values from components;
- a response object set while rendering.

## The design

```tsx
// components/pages/my-records.tsx
import { headers } from '@crombolo/crombolo/headers'
import { notFound, redirect } from '@crombolo/crombolo/navigation'
import { site } from '@crombolo/crombolo/server'

export const revalidate = false          // optional; see "Caching"

export default async function MyRecords({ member, searchParams }: PageProps<MyRecordsPage>) {
  if (!member) redirect('/sign-in')
  const { species } = await searchParams
  if (typeof species !== 'string') redirect('/my-records')
  const records = (await site().sql.records(member.key, species)).unwrap()   // throws notFound
  return <RecordList records={records} />
}

export async function generateMetadata({ searchParams }: PageProps<MyRecordsPage>) {
  return { title: `My records: ${(await searchParams).species}` }
}
```

**From `@crombolo/crombolo/navigation`**, mirroring `next/navigation`. Each
throws, from any component, layout or block:

| Function | Status | As in Next.js |
|---|---|---|
| `redirect(url)` | 307 | yes |
| `permanentRedirect(url)` | 308 | yes |
| `notFound(message?)` | 404 | yes |
| `forbidden(message?)` | 403 | yes |
| `unauthorized(message?)` | 401 | yes |
| `foundAt(url)` | 302 | extra: the everyday redirect `umbracoRedirect` answers |
| `movedPermanentlyTo(url)` | 301 | extra |
| `seeOther(url)` | 303 | extra: after a POST |
| `badRequest(message?, errors?)` | 400 | extra: a request the page cannot use |
| `gone(message?)` | 410 | extra |
| `unprocessableContent(errors)` | 422 | extra: well-formed input failing validation |

- **Errors** are `{ field, message }[]`.
- **A message** tells the status page what to say for this case, such as
  `notFound('No records for that species')`. The status page reads it from
  `usePage().outcome`. It is the visitor-facing text, so it is always shown,
  unlike a 500's details.
- **Code that catches errors for its own reasons** calls `rethrow(error)`,
  as Next.js's `unstable_rethrow` does, so outcomes pass through.
- **No 5xx helpers.** A server error is anything else thrown, and answers
  500 through the error page (below).
- **What answers each status** is set out in "Status pages" below.

**From `@crombolo/crombolo/headers`**, mirroring `next/headers`:
- `await cookies()` and `await headers()`, both read-only;
- the page's `searchParams` prop, a promise of the query as in Next.js 15.

There are no `params`: a page's address comes from the content tree, not a
dynamic segment, and the page's content is `model`.

**From `@crombolo/crombolo/server`:** `site()` is the site's services acting
as the visitor. Each returns a `Result`:
- `site().sql`, the site's own schema, arrives with story 189;
- `site().members` arrives with story 207;
- `site().media`, the protected media this visitor may read, arrives in this
  story. Media the visitor may not read answers `notFound`, never
  `forbidden`, as `/media/` answers 404, so the code cannot learn that a
  protected file exists.

In preview the visitor is the previewing editor, with no member. Templates
are trusted site code already. The scoping is so a member's page cannot reach
another member's data by mistake, not a sandbox.

**`Result`.** `Result<T> = Ok<T> | Outcome`, where each outcome is tagged with
its status code.
- **Methods:** `map`, `andThen` and their async forms, `match` (exhaustive),
  `unwrap()` (the value, or throws the outcome), and `unwrapOr(fallback)`.
- **Free functions:** `isOk`, `isOutcome` and `Result.all`.
- **Data code builds its failures** with `Outcome.notFound()`,
  `Outcome.forbidden()`, `Outcome.unprocessableContent(errors)` and the rest.
  These are values; only `navigation`'s functions throw.

**Status pages.** The site's configuration names a page in the CMS, by path,
for each status a visitor can be shown:

```ts
// crombolo.config.ts
export default defineConfig({
  pages: {
    notFound: '/not-found',        // 404
    unauthorized: '/sign-in',      // 401
    error: '/something-went-wrong', // 400, 403, 410, 422 and 500
  },
})
```

- **Each is a path in the site's content tree,** resolved the way a request
  for it would be: per hostname and in the request's culture. A rule list,
  `[{ path, host?, culture? }]`, picks one per hostname or language, as
  `seo.notFoundPage` does, and the most specific match wins.
- **The page renders with the outcome's status,** in its own template and
  layout, at the address the visitor asked for. It is not redirected.
- **The template is told what happened** through `usePage().outcome`: the
  status, the message the code gave, any field errors, and for a 500 an error
  reference. The details
  show only when allowed (below).
- **`pages.notFound` replaces `seo.notFoundPage`,** which stays as an alias
  and still takes a page key.
- **Fallback:** a path that does not resolve, or a status page that itself
  fails or throws an outcome, falls back to a generic page for that status.
  It never loops. The boot warns about a configured path that does not
  resolve.
- **Showing error details.** `CROMBOLO_SHOW_ERROR_DETAILS` (`errors.showDetails`
  in the config) shows a 500's message, the template's file and line, and the
  stack, on the error page and the generic page. It defaults to on in
  development and off otherwise. With it off, a visitor sees only the error
  reference, which the log line carries too.

**Folder templates.** A template may be a folder, as a Next.js route is:
`pages/my-records` resolves to `pages/my-records.tsx` or to
`pages/my-records/page.tsx`, so a page's partials can sit beside it.

**No per-template status pages** (decided 2026-10-29). Next.js's
`not-found.tsx`, `error.tsx` and the rest beside a page are left out: a
Crombolo template is usually one file, with nowhere for them to sit. The
configured status pages, with the message an outcome carries, cover saying
something specific for one page. They can be added for folder templates later
if sites ask for them.

**Caching.** Caching is inferred unless a page says otherwise:
- **Personal by use.** Reading `searchParams`, `cookies()`, `headers()`,
  `member` or anything personal from `site()` makes the answer
  `private, no-store` and keeps it out of the page cache, as reading
  request-time values makes a Next.js route dynamic. A page that reads none
  is cached exactly as today.
- **Route segment config overrides inference:**
  - `export const dynamic = 'force-dynamic'` is always personal;
  - `'force-static'` makes `cookies()`, `headers()` and `searchParams`
    empty and `member` undefined, so the page can always be shared;
  - `export const revalidate = <seconds> | false` sets the page's cache
    lifetime, overriding its content type's and the site's.

**Metadata.** An optional `generateMetadata(props)` returns the subset of
Next.js's `Metadata` that `<SeoHead>` writes (title, description, canonical,
alternates, robots, Open Graph image). It is merged over the page's search
and sharing fields.

## Acceptance criteria

- [x] `@crombolo/crombolo/navigation` exports the functions above. Each throws
      an outcome from any component, layout or block, and the page answers its
      status. Redirects refuse protocol-relative URLs, `javascript:` URLs and
      values that would break a header, as a template error.
- [x] `rethrow(error)` rethrows outcomes and returns for anything else. Any
      other thrown error still takes the error path, and an outcome thrown
      after the render's time limit is ignored.
- [x] `@crombolo/crombolo/headers` exports `cookies()` and `headers()`,
      read-only, and pages receive `searchParams` as a promise. Called outside
      a page render, they throw naming the function, as `usePage()` does.
- [x] `site()` returns the visitor's services, with `media` available now.
      `sql` and `members` are typed slots that 189 and 207 fill.
- [x] `Result` with its methods, free functions and `Outcome` constructors,
      with exhaustive types. `unwrap()` throws the outcome, which answers like
      the matching `navigation` function.
- [x] `pages.notFound`, `pages.unauthorized` and `pages.error` in the config
      name content by path, or by rules per hostname and language. Each
      outcome renders its page at the requested address, with its status and
      `usePage().outcome`. `seo.notFoundPage` still works.
- [x] An unresolved path, or a status page that fails, falls back to a generic
      page for the status, without looping. The boot warns about a path that
      does not resolve.
- [x] `CROMBOLO_SHOW_ERROR_DETAILS` / `errors.showDetails` (default: on in
      development only) controls whether a 500 shows its message, source
      location and stack. With it off, only the error reference shows, and the
      log line carries the same reference.
- [x] A template may be a folder with `page.tsx`, found under the same alias as
      a single file.
- [x] Caching is inferred from use: one URL rendered for two members never
      shares an answer. `dynamic` and `revalidate` exports override inference
      as described, and `'force-static'` empties request values.
- [x] `generateMetadata` is merged over the page's search and sharing fields in
      `<SeoHead>`.
- [x] Preview runs the same code, with the previewing editor as the visitor and
      no member. A redirect in preview shows the editor a notice naming the
      status and target, rather than navigating the frame away.
- [x] `docs/rendering.md` ("Request pipeline", and a section on server code),
      `docs/writing-components.md` and `docs/api.md` describe it, with a table
      mapping each Next.js convention to Crombolo's. The new entry points are
      in the API surface snapshot.
- [x] Unit tests cover each navigation function at depth, `rethrow`,
      `cookies()`, `headers()` and `searchParams`, `Result` and `unwrap`,
      status pages and their fallbacks, error details on and off, folder
      templates, caching inference and the overrides, metadata merging,
      preview and the refused URLs.

## Implementation (2026-10-29)

- **`Result` and `Outcome`** live in `packages/core/src/result.ts`, pure, with
  `assertSafeLocation`. An outcome is branded with `Symbol.for`, so two copies
  of the module agree on `isOutcome`.
- **The render package** gains `navigation.ts` and `headers.ts` as subpaths
  (`@crombolo/render/navigation`, `/headers`: the root already exports the
  redirect-table `redirect`), and `site.ts` (`site()`, the service types,
  `unavailableServices` for the `sql` and `members` slots). The render scope
  (`context.ts`) carries the request's headers, the `site` factory, a personal
  marker and the metadata. `createContext`'s provider now keeps the whole outer
  scope rather than only the page.
- **The renderer** loads the page module first. It reads `dynamic`,
  `revalidate` and `generateMetadata` from the module, and returns
  `{ status: 'outcome' }` for a thrown outcome. `ok` and `outcome` results carry
  `personal` and `revalidate`. `searchParams` is a `Promise` subclass whose
  `then` marks the page personal: `await` never calls `then` on a plain promise.
  `componentPath` finds `<alias>/page.tsx`. `describeError` gives a 500's
  message, location and stack.
- **The server** maps outcomes in `renderSite`. The new files are:
  - `status-pages.ts`: resolution by path and rule, the generic page, and the
    preview notice;
  - `site-services.ts`: `media.get` and `children`, checked with `memberMay`.

  `config.pages` and `config.errors.showDetails` come from
  `CROMBOLO_SHOW_ERROR_DETAILS`, defaulting to `development`.
- **Discovery** (`components.ts`) reports `x/page.tsx` as `x`, except under
  `blocks/` and `emails/`. The back office's template file store edits a
  folder template in place. `crombolo components new --folder` writes one.
- **Entry points** are `@crombolo/crombolo/navigation`, `/headers` and
  `/server`, in the API snapshot.
- **Tests:** `tests/result.test.ts` and `tests/page-logic.test.tsx`.

**Decided while building:**
- **Reading `member` on a signed-out request does not make the page personal.**
  Spreading a page's props (`<SeoHead {...props} />`, a layout's props) reads
  every prop, so it cannot be told apart from a real read. Inferring from it
  would make nearly every page uncacheable. A request with a member is
  personal, as before, unless the template is `force-static`.
- **An address nothing answers keeps the plain `Not Found`** on a site with no
  not-found page configured at all. The generic page answers outcomes, and
  configured pages that fail.
- **`revalidate = false`** is sent as a year's `max-age`, for a CDN that purges
  by tag. A page's own "Keep copies for" still wins over `revalidate`.
