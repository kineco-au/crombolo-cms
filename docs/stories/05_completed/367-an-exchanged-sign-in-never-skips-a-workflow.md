# 367 — An exchanged sign-in never skips a workflow

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 364

## Story

As a site owner whose host lets tools act for people, I want a page those tools publish
to wait for a person whenever a workflow covers it, so that a change nobody watched
never goes live on the tool's word, even when the person behind it may skip.

## Context

- **The gate** (`docs/workflows.md`, "The gate") applies by who is acting:
  - **A back-office user** is gated, and skips when `publishers-may-skip` lets them.
  - **The command line** is gated as someone who may not skip; only `--skip-approval`
    goes ahead, and it is recorded.
- **A token exchanged through a provider (364)** acts as its person, so today it is
  gated as a back-office user: if the person may skip, so does the tool acting for them.
- **What already holds:** an exchanged sign-in can send a page for approval, but never
  decide one (`refuseUnattended`).

## The design

- **An exchanged sign-in is gated as the command line is:** someone who may not skip,
  whatever `publishers-may-skip` says and whatever the person's rights.
  - Publishing a covered page is refused with the workflow's name and where to send it
    from, and sending it for approval works.
  - With `on-edit` set, saving behaves as the workflow says.
- **No way round it:** an exchanged sign-in has no `--skip-approval` and no API
  equivalent.
- **Pages no workflow covers** publish as they always have: this changes nothing
  without a workflow.
- **The audit and the request** name the person, through the provider, and the actor
  where the token named one (366).

## Decisions

- **Gated as the command line, with no way round it.** An exchanged sign-in is never
  given `publishersMaySkip`, `on-edit`'s administrator exemption or `skipApproval`
  (the remote's rollback refuses it with 403). `ContentPrincipal` carries
  `viaExchange`, so the gate sees it however the publish starts.
- **D1 a: a whole-site push is refused while any page workflow exists.** A push
  replaces pages without passing the page gate, so an exchanged sign-in's push is
  refused, naming the workflows, whenever the site has one; with none it works as
  before. A person who means to push over a workflow does it with their own
  command-line sign-in. A grant the person gives at the provider, which would let an
  exchanged sign-in skip, is story 369.

## Acceptance criteria

- [x] **A covered page:** an exchanged sign-in's publish, branch publish,
      create-and-publish, and covered unpublish are refused with the workflow's reason,
      even for an administrator whose workflow lets publishers skip.
- [x] **Sending for approval** works for it, and deciding is refused, as now.
- [x] **A page no workflow covers** publishes as before.
- [x] **On-edit and rollback:** an exchanged administrator can't save a page `lock`
      holds, and the remote's rollback refuses its `skipApproval`.
- [x] **A whole-site push** from an exchanged sign-in is refused while any page
      workflow exists, naming them, and works as before when none does.
- [x] **`docs/workflows.md`'s gate** lists the exchanged sign-in beside the command
      line.

## Out of scope

- Workflows for anything but pages: schema, templates and media publish as they do.

## Built

- **The principal:** `ContentPrincipal.viaExchange` (`@crombolo/content`), which the
  server's principal already carries through `userActor`.
- **The gate:** `gateFor` never skips for it; `approvals.ts`'s `unattended` makes
  `refusalFor` treat it as someone who may not skip, and `beforeSave` and the
  `withdraw` rule give it no administrator's exemption.
- **Rollback:** `remote-undo.ts` refuses its `skipApproval` with 403.
- **Push:** `startPush` refuses it with 403 `workflow-covers-pages`, naming the
  workflows, while any exists.
- **Create-and-publish** goes through `newPageRefusal`, so the same `refusalFor` holds it.
- **Tests:** `tests/exchange-workflows.test.ts`, with an administrator whose workflow
  lets publishers skip: publish, branch publish and covered unpublish refused, sending
  for approval works, the same person signed in themselves still skips, an uncovered
  page publishes, `lock` holds, rollback and push refused.
- **Docs:** `workflows.md` ("The gate"), `remote-protocol.md` (what the token may do,
  the error table) and the release notes.

