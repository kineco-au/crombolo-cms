# 170 — The same content rules from every entry point

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** L (all document writes)
**Depends on:** 028, 081, 083

## Story

As a site owner, I want content changes made in the backoffice, from the CLI or
by a scheduled job to follow the same rules, so that their outcome and audit
trail do not depend on how they were started.

## Context

The architecture review scored the shared application layer **3/5**. Async
ports and repositories share persistence behavior, but the complete workflow
is spread across `packages/server/src/adapters/documents.ts`, Management API
authorization, `packages/cli/src/support/publish.ts` and
`packages/server/src/jobs.ts`. These callers separately assemble policy,
auditing, webhooks and content notifications. Business workflows also live
inside the large document repository, coupling orchestration to persistence.

The candidate is a shared asynchronous application layer for document writes.
Transport adapters translate inputs and outputs; the operation owns actor
context, policy, transaction coordination and resulting events. This does not
require a new network API or a CLI command for every endpoint.

## Decisions (2026-10-22)

- **A new package, `@crombolo/content`**, holds the document operations. It
  depends on `@crombolo/core` and `@crombolo/data` only — never on
  `@crombolo/api-management`, HTTP or CLI output — so the boundary is enforced by
  its dependencies. The per-node permission rules for document writes move into it
  from `api-management/src/authorization.ts` (`DOCUMENT_RULES`, start nodes,
  branch descendants, cultures, property writes); the router keeps authentication
  and section checks. `server`, `cli`, the jobs and approvals call it.
- **Three actors**, passed explicitly to every operation:
  - *user* — a backoffice `Principal`: its permissions, start nodes, cultures and
    property writes, and the approval gate.
  - *local operator* — the CLI on the box: no permission checks (it holds the
    database), but **approvals apply**: publishing a page whose stage needs
    approval is refused, saying so, unless the command passes `--skip-approval`,
    which the audit records. This is a deliberate change from today's bypass.
  - *system* — the scheduled job and an approval finishing: acts on what was
    already decided (a schedule, an approved request), with no permission check.
- **Operations emit, transports wire.** Each operation reports what happened to an
  event sink — a page created, saved, published (cultures), unpublished,
  scheduled, moved and so on, with the actor. The server and the CLI wire that sink
  to the same database-backed steps: an audit entry per document, the webhook
  queue, change notifications, the cluster cache instruction and redirect
  tracking. Live backoffice refresh (server events, the preview hub, the search
  kick) is the server's only. The router stops deriving document events from
  operation ids (`webhook-events.ts`, `notification-events.ts`,
  `server-events.ts`, `audit.ts` for documents); the contract's payloads stay the
  same. Story 171 later makes the sink durable.
- **Publish rules stay in the repository** — published ancestors, mandatory
  languages, filled mandatory fields — as invariants guarding every path,
  imports included. The repository keeps SQL, locking and those invariants; the
  orchestration in it (`createAndPublish`, `updateAndPublish`, `publishBranch`)
  moves to the operations.
- **All document writes, in this story**: save, publish, unpublish, schedule,
  publish with descendants, trash, delete, restore, empty the bin, move, copy,
  sort, rollback, domains and public access. Transfer, schema and people
  workflows stay out, as before.

## Inventory (2026-10-22)

Every document write today, and what it does around the write. ✓ done, ✗ not.

| Entry point | Where | Actor | Permissions | Approvals | Audit | Webhook | Notification | Live refresh | Redirects |
|---|---|---|---|---|---|---|---|---|---|
| Backoffice | `api-management/src/handlers/document.ts` → `server/src/adapters/documents.ts` | Principal | ✓ router `authorize()` | ✓ handler | ✓ router, per operation | ✓ router | ✓ router | ✓ router | ✓ adapter (not unpublish, trash, restore) |
| Approvals finishing | `server/src/approvals.ts` `finish()` | approver | stage only | is the gate | ✓ own steps | ✗ | publish only | ✗ | ✓ via port |
| Scheduled job | `server/src/jobs.ts` | system | — | at scheduling | ✓ per item | ✓ own | publish only | "Updated" only | ✗ |
| CLI publish / unpublish | `cli/src/support/publish.ts` | OS user | ✗ | **bypassed** | one per command | ✗ | publish only | n/a | ✗ |
| CLI empty bin | `cli/src/commands/recycle-bin/empty.ts` | OS user | ✗ | — | one per command | ✗ | ✗ | n/a | — |
| Bundle import, push, dashboard | `transfer/src/import.ts` | operator / user / remote | own | bypassed | per run | ✗ | ✗ | ✗ | carried |
| Revert | `transfer/src/revert.ts` | operator | ✗ | bypassed | per command | ✗ | ✗ | ✗ | ✗ |
| Forms "save as content" | `server/src/form-workflows.ts` | none | ✗ | bypassed | **✗** | ✗ | ✗ | ✗ | ✗ |
| Assistant changesets | `assistant/src/apply.ts` | approving user | via router | via router | ✓ | ✓ | ✓ | ✓ | ✓ |
| Domains | port `setDomains`; `server/src/domains.ts` `syncDomainsFile` | user / operator | ✓ / ✗ | — | ✓ / per command | ✗ | ✗ | ✗ | — |

Shared by every path today: the repository's publish rules, the search queue, the
cluster cache instruction (publish, unpublish, trash, move, sort, restore) and the
schema-state write guard.

### Corrections this story makes (reviewed)

- `PostDocument` and `PostDocumentCreateAndPublish` skip the property-write
  check; `PutDocumentById` has no culture check.
- The publish webhook fires when a request only schedules; rollback, restore,
  sort and domains raise none.
- The scheduled job does no redirect tracking and no preview refresh; approvals
  raise no webhook and no live refresh.
- CLI `--at` / `--until` schedules only the first culture and never tells
  approvals; CLI publish of several pages checks all first but writes one at a
  time, so it can stop half done — it becomes one transaction.
- `createAndPublish` is two transactions; it becomes one.
- Forms "save as content" writes no audit entry.
- *Bugs to confirm first:* a remote push may leave the receiving node's published
  cache stale (`createRemote` has no cache hook and the node skips its own
  instruction); domains set from the CLI and public-access changes post no cluster
  cache instruction, so other nodes are not told.

Transfer imports keep their own whole-run transaction and per-run audit; they gain
the per-document events only if that proves cheap, as a follow-up.

## Plan

1. **Characterise first.** Tests pinning what each entry point does today, per
   operation (content, versions, audit, webhooks, notifications, cache), so the
   move is checked against them and every intentional difference is a named test.
2. **The package.** `packages/content`: `Actor` (`user`, `localOperator`,
   `system`), `DocumentOperations` over ports for persistence (the repository),
   approvals, redirect tracking and an `EventSink`; the permission rules moved from
   `api-management`, which re-exports what the router still needs. Packaging,
   README and `docs/architecture.md` updated.
3. **Save, publish, unpublish, schedule, publish with descendants** through the
   operations, one transaction each, from the backoffice handlers, approvals, the
   scheduled job and the CLI (`--skip-approval` added). The router's document
   event mappings removed for these operations; the server's sink raises the same
   webhooks, notifications, audit entries and live refresh.
4. **The rest**: trash, delete, restore, empty bin, move, copy, sort, rollback,
   domains and public access, the same way; forms "save as content" through
   `save` as the system actor.
5. **Corrections** above, each with its test, and the bugs confirmed or ruled out.
6. **Docs**: README and `docs/architecture.md` describe the boundary;
   `docs/workflows.md` the actors and the CLI's approval rule; `docs/audit-log.md`
   and `docs/webhooks.md` what each entry point now records and raises.

Tests run on SQLite and Postgres throughout, since it touches the data layer.

## Acceptance criteria

- [ ] Inventory document write entry points and their intended policy and side
      effects, including save, publish, unpublish and scheduling.
- [ ] HTTP, local CLI and scheduled jobs invoke shared operations for those
      writes instead of independently assembling business workflows.
- [ ] Operations receive an explicit actor and enforce agreed authorization,
      approval and publishing rules; authentication stays at transport boundaries.
- [ ] Equivalent changes produce equivalent content, actor-attributed audit
      records and events; intentional differences have tests.
- [ ] Persistence adapters own SQL and locking; application operations do not
      depend on HTTP requests, responses or CLI output.
- [ ] Existing backoffice contracts and local CLI behavior remain compatible,
      except for explicitly reviewed corrections.
- [ ] Tests cover all entry points, refusals and rollback on SQLite and Postgres.
- [ ] README and architecture documentation describe the implemented boundary.

## Related work and scope

Story 029 adds approval-aware requested publishing times; this story preserves
that workflow without absorbing its feature. Story 171 makes operation events
durable. Transfer, schema and people workflows can follow separately after the
document boundary proves useful.
