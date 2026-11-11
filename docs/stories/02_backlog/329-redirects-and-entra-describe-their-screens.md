# 329 — Redirects and Entra describe their screens

**Epic:** I — Hardening · **Priority:** must · **Size:** M
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

## Acceptance criteria

- [ ] Redirects declares `screens` and no `backoffice.code`; its workspace lists, filters,
      adds, edits and deletes rules, with the page picker, the confirm and the notices.
- [ ] Entra's settings screen is described.
- [ ] Both install at the Limited level with the panel from story 324.
- [ ] `extension migrate` rewrites a schema 5 package of this shape to the new one.
- [ ] Browser tests for both pass; docs and release notes.
