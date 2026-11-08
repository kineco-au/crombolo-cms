# 298 — Site code writes content and handles its events

**Epic:** O — Building a site · **Priority:** should · **Size:** L
**Depends on:** 187, 206

## Story

As a developer whose site turns visitors' submissions into pages, imports
listings overnight, or keeps its own tables in step with what editors publish,
I want `site().content` to create, update, publish and delete documents, and an
`events` key in my config for content events, so that this is ordinary site
code rather than a server bundle or calls to the Management API.

## Context

`site()` (206) gives a site's own code media to read, named queries, members (a
slot, 207) and jobs. It has no way to change content: a route, an action or a
job that needs to create a page has to sign in to the Management API as an API
user, over HTTP, from inside its own site.

Content events reach only a server bundle's `events` handlers
([`webhooks.md`](../../webhooks.md), "A bundle's handlers"). These get the
event's key, `fetch` and a log, but never the database or `site()`. A site
that keeps a table in step with published pages, or clears something when a
page is deleted, therefore has to send a webhook to its own route and queue a
job from there.

Both are common in sites that are part application.

## The design

- **`site().content`**, in the same `Result` style as the rest of `site()`:
  - `get(key)`, `children(key)`;
  - `create({ parent, contentType, name, values, culture? })`;
  - `update(key, { name?, values })`;
  - `publish(key, { cultures? })`, `unpublish(key)`, `delete(key)` (to the
    recycle bin).
- **Who it acts as:** a named API user the site's config names
  (`content: { actAs: 'site-code' }`). That user's permissions bound what the
  code may do, and every change is audited as that user, with the route,
  action, job or event that made it. Without `actAs`, each write answers
  `forbidden`, saying so. A visitor's own identity is never used for content
  writes.
- **Values** are checked with the same rules as the Management API: the
  content type's properties, editors and validation. A failure is an `Outcome`
  (`unprocessableContent` with the field errors), never a throw.
- **Workflows** (approval) apply: a publish that a workflow gates answers that
  it is awaiting approval, as the back office does.
- **`events`** in `defineConfig`:
  `events: { 'Umbraco.ContentPublish': handler, … }`, with the same event names
  as webhooks. A handler is `(event, { db, site, job })`, where `event` carries
  the key, the content type, the cultures and who acted. Each event is queued
  as a background job (187), so delivery is at least once, retried as jobs
  are, and runs on a node that owns writes. A change made by a handler raises
  events like any other, and a handler that changes the document it was called
  for is not called for that change again.
- **Refused at boot:** an event name that does not exist, a handler that is
  not a function, and `actAs` naming no API user.

## Decisions (2026-11-08)

- **Values by alias.** `values: { title: 'Harbour view', price: 450000 }` for an invariant
  property; `{ title: { 'en-GB': 'Hello', 'fr-FR': 'Bonjour' } }` for one that varies by culture.
  `get` and `children` answer in the same shape, converted to and from the stored editor shape
  inside, so the Management API's `[{ alias, culture, segment, value }]` never reaches site code.
- **Events run as site jobs.** The outbox dispatcher, which already feeds webhooks and bundle
  handlers (`webhooks.ts`, `subscribersFor`), gains the site as a subscriber and queues a site job
  per event. The handler is `(event, { db, site, job })`, retried on the jobs' back-off, and shown
  in the jobs list with the site's other jobs.
- **Page renders read, never write.** `get` and `children` work wherever `site()` does; a write
  from a page render answers `forbidden`, saying to write from an action, a route, a job or an
  event. Routes, actions, jobs and event handlers write.
- **`actAs` names the API user by its client id**, which is unique and shown in the back office's
  API user list.

## Implementation plan

1. **Config and boot** (`packages/crombolo` `defineConfig`, `packages/server` config checks):
   - `content: { actAs: string }` and `events: Record<alias, handler>` on the config type.
   - Boot refuses: an event alias not in `WEBHOOK_EVENT_ALIASES`, a handler that is not a
     function, and an `actAs` that `UserRepository.clientCredentialOwner` finds no API user for
     (reusing `bundleEventProblems`' wording for the first two).
2. **Acting as the API user** (`packages/server`, new `site-content.ts`):
   - The API user's `ContentPrincipal` is resolved once per write from its client id, as the
     Management API resolves a client-credentials token, so its groups, start nodes, languages
     and approvals apply (`userActor`).
   - `ActorOrigin` gains `via`: `route /api/listings`, `action createListing`,
     `job imports.nightly`, `event Umbraco.ContentPublish`. The audit entry and notifications
     say it, as `actorNote` does for the system actor.
3. **`site().content`** (`packages/render` `site.ts` types; `site-content.ts` behind them):
   - `get` and `children` read the draft through the document port, answering by alias.
   - `create`, `update`, `publish`, `unpublish` and `delete` (to the recycle bin) call
     `createDocumentOperations`' `create`, `save`, `publish`, `unpublish` and `trash`, so values,
     validation, permissions and workflows are the Management API's. Outcomes:
     - `forbidden` for permissions, and for no `actAs`, saying why;
     - `unprocessableContent` with the fields for invalid values;
     - when a workflow gates a publish, `badRequest` whose message says it needs approval and
       why (the operations' `needsApproval`). The `Outcome` statuses are a fixed set, so no new
       one is added.
   - **Value conversion** is pure (`site-content-values.ts`): by-alias to editor-shaped and back,
     using each property's variance from the content type. A culture-keyed object for an
     invariant property, or a plain value for a varying one, is an `unprocessableContent`.
   - **Where it's available:** `createSiteServices` gains `content`. The render scope marks
     whether it is a page render, a route, an action, a job or an event, and writes from a page
     render answer `forbidden`.
4. **Events** (`webhooks.ts` dispatcher, `owner-jobs.ts`):
   - `subscribersFor` adds `site` when `config.events` has the alias. Delivering to it queues a
     site job, `crombolo:event`, whose payload is the event's facts: key, content type, cultures
     and who acted.
   - The job calls the handler with `{ db, site, job }`, `site()` being the API user's services.
   - **No self-calls:** a change a handler makes carries `via: event <alias> <key>`. The site
     subscriber skips an event raised by a handler's own write to the same document; other
     handlers, webhooks and bundles still hear it.
5. **Docs:** `rendering.md` gains "Writing content" and "Content events"; `webhooks.md`'s "A
   bundle's handlers" points site code at `events`; the release notes.

## Tests

- **Unit:** value conversion both ways (invariant, varying, a mismatch refused); boot problems
  (unknown alias, not a function, unknown `actAs`); the self-call rule.
- **Server** (a harness site with an API user, a content type and a workflow):
  - a route creates a draft under a parent and an action publishes it, both audited as the API
    user naming the route and the action;
  - a write outside the user's start node answers `forbidden`; invalid values answer
    `unprocessableContent` with the field;
  - no `actAs` answers `forbidden`; a gated publish answers `needsApproval`;
  - a page render's write answers `forbidden`;
  - a `ContentPublish` handler writes a row to a site table, a failing one runs again, and a
    handler that updates its own page is not called for that change.
- **Integration:** the CLI's `crombolo start` boots a site with `events` and `actAs`, and refuses
  one with an unknown alias.

## Acceptance criteria

- [x] A route creates a draft page under a given parent, and an action
      publishes it. Both are audited as the named API user, naming the route
      and the action.
- [x] A write outside the API user's permissions answers `forbidden`, and
      invalid values answer `unprocessableContent` with the fields.
- [x] Without `actAs`, each write answers `forbidden`, saying why.
- [x] A publish gated by an approval workflow answers that it is awaiting
      approval (`badRequest`, its message saying so and giving the workflow's reason).
- [x] An `events` handler for `ContentPublish` writes a row to the site's
      tables when a page is published, and runs again after a failure.
- [x] A handler that updates the page it was called for is not called again
      for its own change.
- [x] Boot refuses an unknown event name and an `actAs` with no API user.
- [x] `rendering.md` documents `site().content` and `events`;
      `webhooks.md` points to `events` for site code.

## Implementation (2026-11-08)

- `site-content.ts`: `site().content`, through `createDocumentOperations` as the API user
  (`apiUserPrincipal` builds its principal from the client id as a signed-in client's would be),
  and `withSiteWrites`, the scope a route, an action, a site job or an event handler runs in. A
  page render has none, so its writes answer `forbidden`.
- `site-content-values.ts`: values by alias to and from the stored shape, pure.
- `site-events.ts`: the config's `events` checked at boot, the `crombolo:event` job, and
  `isOwnChange`. The webhook service has `site` as a subscriber (`subscribersFor`), and the event
  sink puts the event's cultures, actor and `via` in the outbox row.
- `ActorOrigin.via` names the code; `actorNote` puts it in the audit entry and notifications.
- **Differences from the plan:**
  - A draft is saved incomplete, as the back office allows; a required value is checked on
    publish. `PublishBlockedError` now carries its field errors, so that publish answers
    `unprocessableContent` with the fields; the Management API's answer is unchanged.
  - The boot refusals are tested on the server harness, not through the command line.
- Tests: `site-content-values` (unit) and `site-content` (server).
