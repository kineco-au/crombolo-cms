# 176 — Background jobs run independently

**Epic:** R — Architecture and reliability · **Priority:** could · **Size:** L
**Depends on:** 171

## Story

As someone running a busy site, I want to deploy background workers separately
from editor and visitor servers, so that I can scale and restart jobs without
adding unnecessary HTTP servers or interrupting page delivery.

## Context

The architecture review scored runtime composition **3.5/5**. Explicit `all`,
`api` and `web` roles distinguish editor and visitor serving, and render and
delivery packages have useful source abstractions. However,
`packages/server/src/server.ts` is a large shared composition root, and
`packages/server/src/jobs.ts` starts on API-capable processes. There is no
independently bootable worker role.

A web process is not universally read-only: member authentication, form
submissions and operational bookkeeping can require writes. Separating runtime
composition must preserve those capabilities. The candidate remains a modular
monolith with optional host compositions. Story 087 handles production image
packaging; this story handles process responsibilities.

## Decisions before implementation

- Confirm deployment needs and agree worker configuration, job ownership,
  readiness and schema-migration ownership.
- Define dependencies and storage access for each role, and behavior while no
  worker is available.
- Agree claim recovery and graceful shutdown behavior for multiple workers.

## Acceptance criteria

- [ ] Workers start selected jobs without initializing the backoffice SPA,
      Management API router or page-rendering stack.
- [ ] Shared infrastructure and role-specific compositions have explicit
      boundaries and checks against unintended dependency growth.
- [ ] Default `all` deployments retain current behavior; separate API and web
      nodes can delegate jobs through documented configuration.
- [ ] Multiple workers claim work safely, recover abandoned claims and avoid
      duplicate logical processing using story 171's guarantees.
- [ ] Scheduled publishing uses story 170's operations, actor attribution,
      publishing rules and durable events.
- [ ] Startup does not race migration; readiness, shutdown and pending work
      while workers are unavailable have documented behavior.
- [ ] Role tests cover responsibilities and exclusions, including public forms
      and member writes on web nodes; worker tests cover both dialects and
      restart during processing.
- [ ] README and deployment docs show single-process and optional editor,
      renderer and worker topologies with their required access.

## Out of scope

Microservices between every package, mandatory brokers, automatic infrastructure
provisioning, or making every web request read-only.
