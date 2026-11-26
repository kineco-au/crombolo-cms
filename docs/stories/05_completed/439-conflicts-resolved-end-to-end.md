# 439 — Conflicts resolved end to end

**Epic:** I — Hardening · **Priority:** should · **Size:** M
**Depends on:** 085

## Story

As someone moving changes between workspaces and sites, I want each way a conflict is
settled proven through the real command line and running servers, so that a conflict is
never only refused in practice, with no way through it that anything has tried.

## Context

Asked for by the maintainer on 2026-11-26, after a review of the integration suite.
Today, end to end:

- `workspaces`: a definition changed on both sides is refused, settled with `mine`, merged.
- `content-transfer`: a bundle conflict is refused, and a saved resolution settles it.
- `change-transfer`: a change meeting the other copy's edit is refused naming the field,
  and nothing then answers it.
- No page edited in both a workspace and Shared; no two workspaces making the same new page
  (436); no change staged on top of another (434). Each has unit tests only.

## Findings (2026-11-26)

- A change staged or applied from another site, meeting a field the receiving copy has
  changed since, leaves that field out (`stagePage` in `change-transfer.ts`): the refusal
  names the field, and the incoming value is kept nowhere. The only way through is to
  retype it in the workspace a refused apply leaves open, then merge.
- A workspace's own page conflicts are answered field by field through
  `POST <plugin>/api/workspaces/{key}/conflicts { page, answers }` (`mine` or `theirs`),
  then merged (`workspace-merge-api.test.ts`).

## Decisions (2026-11-26, the maintainer's)

1. **A conflicting field from another site is answerable, in this story.** Staging keeps the
   incoming value and records the conflict, with both values, on the staged workspace
   (with its staged change: no migration). The merge refuses while one is unanswered,
   naming each field; `GET /{key}/conflicts` lists both values; the same
   `POST /{key}/conflicts` answers it, `mine` the change's value and `theirs` this site's;
   the back office's conflict screen shows it as any page conflict.
2. **Out of scope:** a page moved here since, a delete of a page edited here, and a page made
   separately at the same address stay refusals settled in the open workspace, as today:
   they are about where a page is and whether it is, not a field's value.

## Acceptance criteria

- [x] `workspaces`: a page edited in the workspace and in Shared is refused naming the
      field, answered through `/conflicts` with one field from each side, and merged; the
      live page shows both answers.
- [x] A received change's conflicting field is staged with its value and held as a
      conflict with both values; the merge refuses naming it until answered; `mine` takes
      the change's value, `theirs` keeps this site's. Unit tests on both databases.
- [x] `change-transfer`: the refused change from the first copy is answered on the second
      and applied, the live page checked for each answer.
- [x] `change-transfer` or `workspaces`: two workspaces making the same new page each merge
      their own (436), and a change staged after another builds on it (434).
- [x] `docs/changes.md` and the release notes.
- [x] All on SQLite and Postgres (`bun run test:integration`,
      `bun run docker:test:integration:postgres`).

## What was built

- `change-transfer.ts` (`stagePage`): a field the target changed since takes the change's
  value, and its base (the change's *before*) is kept on the staged change (`bases`, keyed
  by page and merge field); the refusal says to choose in the workspace's conflicts. A
  change the target lacks is still named beside it, and no longer stops the field being held.
- `WorkspaceRepository.stagedBases` / `clearStagedBases`; `DocumentRepository#mergePage`
  reads a staged base as the field's base, and `rebaseWorkspacePage` clears it once answered.
- Tests: `change-transfer.test.ts` (held with both values, answered `mine` and `theirs`; the
  edit-then-merge way through now answers too); `workspaces.integration.ts` (a page edited
  in both, answered one field from each side); `change-transfer.integration.ts` (the
  refused change answered and applied; story 434's change staged after another into the
  same workspace; story 436's two workspaces making the same page, made once). On SQLite
  and Postgres.
- Docs: `changes.md`, the release notes.
