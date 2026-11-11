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

- [ ] An extension declares `screens`, and each appears where its manifest entry puts it, drawn
      by the host, with no module of the extension loaded in the page.
- [ ] A table, a form with every field type, conditional fields and hints, validation rules, a
      confirm, notices and problems, tabs and progress all render and round-trip to the process.
- [ ] A `page`, `media` or `member` field opens the host's picker and the extension receives a key.
- [ ] Hostile strings in every node type render as text; `javascript:` and unknown protocols are
      dropped; a test feeds each node type a script tag and an event handler.
- [ ] `principal` and the grant-checked capabilities reach `view` and `actions` as they reach a route.
- [ ] A described screen needs no permission; the install panel lists it under Adds.
- [ ] A schema 6 manifest names a screen with `screen`; an entry with `element` is refused
      without `backoffice.code`, and one with both is refused.
- [ ] Covering tests, including the isolation suite's style of one test per threat; docs and
      release notes.
