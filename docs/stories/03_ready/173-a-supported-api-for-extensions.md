# 173 — A supported API for extensions

**Epic:** R — Architecture and reliability · **Priority:** should · **Size:** M
**Depends on:** 062, 063

## Story

As an extension author, I want a small, documented API with a clear compatibility
promise, so that I can upgrade crombolo without depending on its internals.

## Context

The architecture review scored extension boundaries **3/5**. Bundles already
have explicitly wired factories, namespaced routes, host-enforced access checks
and narrow capabilities. The bundle host does not provide a raw database.

However, `packages/server/src/index.ts` exports most adapters and runtime
machinery, while `packages/data/src/index.ts` exposes repositories, migrations
and database internals. Consumers can depend on those exports even though the
capability interface is narrow, making internal changes public obligations.

The candidate is an intentional supported export surface with automated checks
against accidental growth. Installed extensions remain trusted in-process
JavaScript; this is an API stability boundary, not a sandbox.

## Decisions before implementation

- Inventory consumers and classify supported, advanced and internal exports,
  including site configuration, bundle tables and hosting plugins.
- Choose entry points or a dedicated SDK, and agree compatibility and migration
  policy before removing consumed exports.

## Acceptance criteria

- [ ] Document the supported extension surface and its versioning promise.
- [ ] First-party bundles and external-consumer fixtures compile and run using
      supported entry points only.
- [ ] Package exports expose the agreed surface without accidental wildcard
      exports or unrestricted subpaths revealing internals.
- [ ] Automated API-surface and import-boundary checks catch unintended exports
      and first-party extension imports of internal implementations.
- [ ] Existing route authorization, capability restrictions, table isolation and
      package compatibility checks continue to pass.
- [ ] Changed exports have tested migration paths and release notes; there are
      no unexplained removals of previously public APIs.
- [ ] README and bundle docs explain package boundaries, supported APIs and
      trusted code execution.

## Out of scope

Sandboxing JavaScript, replacing the Umbraco frontend extension model, or
redesigning storage to hide its implementation from extensions.
