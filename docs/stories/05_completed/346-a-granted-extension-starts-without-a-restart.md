# 346 — A granted extension starts without a restart

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
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

## Plan

Decided 2026-11-14: **wired into the running server**, not a supervised restart.
Since story 311 an extension is a Deno process, and the server only ever holds a
stand-in for it built from its description (`isolatedBundle`,
`extension-process.ts`): nothing of its code is loaded into the server. What waits
for a restart is the server's side, five places built once at boot:

| What the extension declares | Where it is wired today | Built |
|---|---|---|
| site routes | the route table (`createRoutes`, `server.ts`), checked for clashes | once |
| back-office routes and screens | the mounted bundles (`createServerBundles`, `bundles.ts`) | once |
| jobs and schedules | the job owners (`core.ts`) | once |
| content-event handlers | the subscribers (`webhooks.ts`, from `config.bundles`) | once |
| its tables | its role and migrations, in `bootstrapDatabase` | once |

Its back-office code already reloads live (`bundleReloader`), and removing one
already stops its process live (story 328).

1. **One start path.** `startExtensions` becomes a loop over `startExtension(pkg)`,
   which builds the process, checks its isolation, and returns the stand-in, or why
   it cannot run. Boot and a live start call the same function.
2. **The five places take an add and a remove**, each with the check boot makes,
   against what is mounted now: the route table (a clash with a route already there
   refuses the start, naming both), the mounted bundles, the job owners and their
   schedules, the event subscribers, and the extension's tables, its owner's role and
   pending steps run on their own on a node that owns writes (a `web` node skips them,
   as at boot). Boot adds through the same calls.
3. **On grant or enable**, the node starts it and mounts it. A start that fails, a
   role the database user may not create say, is reported as boot reports one, in
   the failed list, the health check and the answer, and the grant is kept.
4. **Other nodes** hear of it through a cache instruction, as they hear of changed
   files (`appendCacheInstruction`), and start it too. A node that cannot says so in
   its health check.
5. **Turning off and removing.** Removing stops the process and unmounts it.
   Turning off keeps today's answer, 503 "Turned off", from a route that stays
   mounted, and stops the process; turning on again starts it.
6. **The pending restart** that grant and enable record since 2026-11-14 goes, as
   does its notice; installing code still needs one, since a new version's files
   are what boot reads.

Out of scope: an extension imported in `crombolo.config.ts` the old way, which is the
site's own code and runs in the server's process; that still needs a restart.

## Acceptance criteria

- [x] Granting an extension with a server half starts it at once: its route
      answers, its job runs and its event handler fires, with no restart.
- [x] Turning one on that was off at boot does the same.
- [x] Another node starts it too, or says it needs a restart.
- [x] One that cannot start says why, as boot does, and the site keeps running.
- [x] Boot and a live start go through the same code.
- [x] A route that clashes with one already mounted refuses the start, naming both.
- [x] Turning one off stops its process, its routes answering "Turned off"; on again
      starts it; removing it stops and unmounts it.
- [x] Granting and enabling no longer record a pending restart.
- [x] Tests on both engines, including two nodes on one database.

## Built

Wired into the running server, as planned; no self-restart.

- **One start path.** `startExtension` (`server/src/extension-discovery.ts`) builds,
  starts and checks one extension and answers its stand-in, why it failed, or that it is
  not granted. Boot's `startExtensions` is a loop over it; a live start calls it too.
- **Add and remove on the five places**, each with boot's check against what is there now:
  - the route table: `createRoutes` (`routes.ts`) gains `add` (checked with
    `siteRouteProblems` against the routes there, so a clash names both owners) and
    `remove(owner)`; the server hands core a `LiveRouteTable` (`core.setRouteTable`);
  - the mounted bundles: `createServerBundles` (`bundles.ts`) gains `add(bundle, pkg)`
    (`validateServerBundles` on it, refusing an id already mounted) and `remove(id)`, and
    is now made even with no bundles at boot;
  - the job owners and the event subscribers both read `config.bundles`, which a live
    start and an unmount change in place, so jobs, schedules and handlers follow;
  - its tables: made and migrated on a node that owns writes, opened on a worker (refused
    while steps are pending), left alone on a `web` node, as at boot; production refuses
    pending steps with `UpgradePendingError`'s words rather than running them;
  - also its media folders and its components (`extension-components.ts` gains
    `add`/`remove`).
- **Lifecycle in core** (`core.ts`): `extensionChanged(id)` brings an extension on this
  node to what its grant says (started and mounted when granted and on; process stopped,
  routes kept answering 503 "Turned off", when off; stopped and unmounted when no longer
  installed), one change at a time per extension, records a failure in
  `failedExtensions` (Installed's "Could not start" and the health check) or clears it,
  and appends an `extensions` cache instruction (`data/src/cluster.ts`, no checkpoint).
  Every node's poller brings the extension up to date when it hears it. Open back offices
  are told the extensions changed.
- **Grant and enable** (`bundle-admin.ts`) call it through a `changed` option in place of
  `running`: no pending restart, no notice; an answer carries `couldNotStart` with the
  reason when it could not start, and the grant is kept. Disable stops the process.
  Uninstall unmounts it at once and records no restart when the server did that. On the
  command line, `localBundleAdmin` writes the instruction, so a site running on that
  database follows, and its uninstall still records the restart.
- **Docs:** `bundles.md` ("Installed code waits for a restart", "Extensions run once
  granted"), `extensions.md` ("Starting one"), release notes.

Left for a restart, and said in `bundles.md`: a new version's files, changed settings, the
form workflow types an extension adds (`formTypesOf` is read once at boot), and an
extension the site's code imports the old way. Boot still builds the route table and the
mounted bundles from its whole list; a live start goes through the same validators by the
new `add` calls. Taking a signer off Trusted signers (335) withdraws the grant and calls
`extensionChanged` for each extension it switched off, so its process stops then too
(`trusted-signers-admin.ts`, through the server's `checks.changed`).

Tests: `tests/extension-live-start.test.ts` (a real Deno extension with a site route, a
back-office route, a job on its own table and a content-event handler): granting starts it
(route, job, event delivery), off stops the process and answers 503 and on starts a new
one, on after being off at boot, removal unmounts, a clash with a site route refuses
naming both, one that throws as it loads says why and keeps its grant, and two nodes on one
database (the second starts and stops it from the instruction). `tests/bundle-manage.test.ts`
now expects no pending restart from grant or enable.
