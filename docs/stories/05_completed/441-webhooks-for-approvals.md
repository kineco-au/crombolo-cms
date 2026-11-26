# 441 — Webhooks for approvals

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 028, 229, 440

## Story

As someone joining a site's approvals to another system (a ticketing tool, a chat
channel, a record of sign-off), I want a webhook for each step of a request, so that the
other system hears when a page is sent, approved, sent back, withdrawn or stuck.

## Context

Found 2026-11-26, listing the webhook events (`docs/webhooks.md`). Approvals raise no
webhook of their own: `Crombolo.ChangePublished` says only when an approval ends in a
publish, a take-down or a schedule (story 413). Approvers hear by e-mail
(`notify` in `packages/server/src/approvals.ts`), and nothing outside the site does.

## Decisions (2026-11-26, the maintainer's)

1. **One event per step,** named as story 440 names every event, `Crombolo.` and the word:
   `Crombolo.ApprovalSent`, `ApprovalStageReached` (a stage now waits, naming its groups),
   `ApprovalApproved`, `ApprovalSentBack`, `ApprovalWithdrawn`, `ApprovalStalled` (story
   229) and `ApprovalFinished` (published, taken down or scheduled). A superseded or
   restarted request raises Withdrawn and then Sent, as it is to whoever waits.
2. **The payload carries facts only:** the request's key, the page's key and name, the
   workflow, the stage and its groups, who acted, when, and the action asked (publish or take
   down, with any time). Never a comment, and never the page's unpublished content.
3. **Narrowed by content type and by workflow:** a webhook's content types narrow an
   approval event as they narrow a page's; a webhook may also name workflows (`workflows`
   in its file, and a picker in the back office), and then hears only theirs.

## Acceptance criteria

- [x] Each step of a request raises its event, once, in the step's own transaction,
      through every tool that takes the step (back office, command line, the schedules job).
- [x] The payload carries the facts decision 2 names, and no comment or unpublished content.
- [x] A webhook narrowed by content type or by workflow hears only those; an empty list hears all.
- [x] Each event is in the back office's event picker, with its words, and the webhook
      editor offers its workflows.
- [x] `docs/webhooks.md`, `docs/workflows.md` and the release notes; tests on both databases.

## What was built

- `webhook-events.ts`: the seven `Crombolo.Approval…` events.
- `approvals.ts`: every request the engine reads is an `ApprovalRepository` that announces
  each step it records (`STEP_EVENTS`) and each stage it reaches, through the outbox in the
  step's own transaction (`announce`), so every tool that takes a step raises it;
  `ApprovalWebhookFacts`, facts only.
- `webhooks.ts`: the `Approval` payload; narrowed by the page's type and by
  `webhook.workflows`, kept in files (`workflows = [...]`) and the database (column added in
  migration 104, unreleased, beside 440's rename), kept across a back-office edit.
- `<plugin>/api/webhooks/{key}/workflows` and the Workflows panel (`webhook-workflows.js`).
- Tests: `approval-webhooks.test.ts`.
- Docs: `webhooks.md`, `workflows.md`, the release notes.
