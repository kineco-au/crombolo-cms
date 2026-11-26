# 229 — A workflow nobody can approve says so

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** 028

## Story

As an editor sending a page for approval, I want to be told when a stage has
nobody who can approve it, so that a page does not wait forever for an approval
that cannot come.

## Context

Found 2026-10-31. `approvalsNeeded` (`packages/core/src/workflows.ts`) never
asks for fewer than one approval, and only a member of a stage's groups gives
one. A stage naming a group that does not exist, or one with no members, can
never be approved: a page sent through it waits, and nothing explains why.

## Findings (2026-11-26)

- `membersOf` (`packages/server/src/approvals.ts`) counts every member of a stage's groups,
  disabled accounts and service accounts included, and that count also sets how many
  approvals `majority` and `all` need.
- With `selfApproval: 'refused'`, a sender who is the only member leaves nobody to approve.
- The designer offers only groups that exist; a missing group comes from the site's files,
  or a group deleted after the stage was made.

## Decisions (2026-11-26, the maintainer's)

1. **Sending is refused** while any stage on the path has nobody to approve it, naming the
   stage and its groups and who to ask.
2. **Who counts:** enabled people in the stage's groups: not service accounts, not disabled
   or locked accounts, and not the sender where the workflow says someone else must
   approve. The same count sets what `majority` and `all` need.
3. **Pages already waiting** at such a stage: the Content status check names each stage,
   its groups and how many pages wait there; the request says "Nobody can approve this
   stage now"; and administrators are e-mailed once when a waiting page's stage loses its
   last approver.

## Acceptance criteria

- [x] A status check (group Content) names each workflow stage whose groups do not exist
      or hold no enabled person, with how many pages wait at it.
- [x] Sending a page through such a stage is refused, naming the stage and its groups.
- [x] Only enabled people count, and not the sender where self-approval is refused; the
      same count sets what `majority` and `all` need.
- [x] A waiting request at such a stage says so; administrators are e-mailed once when a
      waiting page's stage loses its last approver.
- [x] The workflow designer marks a stage naming a group that does not exist.
- [x] Tests on both engines.

## What was built

- `approvals.ts`: `approversIn` (enabled people, not service accounts, not the sender where
  refused), `stagesNobodyCanApprove`, `nobodyWords`; the count behind `majority` and `all`;
  `send` refused (409) naming each stage; a request's stage `nobody`; `sweepStalled`, run by
  the schedules job, e-mailing administrators once and noting `stalled` on the request.
- The Content status check "Approval workflows" (`adapters/health.ts`).
- The back office: the request's Workflow tab says why it waits; the designer marks a stage
  naming a group not here and offers to remove it (`missingGroups` in `workflow-graph.js`).
- Tests: `approvals-nobody.test.ts`, `workflow-graph-missing.test.ts`; `approvals`,
  `exchange-workflows` and `health-checks` brought up to the rule.
- Docs: `workflows.md`, `diagnostics.md`, the release notes.
