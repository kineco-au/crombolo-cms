# 346 — A granted extension starts without a restart

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** L
**Depends on:** 311

## Story

As an administrator, I want an extension I grant or turn on to start running at
once, so that I don't have to restart the site, or ask whoever hosts it to, before
it does what I granted it for.

## Context

An extension's server half is built and started once, at boot (`startExtensions`,
`server/src/extension-discovery.ts`): one that is not granted then, or is turned
off, is skipped, "nothing of an extension that is not granted is built, let alone
run". Granting or enabling it later updates the grant and the server's copy of it
(`bundle-grants.ts`), and nothing starts it. Since 2026-11-14 that is said: grant
and enable record a pending restart, as an install does, and the answer says "It
takes effect when the site restarts". Turning one off is already immediate: its
routes answer 503 "Turned off" while its process keeps running.

Starting one at boot is more than a process:

- its Deno process (story 311), with its settings, origins and read paths;
- its database role and tables, made and migrated while `bootstrapDatabase`
  prepares the database (`OwnerSetupNeededError` when the role cannot be made);
- its routes, jobs, schedules and content-event handlers, wired into the server as
  `config.bundles` is read;
- its back-office code, which the client loads with the rest.

## Proposed

- **Start on grant or enable**, on the node that runs extensions: build it, start
  its process, run its owner's role and table steps, and mount its routes, jobs,
  schedules and events into the running server, as boot does, through one start
  path that boot and this share.
- **Other nodes** hear of it as they hear of a schema change, and start it too, or
  say they need a restart where they cannot.
- **What cannot start** (a role the database user may not create, a process that
  fails its isolation check) is reported as boot reports it, the grant kept, and
  the answer saying why it is not running.
- **Turning off** stays as it is; removing one already stops its process (story
  328).
- The pending restart that grant and enable record today goes, for an extension
  that starts this way.

## Acceptance criteria

- [ ] Granting an extension with a server half starts it at once: its route
      answers, its job runs and its event handler fires, with no restart.
- [ ] Turning one on that was off at boot does the same.
- [ ] Another node starts it too, or says it needs a restart.
- [ ] One that cannot start says why, as boot does, and the site keeps running.
- [ ] Boot and a live start go through the same code.
- [ ] Tests on both engines.
