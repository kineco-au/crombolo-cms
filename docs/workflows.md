# Approval workflows

A page a workflow covers is not published directly: it is sent for approval,
goes through the workflow's stages, and is published when the last of them
approves. Umbraco leaves this to Umbraco Workflow, a paid add-on; here it is in
core. Story `028`.

## What a workflow is

An acyclic graph of **stages**, drawn on a canvas in the Workflows section and
kept as a file in `schema/workflows/`.

- **A stage** is approved by named **user groups**: ordinary user groups, so
  who approves changes with group membership and needs no deploy. Declare the
  groups a workflow names in `schema/user-groups/` beside it, so every
  environment has them ([`schema-as-code.md`](schema-as-code.md#user-groups),
  story `228`). It needs one
  approval, a majority, all of them, or a number (`required`); a number larger
  than the groups hold is capped at what they hold, so a stage can always finish.
- **Arrows** run from a stage to the stages that follow it. A stage with several
  arrows out starts all of them at once; a stage with several arrows in waits
  until every one of them has approved. When every last stage has approved, the
  page is published. A loop is refused, in the designer as it is drawn and in
  the file on load.
- **Sending back** from a stage goes where the stage says: to the editor, which
  ends the request, or to an earlier stage on its path, which runs again — and so
  does every stage after it; their approvals are discarded.

```toml
[workflow]
alias = "policy-sign-off"
name = "Policy sign-off"
applies-to = { branches = ["8a1e…"], content-types = ["policy"] }
publishers-may-skip = false
on-edit = "withdraw"          # withdraw | approve-latest | lock | lock-after-first-approval
self-approval = "refused"     # refused | allowed | automatic
comments = "on-send-back"     # optional | on-send-back | always
unpublish = true
on-change = "restart"         # keep | restart | withdraw
scheduling = true             # a request may say when; left out when off

[[stage]]
alias = "legal"
approvers = ["legal"]
required = "one"              # one | majority | all | a number
next = ["brand", "compliance"]
send-back = "editor"
position = { x = 0, y = 0 }   # where the canvas drew it
```

A workflow is found by its `key` where it has one, else by its alias, so a
file needs no key (story 161). `crombolo workflows new <alias> [--content-type
<alias>…] [--approver <group>…]` writes one with a single stage.

## What it covers

`applies-to` names branch roots by key and content types by alias. The nearest
branch root above a page (or the page itself) wins; only then a workflow naming
its content type. One workflow per branch root and per content type. A page no
workflow covers publishes as it always has.

## Its settings

| Setting | What it decides |
|---|---|
| `publishers-may-skip` | Whether someone with the publish right on the page publishes directly. `false` sends everyone through it, administrators included |
| `on-edit` | What saving a waiting page does: `withdraw` the request; `approve-latest`, the request goes on with what was saved; `lock`, refused until decided; `lock-after-first-approval`, editable until someone approves |
| `self-approval` | Whether the person who made the change may approve it: `refused`, `allowed`, or `automatic` — a stage they belong to counts their approval as given |
| `comments` | When a decision needs a comment: `optional`, `on-send-back`, `always` |
| `unpublish` | Whether taking a covered page down needs approval too ("Request unpublish") |
| `on-change` | What a request in flight does when the workflow changes: `keep` the version it started under, `restart` from the first stage of the new one, or be `withdrawn` |
| `scheduling` | Whether a request may say when to publish or take the page down. Off unless set; the file carries it only when it is on, so workflows from before it keep their version |

**Administrators may always edit** a waiting page, whatever `on-edit` says: the
request goes on with what they saved, and their edit is in its history.

A workflow's version is a hash of its file without the canvas positions, so
moving a box is not a change. The designer names the requests a change affects,
and what `on-change` will do to them, before it saves; a change that arrives as
a file (a deploy, a bundle) applies `on-change` when the schema syncs, and the
request's history says so.

## The gate

Publishing, publishing a branch, creating and publishing in one go, and — when
the workflow covers it — unpublishing are refused for a covered page whose
workflow the caller may not skip, with the workflow's name and where to send it
from. Saving is checked against `on-edit` before it is written, and what the
save did to a waiting request is recorded after.

The gate stands in the document operations (`@crombolo/content`, story 170), so
it holds wherever a publish starts. Who is acting decides how it applies:

- **A backoffice user** is gated as above.
- **The command line** (`content publish`, `content unpublish`) is gated as
  someone who may not skip: a covered page is refused with the same reason.
  `--skip-approval` goes ahead anyway, and the audit log records the publish
  with *Approval skipped from the command line*.
- **The site itself** — the schedule, an approved request, a form's workflow —
  acts on what was already decided and is not gated.

Asking about a page is checked as opening it is (story `088`): sending a page
for approval, or asking to take it down, needs Read and Update on it, and its
request history needs Read, inside the person's start nodes. Otherwise the
answer is a `403` and nothing is recorded.

An approval publishes the version it was given for (story 172). If the page has
changed since then without the request following it, the publish is refused and
the request goes back to its editor to be approved again.

Approval publishes through the same port an editor's publish takes, after the
decision's transaction has committed, so it is cached, tracked and announced as
any publish is. A page that cannot be published at that point — a mandatory
value since emptied, an unpublished parent — goes back to its editor with the
reason, rather than sitting approved and unpublished.

## A time on a request

When the workflow has `scheduling`, a request can say when the page should go
live, when it should come down, or both — per culture through the API, one
time for the whole page on the Workflow tab. Story `029`.

- **Sending** refuses a time the workflow does not allow, one that has passed,
  a take-down before the publish, a publish time on a request to take the page
  down, and a culture the request does not send. The time is in the request's
  history and in the approvers' e-mail.
- **The last approval schedules it** instead of publishing, and the request
  becomes *scheduled*: approved, and open until its time. A time that passed
  while the request waited publishes at once, and its history says so; cultures
  with no time publish on approval. A take-down time on a request to publish is
  written alongside, and stays an ordinary schedule once the page is live.
- **The schedule job publishes it.** The request ends as approved when its last
  time has come, with the editor e-mailed; a page that cannot be published then
  (an unpublished parent) goes back to its editor with the reason.
- **Until then the page is still held by the request.** Saving it does what
  `on-edit` says: `withdraw` ends the request and clears its schedule; `lock`
  and `lock-after-first-approval` refuse the save; `approve-latest` lets the
  edit go out at the time. An administrator's edit goes in and is recorded.
  Sending it again is refused: changing the time is a new request, so the
  scheduled one is withdrawn first, which clears its schedule.
- **Someone who may skip the workflow can overtake it.** A direct publish,
  unpublish or reschedule of the page ends the request as *superseded*, naming
  who did it, and the schedule stays as they set it.
- **A schedule that goes some other way** — the page moved to the recycle bin
  or deleted, its schedule cleared by an import or the command line — ends the
  request as withdrawn, with the reason, the next time the job runs.
- **A workflow change leaves a scheduled request alone**: it is decided
  already, so `on-change` and the designer's list of affected requests pass it by.

Times are kept in UTC and shown in the reader's own time, with the zone named;
"at the time" means within the job's interval of it, as for any schedule.

## In the backoffice

- **The Workflows section** — *Waiting for me* (stages the reader may decide),
  *In flight*, *Decided*, and, for administrators, *Workflows*: the list and the
  designer. Admin, Editors and Writers have the section; any group can be given it.
- **The designer** — two tabs. *Settings*, which opens first: what the workflow
  covers and its rules. *Stages*: stages as boxes on a canvas, dragged into
  place; *Connect stages* draws an arrow, clicking one removes it; beside the
  canvas, the selected stage's approvers, required count and send-back.
  Read-only where the schema directory is.
- **A page's Workflow tab** — which workflow covers it, the graph coloured by
  where a request stands, *Send for approval* and *Request unpublish*, *Approve*
  and *Send back* for the approvers of a waiting stage, *Withdraw* for the
  sender, and the history of each request. Where the workflow allows it,
  *Publish at* and *Take down at* beside the send buttons; a request shows the
  time it asked for. The section's lists have a *When* column.

Approvers are e-mailed when a stage starts waiting on them, and the sender when
the request is decided, through the e-mail port when one is configured. Every
step is in the audit log.

## Where it lives

| | |
|---|---|
| The model and graph rules | `packages/core/src/workflows.ts` |
| The file | `packages/schema/src/workflows.ts`; loaded, validated and hashed with the schema |
| The record | `approval_request`, `approval_step`, `approval_history` (migration 038), `approval_request.schedule` (044); `packages/data/src/repositories/approvals.ts` |
| Publishing at a time | the schedule job (`packages/server/src/jobs.ts`) tells the engine what it fired: `scheduleFired`, then `sweepScheduled` |
| Synced workflows | `key_value` `crombolo:workflows`; `syncWorkflows` applies `on-change` |
| The engine | `packages/server/src/approvals.ts` |
| The gate | `ApprovalGatePort`, asked by the document handlers |
| The section's API | `packages/server/src/approvals-api.ts`, at `<backoffice>/crombolo/api/approvals/` |
| The screens | `packages/backoffice-host/plugin/workflow-*.js` |

A bundle that carries `schema/workflows/*.toml` installs them like any schema
file; requests never travel.
