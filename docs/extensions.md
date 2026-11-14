# Extensions in their own process

Story 311. An extension's server half runs in a Deno process of its own, apart
from the CMS, holding nothing it was not granted. The CMS stays on Bun. Why
Deno, and why not the whole CMS, is decision D1 in
[`extension-threat-model.md`](extension-threat-model.md); what an extension may
ask for is [`bundles.md`](bundles.md), "Permissions".

## What runs where

| | Where it runs |
|---|---|
| The CMS, its database connections, its secrets | The Bun process, as before |
| An installed extension the CMS starts (granted, listed under `extensions` or granted in Installed) | A Deno process per extension |
| An extension the site's `crombolo.config.ts` still imports | The Bun process: importing a module runs it, so it is the site's own code, unconfined. The boot warns, and says to list it under `extensions` instead |
| An extension's components (story 312) | Its Deno process: each is a `render` call, and its HTML goes in the page |
| An extension's described screens (story 323) | Its Deno process answers each as data; the back office draws it with its own element. Nothing of the extension's runs in the page |
| An extension's back-office code | The back office, in the browser, as whoever is signed in (story 313). Built from `src/backoffice/` and served only from that build, once `backoffice.code` is granted (story 320) |

## Starting one

At boot, and as one is granted or turned on while the site runs (story 346), for
each granted extension (`startExtension`, `packages/server/src/extension-discovery.ts`),
installed in its own root, `extensions/<id>/` (story 326; one installed as a
dependency of the site is named and not started):

1. **It is built** (`buildExtension`, `extension-process.ts`): Bun bundles the
   package's server entry, resolved from its root, its own dependencies and the extension SDK into one
   file, `.crombolo/extensions/<id>/build/server.js`. Nothing of it runs in the
   CMS while it is built: a Bun macro, which would, is refused.
   `@crombolo/crombolo/bundle`, `@crombolo/extension` and `@crombolo/common` all
   resolve to the CMS's own copy of the SDK.
2. **It is started** under Deno, with:

   | Flag | What it allows |
   |---|---|
   | `--allow-read` | its package directory, its build, and its data folder |
   | `--allow-write` | its data folder, `.crombolo/extensions/<id>/data`, and nothing else |
   | `--allow-net` | the hosts of the origins its grant gives `http.outbound`; nothing when it asks for none |
   | `--v8-flags=--max-old-space-size=256` | a 256 MB heap |
   | `--no-prompt --no-remote --cached-only --no-config --no-npm --no-lock --node-modules-dir=none` | it loads only what it was built with, and asks for nothing at run time |

   Everything else is Deno's default, which is no: no environment (`Deno.env`
   is refused, and the process is started with none of the site's), no other
   files (`.env`, the SQLite file, `crombolo.config.ts`), no programs, no native
   code, no other hosts.
3. **It describes itself:** the SDK's runner calls the factory `crombolo.server`
   names with the extension's settings, and sends back its id, section,
   capabilities, routes, tables, events, jobs, schedules, media folders and form
   workflow types.
4. **It is mounted** (`isolatedBundle`): an ordinary `ServerBundle` built from
   that description, whose handlers send each call to the process. The host's
   checks (`bundles.ts`, story 309's grant) run on it exactly as on one
   in-process, before anything is sent.

One that cannot start is left off and the site starts, or runs on, without it.
Installed shows "Could not start" with the reason, and so does the health check
"Installing code"; a grant or a Turn on made while the site runs says it in its
answer too. The reasons:
- it fails to build, or to load under Deno: a Bun API such as `Bun.file` or
  `bun:sqlite`;
- its factory throws;
- it offers `middleware`, which only the site's own code may (it would put a
  round trip on every request);
- it adds form field types, whose markup renders inside the page (story 312);
- on Postgres, its tables' role cannot be created by the CMS's database user
  (`OwnerSetupNeededError`, which says what to run). A host avoids it by making
  the role first with `ownerSetup` (story 321, `data-model.md`);
- started while the site runs, a site route another already answers, which the
  reason names with its owner.

## The channel

The CMS and the extension talk over the process's standard input and output, in
frames of JSON, each prefixed with its length (`@crombolo/extension/channel`).
The extension's console is sent to the site's log, since standard output is the
channel.

- **Calls from the CMS:** a route, an event, a job, a form workflow's run, a
  table step's backfill. Each carries what the handler is given, encoded:
  - data as data, dates, bytes, maps, URLs, errors and a route's `Result`
    tagged so they arrive as themselves;
  - each function (a capability method, `setCookie`, `member()`,
    `job.progress`) as a number in that call's table, which the extension calls
    back. The table is dropped when the call answers, so a capability kept for
    later no longer works;
  - each `AbortSignal` as a number, aborted on the other side when it aborts
    here.
- **Bodies are streamed** in 64 KB chunks: a request's body is sent as the
  extension reads it, and a response's as the extension writes it. A route that
  hands its own request to `media.create` sends it back by reference, unread.
- **`site()`** is not offered: an extension reads content through `bundle.api`.

## Components

Story 312. An extension's factory declares its components as it declares its
routes, `components: { brochure, card }`, each a render function or a module with
a `default` and, for a page template, the `layout` it suggests. They are built
into the same file as its server half.

- **What renders where:** the page, its layouts and the site's components render
  in the CMS. When the render reaches one the extension owns (`<id>/<name>` as a
  page's template, `blocks/<alias>` as a block's, or `<Extension use>`), that one
  component is a `render` call (`extension-components.ts`), and its HTML goes in
  its place. The renderer finds it where the site has no component of that path
  (`Renderer`'s `extensionComponents`).
- **The page, live:** its props cross as any call's context does. A page's
  `model`, its values and `nav` are lent by reference: their methods are calls
  back to the CMS, and an object passed back (`nav.children(model)`) arrives as
  itself. Each lent function runs in the render's own async context, so what
  marks a page personal still does. `searchParams` is asked for only when read.
- **The layout:** a page template sits in the site layout its `layout` setting
  names, a setting of type `layout` the install panel and `extension install
  --layout` offer, preselecting the extension's suggestion when the site has it.
  Without one, the layout the component suggests is tried, and failing that the
  page renders on its own.
- **`templates`:** without it, its components render nothing, and the log says
  why.
- **No script reaches the page** (story 330). What a component renders is held to
  the HTML Sanitizer API's safe baseline, the part of `setHTML()` no configuration
  turns off (`sanitiseHtml`, `@crombolo/render`): `script`, `iframe`, `object`,
  `embed` and `frame`, and SVG's `script` and `use`, go with what is inside them;
  every event handler attribute goes; a `javascript:` URL on `a` and `area`
  `href`, `form` `action`, `button` and `input` `formaction`, SVG `a` and MathML
  `href` goes, however it is written. Classes, styles, images and the rest stay as
  written. The lists are copied from the standard's data, and a test holds them to
  it. What was removed is logged once a boot for each component. The site's own
  components are its code, and untouched.
- **Refused at build:** browser code (`'use client'`, `'use deferred'`), and
  importing any of the CMS's packages but `@crombolo/extension`,
  `@crombolo/crombolo/bundle`, `@crombolo/common` and the JSX runtime.

## Screens

Story 323. A screen is data the server half returns, from a small catalogue, and
the back office draws it with its own components. No markup, script or style of
the extension's reaches the page, so a described screen needs no permission: it
can show only what the server half can fetch, which its grant governs.

```ts
import { button, cell, field, form, row, screen, table } from '@crombolo/extension'

export function redirects() {
  return {
    id: 'redirects',
    section: 'settings',
    capabilities: ['redirects'],
    screens: {
      rules: {
        view: async ({ bundle }) => screen('Redirects', [table(['From', 'To'], rows(await bundle.redirects.list()))]),
        actions: { save: async ({ bundle, input, state }) => ({ screen: …, state, notice: 'Redirect added.' }) },
      },
    },
  }
}
```

- **Where it appears:** a manifest entry names it with `"screen": "<id>"` in place of
  `element`, at `"crombolo.schemaVersion": 6`. An entry names a screen or a module,
  never both, and a screen needs a server half. The server points the entry at the
  back office's own element, `crombolo-extension-screen`, told the extension and
  the screen in `meta.cromboloScreen`.
- **The catalogue:** `screen` (a title, a toolbar of buttons and a `search`, a body);
  `table` with `text`, `code`, `tag`, `link` and `date` cells and per-row buttons;
  `form` with `text`, `number`, `boolean`, `choice`, `page`, `media`, `member` and
  `secret` fields, and from story 329 a `list` field (rows of `text`, `number`,
  `boolean` and `choice` sub-fields, added and removed in the browser, within its
  `min` and `max`, sent as an array of objects); any field may be `readOnly`,
  drawn disabled and never sent back; `button`; `notice`; `problem`; `empty`; `tabs`, with no tabs
  inside; `progress`. The builders are exported from `@crombolo/extension`, and
  the types from `@crombolo/extension/screens`. It grows by request: each addition
  is host code.
- **The call:** `POST <back office>/crombolo/api/bundle/<id>/_screen/<screen>` with
  `{ action?, input?, state? }`, gated on the extension's section as its routes
  are. A view or an action is given `bundle`, `caller`, `principal`, `state`,
  `input` and `signal`, as a back-office route is, and answers a screen or
  `{ screen, state?, notice? }`. The back office keeps `state` per open screen and
  sends it back, so the process holds nothing between calls. A handler that
  throws, a refused capability included, answers `{ problem }`, and the last
  screen stays with the message above it.
- **What stays in the browser:** a field's `visibleWhen`, a hint's `when`, a
  field's `required`, `pattern` and length or range, and a button's `confirm`,
  asked in the back office's own dialog. A button with `submit` sends its form's
  visible values as `input.values`, once they pass. A `page`, `media` or `member`
  field opens the back office's own picker, with the user's own permissions, and
  the extension receives a key.
- **Held to the catalogue twice.** The server normalises every answer
  (`extension-screens.ts`): an unknown node is dropped and logged once per call
  in the extension's log, every displayed string is a string, a link is kept
  only to `http`, `https`, a path on this site or `section/…`, and a `secret`
  field's value is never sent to the browser. The element then sets every string
  as text, and never uses `unsafeHTML`; a test says so.
- **Back-office code stays** for what a description cannot express, under
  `backoffice.code` (story 320). An extension may describe most of its screens
  and ship code for one.

## Watching one

Story 327. Everything an extension does through the CMS is recorded, attributed to
it and to the person it acted for, and Installed opens it under "See what it did":
its counts by kind over the window at the top, then each row newest first,
filterable by kind and by person, with an export as CSV.

- **What a row is:** a write, a request out, rows written to its own tables, a
  refused call, a route, event, job or workflow it ran, and a screen opened or
  pressed. Reads of one kind for one person fold into one row a minute, "read
  pages, 50 times".
- **What a row holds:** the kind, the area (the capability, the API's area, the
  host, the table, the route or the screen), the verb, a key from the path when it
  names one, a count, the outcome and the time taken. Never a statement, a request
  body or a value.
- **Where it is recorded:** where each call is already named, not on the channel:
  the capability gate (`gated`), the `api` capability, the `fetch` wrapper, the
  query handler in `ExtensionProcess`, and `isolatedBundle`'s calls.
  `extension-activity.ts` batches the rows a second apart, so a crash loses at most
  a second; the audit log still has every write the API made.
- **How long:** `CROMBOLO_EXTENSION_ACTIVITY_DAYS`, 14 by default, `0` to keep none,
  pruned hourly, and at most 100,000 rows an extension, oldest first.
- **The routes:** `GET <back office>/crombolo/api/extensions/installed/<id>/activity`
  with `before`, `limit`, `kind`, `person` (a key, or `itself`), `since` and `until`;
  `…/activity/summary`; `…/activity.csv`.

## Its own tables

`context.bundle.database` is a Kysely in the extension, whose driver sends each
query's operation tree to the CMS. The CMS compiles it with the extension's own
handle, on the connection that reaches only its tables (Part 4 of
[`bundles.md`](bundles.md)), and runs it only if it is one statement that
reads or writes rows (`extension-sql.ts`). That refuses `ATTACH`, `PRAGMA`,
`RESET ROLE`, `SET ROLE`, `set_config`, `COPY` and a second statement. The
extension never holds a connection or a credential. Transactions are held open
in the CMS between `begin` and `commit`.

On Postgres the connection is the CMS's, confined with `SET LOCAL ROLE` to the
extension's role, which owns its schema and nothing else. The statement check
is what stops the extension's SQL undoing the role.

An extension with tables asks for `data.tables` (story 321), and one asking for
it must have them, so a host can tell from `crombolo.permissions`, before it
installs the extension, that it needs a role and schema of its own.

## When it fails

| It | Then |
|---|---|
| throws | that call fails: a route answers 500, an event or a job is retried as any other |
| exits or crashes | every call in flight fails, and the next call starts it again, after a back-off that doubles from a second to a minute |
| hangs | its call fails after 30 seconds (`extensions.<id>.timeoutMs`); a process that then does not answer a ping in 2 seconds is stopped, and started again |
| is idle | stopped after 5 minutes without a call, unless it answers routes; the next event or job starts it |

The site keeps serving throughout.

## Writing one

An extension imports `@crombolo/extension` (a dev dependency for its types;
the CMS supplies its own copy when it builds it). The API is
`@crombolo/crombolo/bundle`'s, which still works: `route`, `defineBundleTables`,
`hasSection`, `hasCultureAccess`, the `Result` helpers, and the types. It runs on
Deno, so it uses web APIs, `node:` built-ins Deno supports, and the host's
capabilities; not Bun's.

A form workflow type's `run` is called over the channel. Its `validate` is not,
since the form designer checks settings synchronously: its settings are held to
their declarations.

**On a developer's machine**, an entry can widen what its process may read and
reach while it is being worked on. The CMS refuses this when `NODE_ENV` is
`production`:

```ts
extensions: {
  crm: {
    grant: ['content.read'],
    dev: { allowRead: ['/Users/me/crm/fixtures'], allowNet: ['http://localhost:4000'] },
  },
},
```

## Deno

- **Where it comes from:** `deno` is a dependency of `@crombolo/server`, pinned,
  with a binary per platform, so `bun install` brings it. The CMS finds the
  platform's binary itself, so its install script is not needed (Bun blocks it).
  `CROMBOLO_DENO` names another binary.
- **Platforms:** macOS, Windows, and glibc Linux. Deno publishes no musl build,
  so a container is `oven/bun:1-slim`, not Alpine; on Alpine the CMS says so
  rather than starting extensions.
- **It is a security dependency:** its permission checks are the boundary, so its
  version is kept current.

## Footprint

Measured on macOS, arm64, Deno 2.9.6, with Simple Redirects (2026-11-09):

| | |
|---|---|
| Starting an extension (spawn, load, describe) | about 30 ms; 190 ms the first time, with its build |
| Its memory | about 27 MB resident |
| The Deno binary | 78 MB on disk |

## Tests

- `tests/extension-isolation.test.ts`: one test per threat the process answers
  (T1, T2, T7, T11, T14), a job over the channel, and an extension that cannot
  run apart being left off.
- `tests/extension-discovery.test.ts`, `tests/simple-redirects.test.ts` and
  `tests/entra-bundle.test.ts` run their extensions in Deno.
- CI runs these on macOS and Windows as well as Linux (`extensions` in
  `.github/workflows/ci.yml`).
