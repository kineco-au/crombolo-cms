# 329 — Redirects and Entra describe their screens

**Epic:** I — Hardening · **Priority:** must · **Size:** L
**Depends on:** 323, 324

## Story

As the maintainer, I want the two extensions crombolo ships to describe their screens
rather than ship code, so that they run Limited, prove the catalogue on real screens, and no
extension of ours asks for `backoffice.code`.

## Context

Simple Redirects is a 180-line server half over two host capabilities and a 480-line Lit
workspace: a filter, a table of rules with Edit and Delete on the ones added by hand, an
editor with six fields and a page picker, a confirm, notices and problems. Entra's screen is
settings. Both map onto story 323's first catalogue with nothing left over; the two
behaviours that stay in the browser, conditional fields and the confirm, are declarative.

## Decisions (2026-11-11)

- **Redirects' permissions become three:** `redirects.read`, `redirects.write` and
  `content.read`. `backoffice.code` goes, and `src/backoffice/` with it.
- **Edit and Delete per row** are decided by the server half, as `present` decides today.
- **Configured and tracked rules stay read-only** because `bundle.redirects.replace` refuses
  them, as now, not because the screen hides a button.
- **Entra** describes its settings screen the same way, and loses its back-office code.
- **The measure of done** is that an editor cannot tell the difference, and the browser suite
  for Redirects passes unchanged but for how it finds the elements.

## Decisions (2026-11-11, planning)

- **Group mappings are a new `list` field** (the maintainer's choice): rows of sub-fields
  edited in place, added and removed in the browser, sent with the form as an array of
  objects. Its sub-fields are any of the existing kinds but `list`, `page`, `media`, `member`
  and `secret`. Every extension inherits it.
- **Fields gain `readOnly`:** drawn disabled and never sent back. The server still refuses a
  change it would not allow, so the flag is the screen's honesty, not the guard.
- **Schema 6 everywhere, and nothing earlier** (the maintainer's choice):
  `OLDEST_BUNDLE_SCHEMA_VERSION` becomes 6, so a schema 5 extension is refused at install and
  at boot, naming `crombolo extension migrate`. Migrate takes 5 to 6: the schema number and,
  from story 325, `actAs` to `user.delegate`. It does not turn hand-written back-office code
  into described screens: an extension that keeps `src/backoffice/` stays Unrestricted, and
  migrate prints which of its entries could be screens instead. Redirects, Entra, the browser
  suite's fixtures and every test fixture move to 6.

## The plan (2026-11-11)

### Slice 1: the catalogue grows

- `screens.ts`: `readOnly?: boolean` on `FieldBase`; a `list` kind,
  `{ kind: 'list', fields: Field[], addLabel?, min?, max? }`, its value an array of value
  objects; `field.list(name, label, fields, options)`.
- `extension-screens.ts` normalises both: sub-fields of the allowed kinds only, values as an
  array of plain objects of the sub-fields' names, `readOnly` kept.
- `extension-screen-model.js`: `fieldProblems` checks each row's sub-fields; `sentValues`
  leaves out read-only fields.
- `extension-screen.js`: a `list` draws its rows with each sub-field, a remove per row and an
  add button, within `min` and `max`; a read-only field is disabled.

### Slice 2: Redirects

- `src/server/index.ts` declares `screens.rules`: `view` lists the rules (filtered by
  `state.query`), with a source tag and Edit and Delete only where `present` says the rule is
  editable; `actions` `find`, `add`, `edit` (the editor form with the rule's values), `save`
  (create or replace through `bundle.redirects`), `remove` (with its confirm), `cancel`. The
  editor's fields: match kind, pattern (hints for regex and prefix), target kind, a `page`
  field shown for a page target and a `text` field otherwise, status code, culture. A refusal
  from `bundle.redirects` comes back as a `problem` with its message.
- `package.json`: the workspace entry names `"screen": "rules"`; `backoffice.code` and
  `src/backoffice/` go; `schemaVersion` 6; `files` follows.
- Its back-office routes stay for anything that still calls them, and are retired in a later
  release.

### Slice 3: Entra

- `src/server/index.ts` declares `screens.signIn`: one tab per Entra provider, each a form with
  button text, tenant, client ID, the client secret (`secret`, with "Remove the secret kept
  here" when one is kept), the three toggles, and the group mappings as a `list` of an Entra
  group ID (`text`) and a user group (`choice` of the site's groups); the redirect URL to
  register as a `code` cell above; a field the site's code sets is `readOnly` with a hint, and
  every field is `readOnly` for someone who is not an administrator; actions `save`, `test`,
  `reset` ("Use the code's settings", with a confirm) and `removeSecret`. No Entra provider is
  an `empty` with what to do.
- `package.json`: `"screen": "signIn"`, `backoffice.code` and `src/backoffice/` go, schema 6.

### Slice 4: schema 6 only

- `bundle-package.ts`: `OLDEST_BUNDLE_SCHEMA_VERSION` 6; `schemaProblem` names what 6 changed
  (a screen entry may replace an element, `actAs` is retired) and the migrate command.
- `extension migrate`: a schema 5 package is bumped to 6 with the `actAs` rewrite, and each
  entry with an `element` is listed as "could be a described screen" in the output.
- Fixtures: `tests/support/bundles.ts` writes 6; `tests/browser/serve.ts`'s fixtures move to 6;
  tests that build schema 5 by hand follow, and one asserts 5 is refused, naming migrate.

### Slice 5: tests and docs

- `tests/extension-screens.test.ts`: the `list` field and `readOnly`, through the normaliser
  and the model.
- `tests/simple-redirects.test.ts` and `tests/entra-bundle.test.ts`: each screen's view and
  actions through its process, as an administrator and as someone without the section; the
  refusal of a configured rule's edit as a `problem`.
- `tests/browser/redirects-screen.browser.ts` and `entra-screen.browser.ts`: list, filter, add
  with the page picker, edit, delete with the confirm; Entra's tabs, a mapping added and
  removed, a read-only field. Run once locally.
- Both install at the Limited level: a test reads their `level`.
- Docs: `bundles.md` (schema 6 only), `extensions.md` "Screens" (the list field, `readOnly`),
  `operations.md`'s Redirects section, `release-notes.md` with the upgrade note that schema 5
  extensions are refused until migrated.

## Acceptance criteria

- [ ] Redirects declares `screens` and no `backoffice.code`; its workspace lists, filters,
      adds, edits and deletes rules, with the page picker, the confirm and the notices.
- [ ] Entra's settings screen is described, its group mappings a `list` field and its locked
      fields `readOnly`.
- [ ] Both install at the Limited level with the panel from story 324.
- [ ] `extension migrate` takes a schema 5 package to 6, and a schema 5 extension is refused
      until it is.
- [ ] Browser tests for both pass; docs and release notes.
