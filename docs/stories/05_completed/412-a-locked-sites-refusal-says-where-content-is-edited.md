# 412 — A locked site's refusal says where content is edited

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 388

## Story

As an editor who tries to change something on a site that only serves, I want the
refusal to tell me where the content is edited and take me to the same item there, so
that I am not left with "changed where they are made" and no idea where that is.

## Context

Asked for by Crombolo Cloud on 2026-11-24 (its story 307).

With `CROMBOLO_CONTENT=locked` a write is refused with one fixed text, `CONTENT_LOCKED`
(`packages/server/src/workspaces.ts`): "Its pages, media, types and code are changed
where they are made, and arrive here when that change is applied." The values of an
environment are refused in similar words (`environment-values-api.ts`), and the
back-office dialog for them says the same.

`CROMBOLO_CONTENT_EDITED_AT` names the back office of the site where content is made
(`388`). Today it is used in one place: an item's Info tab on the locked site links to
the same item there (`content-locked-info.js`, `editedHref`). The refusal itself, in
the API and beside a refused save, never names it.

## The design

- **The refusal names the address when the site knows it:** "This site's content is
  edited at <address>. Changes reach it from there." With no address set, today's
  words stay.
- **One place makes the words,** used by every refusal a locked site gives: pages,
  media, the Library, types, data types, code files and an environment's values, in
  the Management API, the plugin routes and the command line.
- **The refusal carries the address as data too,** `editedAt` beside the title and
  detail, so a caller can make a link without reading it out of the sentence.
- **Beside a refused save in the back office,** the notice says the same and links to
  the same item on that site, by the rule the Info tab already uses. Where no item is
  open, it links to that back office.
- **The address is shown as written in the setting,** and only an `http` or `https`
  address is made into a link.

## Decisions (2026-11-24, the maintainer's)

1. **The address in full,** as written in the setting.
2. **In every caller's refusal,** in the words and as `editedAt`.
3. **A locked code setting names it only when content is locked too;** code locked
   alone keeps its own words.

## Acceptance criteria

- [x] **With the address set,** a refused save of a page, a media item, a Library
      item, a type and an environment's value each name it, in the API's answer and
      the command line's message.
- [x] **With none set,** each says what it says today.
- [x] **The answer carries `editedAt`** as a field.
- [x] **The back office's notice beside a refused save** names the address and links
      to the same item there.
- [x] **An address that is not `http` or `https`** is shown as text and never linked.
- [x] **The Info tab's line and link** are unchanged.
- [x] **Tests** for the words and the link; `docs/changes.md`,
      `docs/configuration.md` and the release notes updated.

## Implementation

- `lockedRefusal` and `editedAtDetail` (`packages/server/src/workspaces.ts`): one place makes
  the words and `editedAt`, used by the locked gate (pages, media, the Library, types,
  data types, code files), by opening a workspace, and by an environment's values
  (`environment-values-api.ts`, which also answers `editedAt` for its dialog).
- Code locked alone keeps its own words: its refusal never reaches the gate.
- The command line writes a local site's database and applies changes over HTTP, which a
  locked site takes, so no command gets this refusal: nothing to change there.
- Back office: `lockedNotice` and `linkable` (`content-locked.js`) and
  `content-locked-notice.js`, a notice with a link to the same item, shown beside a
  refused save; only an `http` or `https` address is made a link, in the Info tab too.
  The environment values dialog names it and links to it.
- Tests: `tests/content-locked.test.ts` (every refusal with and without the address, the
  notice and its link).
