# 403 — A staged change needing what the site lacks is refused

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 383, 399

## Story

As a host staging a change onto a site, I want to be told when the change needs a type or
other schema the site does not have, so that I can say so and stop, rather than meet a
server error.

## Context

Staging a change (`PUT changes?stage=true`, `changes/from-site`) writes each page into the
workspace. A page whose content type is neither on the target nor carried by the change
fails deep in the document repository (`Unknown content type '<key>'`) and the request
answers 500. It happens most to a site whose schema was made before workspaces were on:
no recorded change carries it, so the changes moved later refer to what never travelled.

## The design

- **Checked before anything is written:** each new page a change stages names its content
  type and the element types its blocks use. One that is neither on the target (by key,
  or for a type by its alias), in the change, nor in the workspace it goes into is a
  refusal: 409, nothing staged, each named in the change's words ("needs the document
  type "event", which this site does not have"). A type found by its alias under
  another key is staged with this site's key.
- **Templates are not refused:** a template's key is the site's own, and a change between
  two sites made separately names one this site keys differently, which staging already
  takes. Refusing it would refuse moves that work.
- **The same refusal** for `PUT changes` (stage and apply), `changes/from-site`, and their
  `check`.
- **Levelling a site first:** a site whose Shared holds schema or content no change
  records is brought level with a whole-site bundle staged as one change
  (`crombolo site export`, then `changes/from-site?source=baseline&base=now`), which
  `docs/changes.md` says.

## Acceptance criteria

- [x] A change whose page needs a content type the target lacks is refused with 409,
      naming it, and nothing is staged
- [x] Likewise a block's element type (not a template, which is staged as before)
- [x] What the change itself carries, or the workspace already holds, is not refused
- [x] `check` answers the same refusal
- [x] `docs/changes.md` says so, with how to level a site first

## Implementation

- `lackingIn` (`packages/server/src/change-transfer.ts`), called by `stage` before it opens
  or writes anything; `StageOutcome.refused` carries it, `apply` answers it as a refusal
  with no workspace, and the `check` route answers 409.
- `typeKeyHere`: a new page's type by key, else by alias, in Shared or the workspace.
- Tests: `tests/site-staging.test.ts` (story 403), `tests/change-transfer.test.ts`.
