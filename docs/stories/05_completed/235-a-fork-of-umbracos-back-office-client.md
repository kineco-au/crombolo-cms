# 235 — A fork of Umbraco's back-office client

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer changing how the back office behaves, I want to change Umbraco's
client source and have the change built, so that a change is code in the place
it belongs. Today it is a patch over built output, or code rewiring Umbraco's
internals at runtime.

## Context

Found 2026-10-31, building story `234`. The back office is
`@umbraco-cms/backoffice@18.2.0` from npm, made into `@crombolo/backoffice-dist`
by `scripts/vendor-backoffice.ts`. Crombolo changes it in two ways.

1. **Find-and-replace on built code at vendor time:** `UPSTREAM_PATCHES`, nine of
   them. They fail loudly ("patch no longer applies") when Umbraco's code moves.
   - Settings left out of the header's tabs.
   - The sign-in modal's double success.
   - The focus ring.
   - The redirect dashboard's setting.
   - The header logo.
   - Deprecations logged in production.
   - The excluded packages' lines.
   - Rebranding, which `rebrandModule` does across every module.
2. **At runtime, from the plugin:** eleven files.
   - **Through the extension registry:** `components-tree.js` and
     `content-type-labels.js` unregister and re-register menu items.
   - **Through Umbraco's internals:** they rewrite class prototypes or edit
     rendered DOM. These are `tsx-editors.js`, `edit-conflicts.js`,
     `notifications-dialog.js`, and in `branding/`: `query-builder.js`,
     `log-viewer-menu.js`, `client-credentials.js`, `sign-in.js` and
     `branding.js`. They fail silently when a private detail changes, and they
     depend on running before Umbraco draws what they change.

   That dependence is what stopped `234`. A page opened straight at Settings is
   drawn before an entry point can give the section another element, and
   working around it took unregistering the section for a tick.

## Decisions (2026-10-31)

1. **Fork Umbraco's back-office client, and build the package we vendor from
   it.**
   - The fork is Umbraco-CMS's `src/Umbraco.Web.UI.Client` at the release we
     pin (`release-18.2.0`), with Crombolo's changes as commits on top.
   - Its `build:for:npm` builds the `@umbraco-cms/backoffice` package that
     `vendor:backoffice` already takes from npm, so the steps after it stay.
   - The build needs Node and npm (Node 24, npm 11, per the client's
     `engines`), as a tool only. Nothing .NET, and nothing a site installs.
   - Not chosen:
     - Moving every runtime patch to vendor-time patches: still patches over
       built output.
     - Contributing upstream alone: Umbraco would not take Crombolo's product
       changes.

2. **The fork lives in this repository, as two branches and a worktree.**
   - **`umbraco/upstream`:** an orphan branch holding only Umbraco's
     `src/Umbraco.Web.UI.Client`, with its license, as one snapshot commit per
     Umbraco release, starting with `release-18.2.0`. A snapshot rather than
     Umbraco-CMS's history: about 5 MB compressed, where the whole history
     would add gigabytes to a 48 MB repository. Umbraco's history stays on
     GitHub for blame.
   - **`umbraco/crombolo`:** on top of `umbraco/upstream`, Crombolo's changes as
     ordinary commits.
   - **The worktree:** `umbraco/crombolo` checked out at `vendor/umbraco-client/`,
     which `main` ignores. Edited, committed and rebased like any branch.
     `bun run fork:checkout` sets it up on a fresh clone and in CI.
   - **The pin:** `main` names the fork commit it builds from, in a one-line
     file in `packages/backoffice-dist/`. `vendor:backoffice` builds exactly that
     commit, and CI caches the output by it.
   - **Upgrading Umbraco:** the new release's client folder committed onto
     `umbraco/upstream`, `umbraco/crombolo` rebased onto it, and the pin moved.
     A conflict is one of Crombolo's changes meeting one of Umbraco's.
   - **The cost:** a change to the back office and to Crombolo's own code is a
     commit on each branch, the fork's and the pin's. A pull request on `main`
     shows the pin moving, not the fork's diff, so the fork's commits are
     reviewed on their branch. Pushing the fork branch is part of a release.
   - **Not chosen:**
     - A patch series applied to the upstream tag: every change means
       exporting a patch rather than committing.
     - A fork repository: a second repository to keep in step, and a public
       step to create.

3. **What moves into the fork.**
   - **Moved:** the nine `UPSTREAM_PATCHES`, and the runtime patches that
     rewrite Umbraco's prototypes or rendered DOM. Those are `tsx-editors.js`,
     `edit-conflicts.js`, `notifications-dialog.js`, and in `branding/`:
     `query-builder.js`, `log-viewer-menu.js`, `client-credentials.js`,
     `sign-in.js` and `branding.js`.
   - **Deleted from the fork's source:** the excluded packages (telemetry,
     performance profiling, the news feed), rather than filtered from the
     build.
   - **Kept as a vendor step:** rebranding. In source it would be thousands of
     strings across hundreds of files that conflict at every upgrade. As a step
     it re-applies mechanically.
   - **Kept in the plugin:** `components-tree.js` and `content-type-labels.js`,
     which go through the extension registry.
4. **It builds at `vendor:backoffice` and in CI**, cached by the pinned fork
   commit, as the vendored output is cached now.
5. **Offering fixes to Umbraco waits.** The sign-in modal, the focus ring and
   production deprecations can be offered once the fork is running; each leaves
   the fork when an Umbraco release carries it.

## Plan

In stages, each leaving the back office working:

1. **The fork, unchanged.** The branches, the worktree, `fork:checkout`, the
   pin, and `vendor:backoffice` building from the fork's package rather than
   npm's. The browser suite passes as before.
2. **The vendor-time patches** become fork commits, and `UPSTREAM_PATCHES` goes.
3. **The runtime patches** become fork commits, and their plugin files go.
4. **The test** that holds the plugin to the extension registry, and the docs.

## Acceptance criteria

- [x] `@crombolo/backoffice-dist` is built from the fork, and the back office
      behaves as it does today: the full browser suite passes.
- [x] No plugin file rewrites an Umbraco prototype or edits Umbraco's rendered
      DOM; a test holds the plugin to the extension registry.
- [x] `UPSTREAM_PATCHES` is gone, its fixes being commits in the fork. One patch
      remains, to UUI (a dependency the client bundles, not the client), as
      `DEPENDENCY_PATCHES`.
- [x] Upgrading Umbraco is a documented rebase of the fork onto the new release
      tag, with the steps in `docs/backoffice-hosting.md`.
- [x] The build needs no .NET, and nothing it needs is installed by a site.
- [x] Docs: `docs/backoffice-hosting.md`, `docs/packaging-and-upgrades.md`, the
      README's tool chain, the release notes.

## What was built

- **The fork:**
  - `umbraco/upstream` is one snapshot commit: Umbraco's client at
    `release-18.2.0`, Umbraco commit `3a150afc`.
  - `umbraco/crombolo` holds 16 `Crombolo: …` commits on top.
  - `vendor/umbraco-client/` is the worktree (`.gitignore`d).
  - `packages/backoffice-dist/UMBRACO_CLIENT` is the pin.
  - `scripts/fork.ts` provides `fork:checkout`, `fork:pin` and `fork:build`.
- **Reproducing npm:** the fork, unchanged, built a package identical to npm's
  `@umbraco-cms/backoffice@18.2.0`, apart from the license file and a
  TypeScript build cache. Vendored from it, the output was byte for byte what
  npm's package gave. `npm pack`'s `prepack` (`tsc-alias`) is what turns the
  client's bare imports relative, so the build packs as Umbraco's pipeline does.
- **Into the fork as commits:**
  - Eight of the nine vendor-time patches.
  - Deleting telemetry, profiling and the news feed, with their lockfile entries.
  - From the runtime patches: the query builder's language label, the log
    viewer's searches, the client credential prefix, the page title (the site's
    name from `<meta name="application-name">`), the logo's link, and the
    dark-theme logos.
  - The side panel host in the shell (story 182). It was not in the list, but
    it docked into the shell's shadow root, which the new test forbids.
- **Seams, not copies.** Where the plugin's logic is Crombolo's own, the fork
  adds a seam in `umbCromboloHooks`, exported with
  `@umbraco-cms/backoffice/extension-registry`, and the plugin answers it. The
  logic and its unit tests stay in the plugin, and the fork's diff stays small
  to rebase:
  - `viewEditor`, the scaffolds, `writeLayout`, `translateSnippet`,
    `viewLanguageLabel` and `hideRazorInserts` for `tsx-editors.js`;
  - `onEntityLoad` for `edit-conflicts.js`;
  - `notificationsUnavailable` for `notifications-dialog.js`.
- **Gone from the plugin:** `branding/branding.js`, `client-credentials.js`,
  `query-builder.js`, `log-viewer-menu.js`, and the modal guard in
  `sign-in.js`, which the fork's sign-in fix covers. Also gone: the vendor
  step's URL-imported entry, and `SHELL_STYLES`/`dockInto` in the side panel.
- **Tests:**
  - `tests/plugin-boundary.test.ts` fails on a prototype rewritten, a property
    redefined, `whenDefined` used to patch, another element's shadow DOM, or
    `import.meta.resolve` of Umbraco's modules.
  - The served client is checked for each fork change (`tests/vendor.test.ts`,
    `tests/branding.test.ts`, `tests/side-panel-plugin.test.ts`,
    `tests/content-notifications.test.ts`), and the plugin's seams in their own
    tests.
  - The full browser suite passes: 41 tests.
- **CI:** the vendored client's cache key includes the pin and `scripts/fork.ts`,
  and the job that builds it sets up Node 24. The release job already had it.
- **Docs:** `docs/backoffice-hosting.md` ("The fork of Umbraco's client",
  upgrading, side panels), `README.md`, `docs/brand.md`,
  `docs/configuration.md`, `docs/rendering.md`, `docs/api-contract.md`, the
  release notes.
