# 181 — A host installs a site's bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** S
**Depends on:** 063

## Story

As someone who runs crombolo for other people's sites, I want to install a
site's bundles with my own tooling, and have a running server take them up
without a restart, so that the people I host can add bundles where I let them
and every node agrees on what is installed.

## Context

A runtime install is per-node and ephemeral, so a site of several nodes turns
it off with `runtimeInstalls: false` ([`../../bundles.md`](../../bundles.md),
"What it cannot do"). What is left is the developer's route: `bun add`,
commit, and deploy. The Marketplace says exactly that, in its banner and on
each package.

A host can offer a third route: it resolves the site's packages once, puts the
same `node_modules` and `package.json` on every node that serves the back
office, and keeps them there across restarts. Three things stand in the way.

- **A running server cannot be told its dependencies changed.** Discovery is
  memoized by the extension registry (`createExtensionRegistry`,
  `extensions.ts`) and invalidated only by the Marketplace's own install.
  Files the host writes stay unseen until a restart, and a restart is an
  outage on a node that also serves visitors.
- **The Marketplace's wording is wrong there.** "Add it with `bun add`, then
  deploy" names a step the site's people don't have. The host's own place for
  installs can't be named.
- **A host can't check a package by the CMS's rules before installing it.**
  `validateBundlePackage` and `peerRangeProblem` (`bundle-package.ts`) live in
  `@crombolo/backoffice-host`, which isn't part of the public API (`173`). A
  host either reaches past the umbrella or re-implements them and drifts.

Only the back-office half matters for this. A runtime install never loads a
server half, and a host that wants one still wires it in its config and
deploys, so nothing here loads code into a running process. A `role: web`
node serves no back office, so it needs none of this.

## Acceptance criteria

- [x] **`reloadBundles()` on the server handle.** It re-runs discovery from the
      site's `package.json` and `node_modules` as they are now, so new
      extensions are served, removed ones are not, and `/bundles/<pkg>/…`
      follows. It reports what changed: added, removed, and problems.
- [x] **Open back offices hear about it.** The reload emits an event on the
      live-update channel, and a signed-in back office offers "Extensions
      changed — reload to use them" without reloading by itself.
- [x] **A reload never loads a server half.** Configured `bundles` are not
      re-validated or re-mounted, and a newly discovered bundle with a
      `server` field is listed as installed and not wired, as it is today.
- [x] **Where installs happen, set by the host.** A setting (config and
      environment), for example `marketplace.installsElsewhere: { message,
      url }`, used only while runtime installs are off. The Marketplace's
      banner shows the message, with a link to the URL. Each package not
      installed shows the same link in place of the `bun add` line, and
      Installed has no Uninstall, as now. Unset, today's wording stays.
- [x] **The CMS's own checks, exported** from `@crombolo/crombolo`:
      `validateBundlePackage` and `peerRangeProblem`, with their types, so a
      host needs no reach into `@crombolo/backoffice-host`. When `173` draws
      the supported boundary, they are part of it.
- [x] **`docs/bundles.md`** gains a section on a host that installs packages:
      what it writes, when it calls `reloadBundles()`, why only nodes serving
      the back office need the packages, and that output a bundle installs
      should import nothing the host does not provide. The asset path is
      corrected from `/packages/…` to `/bundles/…`.
- [x] **Tests:**
  - a reload sees a package added to and removed from `package.json`;
  - a reload ignores a server half;
  - the event is emitted;
  - the setting replaces the wording, and its absence keeps today's;
  - the exports exist from the umbrella.

## Findings (2026-10-25)

- **Reloading is mostly there.** `createExtensionRegistry`
  (`backoffice-host/src/extensions.ts`) already has `invalidate()`, which the
  Marketplace calls after its own install. Manifests, the import map and the
  `/bundles/<pkg>/…` static branch read `extensions.list()` on each request
  (`server.ts`, `ports.ts`). So invalidating is enough for the next request
  to see the files as they now are. `reloadBundles()` is that, plus a diff of
  the bundles before and after.
- **The boot-time `bundlePackages`** (`server.ts`) is read once to validate
  configured server bundles. It stays as it is, which is the "never loads a
  server half" criterion: a reload touches only the registry.
- **A site's own `server.ts` never holds the handle.** `crombolo(config)` in
  `@crombolo/crombolo` returns `serveOptions` only, and `createServer` is in
  `@crombolo/server`, behind the public boundary (`173`). A method on the
  handle alone cannot be called by a host whose sites start the usual way.
  So the handle is exposed (decided below).
- **The live-update channel** is `events.broadcast('notify', [{ eventSource,
  eventType }])`. The vendored client exposes it as
  `UMB_MANAGEMENT_API_SERVER_EVENT_CONTEXT.byEventSource(…)`. None of our
  plugin's elements listen to it yet. The read-only banner is a header app,
  which is the place for a notice.
- **The wording** lives in `plugin/bundles-marketplace.js` (the banner and the
  per-package `bun add` line), and in `refusedHere` (`server/src/marketplace.ts`)
  for an install refused through the API.
- **`docs/bundles.md`** says `/packages/<name>/<path>` at lines 409 and 693.

## Plan

### 1. Reload

- `reloadBundles()` on `ServerHandle`. It snapshots `extensions.bundles()`,
  calls `invalidate()`, reads the bundles again, and returns `{ added, removed,
  changed, problems }` by package name and version. A newly found bundle with a
  `server` field is reported in `added` with `wired: false`, and nothing is
  mounted.
- It is a no-op on a `role: web` node, which serves no back office.
- When anything changed, it broadcasts `notify` with `{ eventSource:
  'Crombolo:Bundles', eventType: 'Changed' }`.
- **The trigger (decided 2026-10-25): expose the handle.** `@crombolo/crombolo`
  gains `cromboloServer(config)`, which returns the `ServerHandle` (its
  `serveOptions` for `Bun.serve`, plus `reloadBundles()`). `crombolo(config)`
  stays as it is, for the three-line `server.ts`. A host's own `server.ts`
  keeps the handle and calls `reloadBundles()` on each node after writing the
  files there, by whatever means the host uses to reach its processes. The
  handle's type is exported, and listed in `173` as part of the boundary.
  There is no file watcher and no signal.

### 2. The notice

- New `plugin/bundles-changed.js`, a header app. It consumes
  `UMB_MANAGEMENT_API_SERVER_EVENT_CONTEXT`, watches
  `byEventSource('Crombolo:Bundles')`, and shows "Extensions changed — reload
  to use them" with a Reload button. It never reloads by itself. Registered in
  `umbraco-package.json`.

### 3. Where installs happen

- Config `installsElsewhere?: { message: string; url?: string }`, with the
  environment variables `CROMBOLO_INSTALLS_ELSEWHERE_MESSAGE` and `_URL`. It is
  used only while `runtimeInstalls` is off.
- The Marketplace list response carries it beside `installs`. The banner
  shows the message with a link, and each package not installed shows the link
  in place of the `bun add` line. `refusedHere` uses the message too. Unset,
  today's wording stays.

### 4. Exports

- `validateBundlePackage`, `peerRangeProblem` and their types from
  `@crombolo/crombolo`, listed in `173` as part of the boundary to keep.

### 5. Docs and tests

- `docs/bundles.md`:
  - "A host that installs packages": what it writes, how a node is told, that
    only nodes serving the back office need the packages, and that a bundle's
    output should import nothing the host does not provide;
  - `/packages/` corrected to `/bundles/`;
  - `docs/configuration.md` gains the setting.
- Tests:
  - `tests/bundles.test.ts` (or a new `tests/bundle-reload.test.ts`): a
    package added to and removed from `package.json` is seen; a server half is
    reported, not wired; the event is broadcast; a web node does nothing;
  - `tests/marketplace.test.ts`: the setting's wording, and its absence;
  - `tests/packaging.test.ts`, or the umbrella's own test: the exports.

## Implementation (2026-10-25)

Built as planned. What differs, or was found on the way:

- **The reloader compares against what the node last saw**
  (`createBundleReloader`, `packages/server/src/bundle-reload.ts`), not the
  registry's cache. Development leaves that cache off, so a before-and-after of
  the registry alone would never see a change there.
- **The Marketplace's own install goes through the reload.** It is handed the
  registry with `invalidate` routed to `reload()`, so a Marketplace install
  also tells open back offices, and the next host reload does not report it
  again.
- **Umbraco's client `byEventSource` filters on the event type**, not the
  source. So the notice (`plugin/bundles-changed.js`, a header app) subscribes
  with `byEventSourcesAndEventTypes(['Crombolo:Bundles'], ['Changed'])`.
- **A refused install through the API** says the host's message and URL,
  where it used to say `bun add` and deploy.
- **`crombolo()`** now returns `(await cromboloServer(...)).serveOptions`, so
  the two cannot drift apart.
- **Not tested:** a `role: web` node's no-op. The test harness boots the
  default role, and the guard is one line in the handle.
- **Tests:**
  - `tests/bundle-reload.test.ts`: the reloader sees a package added, changed
    and removed and reports each once; a server half is reported unwired; a
    running node serves `/bundles/<pkg>/…` after the reload and not after the
    removal, and broadcasts the event; the umbrella's exports;
  - `tests/marketplace.test.ts`: the host's wording in a refusal, and the
    endpoints carry `installsElsewhere` only while runtime installs are off.

## Out of scope

- How a host resolves, stores or distributes packages. That is the host's.
- Loading a server half without a restart. It has no isolation story
  ([`../../bundles.md`](../../bundles.md)), and a deploy remains the way.
- Provenance (`060`). It applies to whatever installs a package, a host
  included, once built.
