# 323 — An extension's screens are described, not shipped

**Epic:** I — Hardening · **Priority:** must · **Size:** XL
**Depends on:** 311

## Story

As someone who installs extensions, I want an extension's screens drawn by the back office
from a description its server half returns, so that no code of the extension runs in my
browser with my session, and what I review before installing is a permission list rather
than a bundle of JavaScript.

## Context

Story 311 confines an extension's server half in a Deno process. Its screens are not confined:
`backoffice.code` (story 320) loads the extension's modules into the back-office page, where
they hold the signed-in user's session and Umbraco's token. A screen can therefore call the
Management API as an administrator, install another package and grant itself the rest. The
process isolation protects the half that was never the main risk.

Every screen crombolo ships for an extension is a listing, a form or a status card: Redirects
is a table of rules and an editor with six fields; Entra is settings. That is what Google
Workspace add-ons and Slack apps draw for third parties, as data the host renders.

## Decisions (2026-11-11)

- **A screen is data the server half returns.** The factory declares `screens`, each with a
  `view` that returns the screen for a state and `actions` the screen's buttons name. Both
  run over the channel the extension already has, with the grant, `actAs` and `principal`
  exactly as a route has them. No HTTP, no cookie, no token.
- **The host renders it** with its own components, in the back office's own style, and owns
  layout, accessibility and theming. An extension's CSS does not exist.
- **No markup, ever.** The catalogue has no `html` or raw node. Every string an extension
  supplies is set as text. A link is `http`, `https` or a back-office path, or it is dropped.
  The policy from story 313 stands behind that as a second layer.
- **A described screen needs no permission.** The host draws it, and it can show only what
  the server half can fetch, which the grant governs. The manifest's `extensions` still says
  where it appears, and the install panel lists it under what the extension adds.
- **Interactivity that stays in the browser is declarative:** a field's `visibleWhen` and a
  hint's `when` over other fields' values, a field's `required`, `pattern` and length rules,
  and an action's `confirm` text, which the host shows in its own dialog. Typing never
  leaves the browser; a submit, a row action or a toolbar button is one call, and the process
  answers with the next screen and an optional notice. The process is local, so that round
  trip is milliseconds.
- **The page picker is the host's.** A `page` field opens the back office's own picker, with
  the user's own content permissions, and the extension receives a key. It never browses
  content itself. The same for `media` and `member` fields.
- **The first catalogue** is what Redirects and Entra need, and no more: `screen` with a
  title and toolbar; `table` with typed cells (text, code, tag, link, date); `form` with
  `text`, `number`, `boolean`, `choice`, `page`, `media`, `member` and `secret` fields;
  `button` with an action; `notice` and `problem`; `empty`; `tabs`; `progress`; `confirm`.
  It grows by request, and each addition is host code.
- **Where a screen can appear:** a workspace opened from a menu item in a section, a
  dashboard, a panel beside the page editor (story 182's side panel), and an entity action's
  dialog. A property editor is not in this story: it needs the framed tier, which is not
  planned until a real extension asks for it.
- **`backoffice.code` stays** for the Unrestricted level (story 324). An extension may mix:
  describe most of its screens and ship code for the one that must be custom.

## Decisions (2026-11-11, planning)

- **Transport:** a screen call is `POST <backoffice>/crombolo/api/bundle/<id>/_screen/<screen>`,
  answered by `ServerBundles.handle` before route matching, so the cookie, the section, the
  grant and the principal are checked exactly as for a back-office route. No new API.
- **The catalogue lives in the SDK**, `packages/extension/src/screens.ts`: node types and
  builders together. The server's normaliser and the plugin import the types from there.
- **The tree is checked twice:** the server normalises what comes off the channel (unknown
  node types dropped and logged, link protocols checked, every string coerced), and the
  element renders with text bindings only.
- **Browser coverage:** one browser test over a fixture extension exercising every node type,
  run once locally when the renderer lands, then left to CI.
- **Scope:** `tabs` and `progress` are built here, so 329 is a pure port; they are the first
  to drop if the renderer runs long.
- **Slices:** catalogue and SDK; channel and server; manifest (schema 6); the renderer; tests
  and docs.

## The plan (2026-11-11)

What exists and is reused: the Deno channel and its `describe` step
(`packages/extension/src/runner.ts`), `ExtensionProcess.call` and `isolatedBundle`
(`packages/server/src/extension-process.ts`), the back-office bundle routes in
`ServerBundles.handle` (`packages/server/src/bundles.ts`), which already check the cookie,
the section and the grant and build the `BundleCaller`, and `extensionOf`
(`packages/backoffice-host/src/extensions.ts`), which already rewrites an extension's
manifest entries. A manifest-created element receives its `manifest`, which the plugin's
own elements already read.

### Slice 1: catalogue and SDK

- `packages/extension/src/screens.ts`, exported from the SDK's index and as
  `@crombolo/extension/screens`, so the server imports the types. Data only, no imports:
  - `Screen { type: 'screen', title, toolbar?: (Button | Search)[], body: Node[] }`
  - `Node = Table | Form | Button | Notice | Problem | Empty | Tabs | Progress`
  - `Table { columns: string[], rows: Row[] }`, `Row { key, cells: Cell[], actions?: Button[] }`,
    `Cell` of kind `text`, `code`, `tag` (with a look), `link` (text and href) or `date`
  - `Form { title?, fields: Field[], values, actions: Button[] }`; `Field` of kind `text`
    (multiline, pattern, min and max length), `number` (min, max, step), `boolean`,
    `choice` (options), `page`, `media`, `member` or `secret`; each with `label`, `hint`,
    `hints: { when, text }[]`, `visibleWhen`, `required`, `placeholder`
  - `Condition { field, equals?, oneOf?, notEmpty? }`
  - `Button { label, action, input?, look?, confirm?, submit?, disabled? }`: `input` is a plain
    object sent with the action, such as a row's key; `submit` sends the enclosing form's values
  - `Search { action, placeholder?, value? }` in the toolbar, since Redirects filters
  - `Notice { text }`, `Problem { text }`, `Empty { title, text?, actions? }`,
    `Tabs { tabs: { id, label, body }[] }` with no tabs inside tabs, `Progress { label?, value? }`
  - `ScreenResult<State> { screen, state?, notice? }`: a handler returns a `Screen` or this
  - builders: `screen`, `table`, `row`, `cell.*`, `form`, `field.*`, `button`, `search`,
    `notice`, `problem`, `empty`, `tabs`, `tab`, `progress`
- `runner.ts`: `describe` adds `screens: { id, actions: string[] }[]`; `dispatch` gains
  `case 'screen'`, calling `bundle.screens[id].view` or `.actions[name]` with the decoded
  context, and wrapping a bare `Screen` as `{ screen }`.
- `types.ts` re-exports `BundleScreen`, `BundleScreenContext` and `BundleScreenHandler`.
- Check: `export *` from the SDK must not collide with `@crombolo/common`'s names; `form`,
  `table` and `button` are the ones to watch.

### Slice 2: channel and server

- `bundles.ts`: `ServerBundle.screens?: Record<string, BundleScreen>` where
  `BundleScreen { view, actions? }` and a handler takes
  `BundleScreenContext = BundleRouteContext & { principal, state, input, signal }`.
- `handle`: after the section check, a `requested` path of `_screen/<id>` is a screen call.
  `POST` only; the body is `{ action?, input?, state? }`; `isOn` applies; the caller is
  `{ kind: 'backoffice', principal }` and `bundle` is `contextFor(bundle, caller)`, so the
  grant gates every capability as on a route. The answer is JSON `{ screen, state?, notice? }`,
  or `{ problem }` with status 200 when the handler threw, a refused capability included, so
  the element keeps the last screen and shows the message. An unknown screen or action is 404.
- `packages/server/src/extension-screens.ts`: `normaliseScreenResult`. Unknown node types are
  dropped and logged through the bundle's log, once per type per call; every displayed string
  is coerced from a primitive or becomes empty; a link `href` is kept only when it starts with
  `http://`, `https://`, a single `/` or `section/`, otherwise the cell renders as text;
  `progress.value` is clamped to 0 to 100; `tabs` inside `tabs` are dropped; `input` and
  `values` pass through as plain JSON objects.
- `extension-process.ts`: `isolatedBundle` maps `d.screens` to `screens` whose `view` and
  `actions` are `process.call('screen', { screen, action? }, context)`.
  `ExtensionDescription.screens` is added.

### Slice 3: manifest, schema 6

- `bundle-package.ts`: `BUNDLE_SCHEMA_VERSION` 6. An `extensions` entry may carry `screen` or
  `element`, not both; `element` without `backoffice.code` is a problem; a `screen` must name
  one the description lists, checked at boot when the process is ready, and an entry naming
  a missing screen is left out with a log line.
- `extensionOf`: an entry with `screen` becomes
  `{ ...entry, element: '/crombolo-plugin/extension-screen.js', meta: { ...entry.meta,
  cromboloScreen: { bundle: <id>, screen } } }`. `createBackOfficeBuilds.ready` already passes
  an extension with no modules through, so nothing is built and `backoffice.code` is not
  needed.
- `backOfficeModules` ignores `screen`, so the install panel's "Adds" lists it as a screen.

### Slice 4: the renderer

- `packages/backoffice-host/plugin/extension-screen.js`: one `UmbLitElement` for every
  placement, reading `this.manifest.meta.cromboloScreen`. It `POST`s to
  `<backoffice>/crombolo/api/bundle/<id>/_screen/<screen>` with `credentials: 'include'`,
  keeps `state`, and re-renders from each answer. Loading, a `problem` banner that keeps the
  last screen, and a `notice` banner are the element's own.
- `extension-screen-fields.js`: the form, with `uui-input`, `uui-textarea`, `uui-select`,
  `uui-toggle`, and `umb-input-document`, `umb-input-media`, `umb-input-member` for the
  pickers (imported for their side effects, as Redirects does). `visibleWhen` and `hints`
  are evaluated locally from the current values; `required`, `pattern` and lengths are
  checked before a submit and shown inline; a `secret` field starts empty and is sent only
  when typed.
- `confirm` uses the host's confirm modal; a `tag` cell is `uui-tag`; `date` is formatted in
  the user's locale; a `link` with a `section/` href is prefixed with the back-office base.
- Every string is a Lit text binding. `unsafeHTML` does not appear in the file, and a test
  greps for it.
- `umbraco-package.json` does not list the element: the server generates one manifest per
  placement from the extension's entries.

### Slice 5: tests and docs

- `tests/extension-screens.test.ts`, in the isolation suite's style with a fixture extension
  run in a real Deno process through `signedInServer`: `describe` lists the screens; a view
  returns a normalised tree; an action receives `input` and `state` and returns the next
  state; `principal` and a gated capability reach the handler, and a refused one comes back
  as `problem`; a hostile fixture puts a script tag, an `onclick` string and a `javascript:`
  href in every node type and the answer carries them only as text or not at all; an unknown
  node type is dropped and logged; `GET` is refused; a user without the section gets 403.
- `tests/dashboard.test.ts` (manifests): a `screen` entry is rewritten to the generic element
  with `cromboloScreen` in `meta`; `element` beside `screen`, or without `backoffice.code`,
  is a problem.
- `tests/browser/extension-screen.browser.ts`: the fixture's screen renders every node type,
  a form with `visibleWhen` and a confirm round-trips, run once locally.
- Docs: `extensions.md` "Screens" with the catalogue and the call; `bundles.md` Part 3 and
  the schema 6 line in "`package.json` is the source of truth"; `extension-threat-model.md`
  T8 and "Permissions"; `release-notes.md` under Unreleased, with the schema 6 upgrade note
  pointing at `extension migrate` (story 329).

## The design

- **SDK** (`@crombolo/extension`): `screens: { redirects: { view, actions } }` on the factory's
  description, with the catalogue as typed builder functions (`screen`, `table`, `form`,
  `button`, …) so a description type-checks. Story 315's typed SDK covers the same package.
- **Channel:** two new calls, `screen.view(id, state)` and `screen.action(id, name, input,
  state)`, each carrying `principal` and the grant-checked capabilities as a route call does.
  State is a plain object the host keeps per open screen and sends back with each call, so the
  process holds nothing between calls.
- **Manifest:** a placement entry names a screen with `"screen": "<id>"` where it named a file
  with `element`. The manifest's `schemaVersion` steps to 6: a schema 6 entry may carry
  `screen` or `element`, never both, and `element` is refused unless `backoffice.code` is
  asked for. `extension migrate` rewrites a schema 5 package (story 329).

  ```json
  "extensions": [
    { "type": "menuItem", "alias": "Crombolo.MenuItem.Redirects", "meta": { "menus": ["Umb.Menu.AdvancedSettings"], "entityType": "crombolo-redirects" } },
    { "type": "workspace", "alias": "Crombolo.Workspace.Redirects", "screen": "rules", "meta": { "entityType": "crombolo-redirects" } }
  ]
  ```
- **The package:** a Limited extension is `package.json` and `src/server/` alone: the
  factory, its screens (one file per screen if the author likes) and its `components/`.
  `src/backoffice/` exists only in an Unrestricted extension, and nothing is built to
  `.crombolo/extensions/<id>/backoffice/` for a Limited one.
- **Host:** `isolatedBundle` lists the screens from the description. The plugin registers one
  generic element per placement (`crombolo-extension-screen`), told the extension id and screen
  id by its manifest, which the server generates from the description and the manifest's
  `extensions` entries. The element renders the tree with `uui-*` components and the host's own
  form fields and pickers.
- **Rendering rules, tested with hostile input:** every string through text nodes; link
  protocols checked; `javascript:` dropped; an unknown node type renders nothing and logs.
- **Docs:** `extensions.md` gains "Screens"; `bundles.md` Part 3 says `screens`; the threat
  model's T8 row and "Permissions" change; `extension-threat-model.md` records the decision.

## Acceptance criteria

- [x] An extension declares `screens`, and each appears where its manifest entry puts it, drawn
      by the host, with no module of the extension loaded in the page.
- [x] A table, a form with every field type, conditional fields and hints, validation rules, a
      confirm, notices and problems, tabs and progress all render and round-trip to the process.
- [x] A `page`, `media` or `member` field opens the host's picker and the extension receives a key.
- [x] Hostile strings in every node type render as text; `javascript:` and unknown protocols are
      dropped; a test feeds each node type a script tag and an event handler.
- [x] `principal` and the grant-checked capabilities reach `view` and `actions` as they reach a route.
- [x] A described screen needs no permission; the install panel lists it under Adds (the
      panel's Adds group is story 324's, which reads the screen entries).
- [x] A schema 6 manifest names a screen with `screen`; an entry with `element` is refused
      without `backoffice.code`, and one with both is refused.
- [x] Covering tests, including the isolation suite's style of one test per threat; docs and
      release notes.

## What was built (2026-11-11)

- **The catalogue** is `packages/extension/src/screens.ts`, types and builders, exported from
  `@crombolo/extension` and as `@crombolo/extension/screens`.
- **The server:** `ServerBundle.screens` with `BundleScreen`, `BundleScreenContext` and
  `BundleScreenHandler` (`bundles.ts`); `screenProblems` at boot; `ServerBundles.handle`
  answers `POST …/_screen/<id>` before route matching, with the caller, the gated
  capabilities and the principal as a route has them; `normaliseScreenResult` in
  `extension-screens.ts`, which also never sends a `secret` field's value to the browser.
- **The process:** the runner describes `screens` with their action names and dispatches a
  `screen` call; `isolatedBundle` maps each to `process.call('screen', …)`.
- **Found and fixed on the way:** the runner read an error a host capability threw as a
  plain `{ name, message }`, when it arrives encoded, so every refusal reached an isolated
  extension with an empty message. Routes had the same fault; it is fixed in the runner.
- **The manifest:** `BUNDLE_SCHEMA_VERSION` is 6 and 5 is still read. `screenEntryProblems`
  holds an entry to a screen or a module, schema 6 and a server half; `describedScreen`
  points it at `/crombolo-plugin/extension-screen.js` with `meta.cromboloScreen`, and
  `collectManifests` puts that path below wherever the back office is mounted. The
  `backoffice.code` rule now applies from schema 5 onward rather than only at the newest.
  `extension migrate` treats 5 and later as already laid out; rewriting 5 to 6 is story 329's.
- **The element:** `plugin/extension-screen.js`, with its decisions in the pure
  `extension-screen-model.js`. Pickers are the back office's `umb-input-document`, `-media`
  and `-member`; the browser test drives the table, the conditional field, the required
  check, the confirm and the round trip, not a picker.
- **Tests:** `tests/extension-screens.test.ts` (normaliser, manifest rules, model, and real
  round trips through a Deno process: state, input, a refused capability, hostile answers,
  failures, 404 and 405, the section gate); `tests/browser/extension-screen.browser.ts`, run
  once locally and passing; `api-surface`, `extension-migrate` and `bundle-permissions`
  expectations moved to schema 6.
