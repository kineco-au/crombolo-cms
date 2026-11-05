# 240 — Approvals from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** a CLI sign-in story, not written yet

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

## On hold (2026-11-06)

Shelved while planning. The approval rules need a signed-in person and a local
command has none, so this waits on how the CLI identifies people.

### What the Context gets wrong

- `content publish` on a page under a workflow does not send it for approval. It
  is refused, with a hint at `--skip-approval`, so nothing on the command line can
  create a request. Only the back office can.
- `content publish` has no `--remote`, so the scripted publish the story describes
  does not exist yet.

### Decided so far

- **Decisions need a sign-in.** `approve`, `send-back` and `withdraw` act as a
  signed-in person. Nothing else can hold the stage-group and self-approval rules,
  and the history must name only people who really decided.
- **`--for-approval` on `content publish` and `content unpublish`** sends a page
  through its workflow. Where it may run was not settled, because a request needs a
  real user as its sender: send-backs go to them and the self-approval rule compares
  against them (`requested_by`).
- **Local sign-in comes first.** The next step was a new story, with this one
  depending on it: `crombolo login` also works against a local site, commands run as
  that user with their permissions and approvals, and commands with an audit trail,
  such as `publish`, require a signed-in user. Docs and setup steps change with it.

### Complications to settle in the sign-in story

- **Not a barrier.** Whoever holds the SQLite file or Postgres URL can skip the CLI,
  and `admin reset-password` lets them replace the administrator's password and sign
  in. Local sign-in gives real names and rules, not protection from them. The real
  protection for production is not handing out database URLs and using `--remote`,
  which belongs in `docs/operations.md`.
- **Audited does not mean sign-in is possible.** `upgrade` and `admin reset-password`
  are audited, but must work with no usable sign-in: the first may run with the
  database behind the code, and the second exists for lockouts.
- **Scope was left open between two rules:** audited commands only, or three tiers:
  - files only, no sign-in: `init`, `generate`, `components`, `types check`,
    `bundle build`, `--help`;
  - recovery and running the site, no sign-in but audited as the operator:
    `admin reset-password`, `upgrade`, `start`, `restart`, `login`;
  - anything that reads or changes the site's data, sign-in required, which also
    covers `export`, `content show`, audit reads and user lists.
- **Requiring it for every command does not work:** `init` runs before any user
  exists, containers and hosts run `start` and `upgrade` unattended, and file-only
  commands have no database to sign in against.
- **Audit coverage is uneven.** Only 29 commands declare an audit entry. `content`
  and `media` commands record through the content operations instead, and others
  that change things, such as `languages add` and `webhooks`, declare none.
- **Who signs in:** someone using Entra has no local password, and two-factor needs
  handling, so local sign-in may need a browser flow and a running server.
- **Scripts:** a script has no person, so it needs a stored user token or a remote
  with a CI rule, and containers may have no keychain. CI still never decides.
- **`--skip-approval`** should be limited to administrators once sign-in exists.
- **`admin reset-password`** should e-mail the administrator where a site has mail,
  so a reset cannot pass unnoticed. Its audit entry has only a self-declared name.
- **The rest of the cost:** read commands gain permission checks, many CLI tests and
  integration flows must sign in first, and the setup steps gain a sign-in.

### For this story, once unblocked

- **Routes:** the approvals API is back-office only and takes no page path. `--remote`
  needs routes under `<api>/environments/{id}/approvals`, with a capability of their
  own and a conformance check, since `approvals` already means a push may wait.
- **CI:** `Approvals` never checks `principal.ci`, so that refusal has to be added
  to the engine, for every decision.
- **`remote approve|decline --comment`:** `decide()` in `remote.ts` reads no body and
  a job has nowhere to keep a comment, so the audit entry would carry it.

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
