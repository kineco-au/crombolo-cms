# 271 — The copy dialog does not offer to relate a copy

**Epic:** C — The backoffice, end to end · **Priority:** could · **Size:** S
**Depends on:** 046

## Story

As an editor copying a page, I want the copy dialog to offer only what it
does, so that a ticked "Relate to original" does not promise a link to the
original that is never made.

## Context

Found 2026-11-05. `PostDocumentByIdCopy` ignores `relateToOriginal`. Relations
are derived rather than stored (`packages/data/src/relations.ts`), and copies
record no origin, so "Relate Document On Copy" lists nothing. The checkbox is
shown and has no effect.

## Decision

- Decided 2026-11-05: the checkbox goes. Copies stay unrelated, and the fork
  stops offering what the server never did.

## Acceptance criteria

- [x] The copy dialog no longer shows "Relate to original", and a copy is
      sent with `relateToOriginal: false`.
- [x] `docs/backoffice-hosting.md` lists the change with the fork's others.
- [x] A test over the served client fails if the toggle comes back.

## Implementation

- Fork commit `336fc2c6` on `umbraco/crombolo`, pinned in
  `packages/backoffice-dist/UMBRACO_CLIENT`:
  `duplicate-document-modal.element.ts` drops the toggle and its handler, and
  `duplicate-document.action.ts` sends `relateToOriginal: false`. The bulk
  "Copy to" dialog never offered it.
- The server still ignores `relateToOriginal`, as Umbraco's contract allows;
  "Relate Document On Copy" stays among the relation types, listing nothing
  (`packages/data/src/relations.ts`).
- `tests/vendor.test.ts` checks the served dialog has no such toggle.
