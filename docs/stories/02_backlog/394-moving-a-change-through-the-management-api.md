# 394 — Moving a change through the Management API

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 383, 388

## Story

As a tool that moves work from one copy of a site to another, I want to export a change
and stage it on the other copy through the Management API, signed in as the person doing
it, so that a site can keep its remote protocol switched off and still take changes.

## Context

A change moves between copies of a site (`383`) only over the remote protocol: the export
of a recorded change or an open workspace (`GET changes/{id}/bundle`,
`GET workspaces/{key}/change`) and the import that checks, stages or applies it
(`PUT changes`). A site that runs with `CROMBOLO_REMOTE_ACCESS=off` has none of them,
although everything after staging (the merge preview, `accept`, the merge itself, the
record of changes and revert) is already on the Management API.

A copy whose content is locked (`388`) takes content only by a change, so whichever
route stages and applies one is the one way past the lock, and has to be held at least
as tightly as the remote's.

## The design

- **Three routes under `/crombolo/api/changes`,** the same work as the remote's:
  - `GET changes/{id}/bundle`: a recorded change, as the tarball the remote gives;
  - `GET workspaces/{key}/change`: an open workspace, as a change;
  - `PUT changes`, with `check`, `stage`, `into` and `editable` as on the remote, and the
    tarball as its body.
- **The same rights as the remote:** *Pull* to export; *Apply changes* to check, stage
  or apply; *Install code* as well when the change carries components or the site's own
  code; and, for the merge that follows, what the merge already asks.
- **Bearer only:** a sign-in token in `Authorization`, never a cookie, so another page in
  a person's browser can't send one. A request carrying only a cookie is refused.
- **The same limits:** the size limit, and `Crombolo-Sha256` required and checked.
- **The same answers,** in the Management API's shape: `{message, blockers?|refusals?}`,
  with each conflict and refusal as the remote lists it.
- **Optional: apply only by an exchanged sign-in.** A site setting,
  `CROMBOLO_APPLY_CHANGES_BY=exchange`, under which *Apply changes* is honoured only for
  a token from the site's token exchange (CMS 364) whose subject token says it is for
  applying a change. A person's own back-office sign-in, however their groups are set,
  can then not stage or apply one, and the tool that exchanges for them decides when it
  happens. Unset, *Apply changes* is honoured for any sign-in that holds it.
- **The record** names the person, as the remote's import does, and the staged
  workspace is theirs.

## Acceptance criteria

- [ ] **A change exported** through the Management API is the same tarball the remote
      gives, for a recorded change and an open workspace.
- [ ] **`PUT changes`** checks, stages and applies as the remote's does, with `into` and
      `editable`.
- [ ] **Each right is checked** as the remote checks it, code included.
- [ ] **A request with only a cookie** is refused.
- [ ] **A missing or wrong `Crombolo-Sha256`,** or a body over the limit, is refused as
      the remote refuses it.
- [ ] **With `CROMBOLO_APPLY_CHANGES_BY=exchange`,** a back-office sign-in holding
      *Apply changes* is refused, and an exchanged one for applying a change is taken.
- [ ] **With the remote off,** all of it works.
- [ ] **`docs/api.md`** lists the routes, the rights and the setting.
