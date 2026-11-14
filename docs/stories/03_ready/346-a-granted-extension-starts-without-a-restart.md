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

- [ ] Granting an extension with a server half starts it at once: its route
      answers, its job runs and its event handler fires, with no restart.
- [ ] Turning one on that was off at boot does the same.
- [ ] Another node starts it too, or says it needs a restart.
- [ ] One that cannot start says why, as boot does, and the site keeps running.
- [ ] Boot and a live start go through the same code.
- [ ] A route that clashes with one already mounted refuses the start, naming both.
- [ ] Turning one off stops its process, its routes answering "Turned off"; on again
      starts it; removing it stops and unmounts it.
- [ ] Granting and enabling no longer record a pending restart.
- [ ] Tests on both engines, including two nodes on one database.
