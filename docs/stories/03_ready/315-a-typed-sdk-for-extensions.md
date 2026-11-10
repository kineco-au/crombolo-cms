# 315 — A typed SDK for extensions

**Epic:** I — Hardening · **Priority:** could · **Size:** L
**Depends on:** 308

## Story

As someone writing an extension, I want typed helpers for the areas my extension
uses, such as content, members, forms and the dictionary, so that I do not have to
work out the Management API's paths and request shapes for every call.

## Context

Story 308 gives an extension the Management API and the CMS's back-office API,
gated by its grant, through one `api` capability: `api.get('management/api/v1/document/<key>')`
(`BundleApi`, `packages/server/src/bundle-api.ts`). It is complete, but untyped and
Umbraco-shaped. Each permission's reach is a list of paths in `API_PERMISSIONS`, and a
call outside its grant throws `ApiRefusedError`:
`reports may not POST <path>: it needs content.write, which it was not granted.`

Site code has a typed `site().content` (story 298) for pages, with values by alias.
It runs in the CMS, and maps values with the content type's properties
(`site-content-values.ts`). An extension runs in a Deno process of its own (story
311), which reaches the CMS only through the channel.

The areas come from two places:
- **The Management API,** described by `packages/contracts/OpenApi.json`, with types
  generated into `packages/contracts/generated/management-api.d.ts`
  (`bun run generate:types`): content, members, users and content types.
- **The CMS's own `crombolo/api/` routes,** which no OpenAPI document describes: forms,
  form entries, dictionary words, webhooks and approvals (workflows).

## Decisions (2026-11-10)

- **The helpers are wrappers over `api`, in the SDK.** They live in
  `@crombolo/extension` and run in the extension's process. Each one is a typed call
  to the paths its permission already reaches. They add no capability, no channel
  message and no reach of their own, and the grant check stays where 308 put it.
  - This has a cost for content: writing values by alias needs the content type's
    properties, to know which vary by culture. So `content.create` and
    `content.update` with `values` by alias read the document type through `api`,
    which needs `contentTypes.read` beside `content.write`. Without it they refuse,
    naming `contentTypes.read`, and the Management API's own values list is still
    accepted as `rawValues`.
  - Reading by alias needs no more than `content.read`: each stored value says its
    own culture.
  - The rejected alternative was a host-side `content` capability reusing
    `site-content.ts`'s mapping, which would need no extra grant.
- **Types:**
  - The Management API areas take their types from the generated OpenAPI types.
  - The `crombolo/api/` areas take theirs from the TypeScript types their server
    routes already use, exported for the purpose. No OpenAPI document is written for
    them.
- **One story, every area.** It is not split.

## The design

- **Entry point:** `areas(api)` from `@crombolo/extension`, given `ctx.bundle.api`,
  returns one object per area:

  ```ts
  import { areas } from '@crombolo/extension'
  const { content } = areas(ctx.bundle.api)
  const page = await content.get(key)
  if (!page.ok) return page
  ```

- **The areas,** each with list and get, and the writes its write permission allows:

  | Area | Read permission | Writes, with their write permission |
  |---|---|---|
  | `content` | `content.read`: `get`, `children` | `content.write`: `create`, `update`, `publish`, `unpublish`, `delete` |
  | `members` | `members.read` | `members.write`: create, update, delete |
  | `users` | `users.read` | none: read only |
  | `forms` | `forms.read` | `forms.write` |
  | `formEntries` | `formEntries.read` | `formEntries.write` |
  | `dictionary` | `dictionary.read` | `dictionary.write` |
  | `contentTypes` | `contentTypes.read` | `contentTypes.write` |
  | `webhooks` | `webhooks.read` | `webhooks.write` |
  | `workflows` | `workflows.read` | `workflows.write`: approve, reject |

- **Content as `site().content` has it:** `get` and `children` return values by
  alias, by culture where a property varies, and `create` and `update` take them. The
  value mapping moves from `server/src/site-content-values.ts` to `@crombolo/common`,
  so both use one copy. `publish` and `unpublish` take `cultures`, and an approval
  workflow may hold a publish, which the answer says.
- **Answers are `Result` values,** as `site().content`'s are: `ok(value)`, or an
  `Outcome`.
  - A call outside the grant is a 403, with `ApiRefusedError`'s words unchanged.
  - A missing item is a 404.
  - The API's own validation is a 400, carrying its problem details.
  - A helper never throws for an answer the API gave.
- **Where the types come from:**
  - Management API areas use `components['schemas']` and `paths` from
    `@crombolo/contracts`, a type-only dependency of the SDK.
  - `crombolo/api/` areas use the request and response types their routes declare,
    exported as types from `@crombolo/crombolo/bundle`, as the SDK's other types
    are (`packages/extension/src/types.ts`).
- **Drift fails a test:**
  - Each helper names the path and method it calls in one table.
  - The test checks every Management API entry against `OpenApi.json`
    (`listOperations`), and every `crombolo/api/` entry against the routes the server
    registers.
  - A type test (`tsc` over a fixture) checks each helper's types against the
    generated ones, so re-vendoring a changed contract fails the check rather than
    an extension.
- **Every path a helper calls** is one `API_PERMISSIONS` gives its permission. A test
  checks it, so no helper can need a permission it doesn't name.
- **Docs:**
  - `docs/extensions.md` documents the helpers beside `api`, with the permission each
    needs, including `contentTypes.read` for content values by alias.
  - `bundles.md` points there.
  - The release notes say so.

## Acceptance criteria

- [ ] `areas(api)` gives typed helpers for content, members, users, forms, form
      entries, the dictionary, content types, webhooks and workflows.
- [ ] Each helper refuses what the grant does not hold as a 403 `Outcome` with the
      words `api` uses, and returns the API's 404 and 400 answers as `Outcome`s rather
      than throwing.
- [ ] Content reads and writes values by alias as `site().content` does, through one
      shared mapping. Writing by alias without `contentTypes.read` is refused naming
      it, and `rawValues` works with `content.write` alone.
- [ ] The Management API helpers' types come from the OpenAPI document, the
      `crombolo/api/` helpers' from their routes' exported types, and a test fails
      when either drifts.
- [ ] A test fails if a helper calls a path its permission doesn't reach.
- [ ] A test extension running in its Deno process uses the helpers in place of raw
      paths for content, a form's entries and the dictionary.
- [ ] `docs/extensions.md` documents them beside `api`, and `bundles.md` points there.
