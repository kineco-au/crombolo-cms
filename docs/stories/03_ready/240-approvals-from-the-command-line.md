# 240 — Approvals from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As an approver on a site where publishing or pushing waits for approval, I want
to see what is waiting for me and approve, send back or decline it from the
CLI, so that a scripted publish or deploy does not stop at "waiting" until
someone opens the back office.

## Context

Found 2026-11-02, reviewing the CLI's gaps. `crombolo workflows new` writes an
approval workflow (story 028), and `content publish` on a page under one sends
it for approval, but nothing in the CLI lists the requests waiting, or
approves, sends back or withdraws one. The Approvals section does all of it
through `<backoffice>/crombolo/api/approvals/` (`waiting`, `in-flight`,
`history`, `request/{key}/approve|send-back|withdraw`).

A push held for approval on a remote (`remote.approvals`, docs/remote-protocol.md)
is decided through `POST <api>/jobs/{id}/approve|decline` or the remote's
approval page; the CLI can wait on the job but not decide it.

CI never approves (story 160): a CI token is refused on every decision, here as
everywhere else.

## Acceptance criteria

- [ ] `crombolo approvals list [--waiting-for-me] [--history]` lists requests:
      the page, its workflow and stage, who sent it and when
- [ ] `crombolo approvals approve|send-back <page> [--comment]` and
      `approvals withdraw <page>` act on a page's request, as the Approvals
      section does, with the same rules (an approver only for their stage's
      groups; no approving one's own request where the workflow forbids it)
- [ ] `crombolo remote approve|decline <job> [--remote] [--comment]` decides a
      held push; refused for the person who pushed it (`own-push`) and for CI
- [ ] Each takes `--remote <name>` to act on a remote site, through the remote
      protocol, as `bundle apply --remote` does (story 167)
- [ ] `-o json`, audited as the back office's actions are
- [ ] Tests on SQLite and Postgres; a CI token refused on every decision
