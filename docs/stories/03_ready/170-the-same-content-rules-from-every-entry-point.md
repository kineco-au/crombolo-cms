# 170 — The same content rules from every entry point

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** L
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

## Decisions before implementation

- Agree operation boundaries and package ownership, starting with document writes.
- Define user, trusted local operator and scheduled-system actors, including
  intentional policy differences. Local administrative authority must be explicit.
- Agree how existing approvals and Umbraco request contracts are preserved.

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
