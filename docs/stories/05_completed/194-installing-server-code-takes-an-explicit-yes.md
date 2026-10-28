# 194 — Installing server code takes an explicit yes

**Epic:** G — Trusting and extending bundles · **Priority:** must · **Size:** S
**Depends on:** 063, 181

## Story

As someone installing a bundle from the Marketplace, I want a bundle that
carries server code to be set apart from one that only adds screens or
content, and to have to say yes to it in so many words, so that I never add
code that will run on the server without knowing it.

## Context

A bundle's server half runs only once `crombolo.config.ts` imports it and the
site is deployed (`docs/bundles.md`, Part 3). Installing one does not put it in
the request path. But once wired it is ordinary code in the server process,
with everything the process can reach: the database, the files and the media,
and the secrets in the environment. No sandbox stands between them.

Today the Marketplace:
- tags such a bundle "Server features", in the same style as "Screens" and
  "Content";
- installs it with one click on **Install**, with no confirmation, and the
  server does not ask either (`marketplace.ts`, `install`);
- mentions the server half in one sentence of the success notice, after the
  fact.

Two related gaps:
- **Install scripts.** The install runs `bun add <package>` without
  `--ignore-scripts`. Bun blocks dependencies' install scripts by default, but
  a package on its built-in trusted list, or in the site's
  `trustedDependencies`, still runs them.
- **Screens are code too.** A bundle's back-office screens are JavaScript that
  runs in every editor's browser with their session, administrators included.
  This is milder than server code, but it is still third-party code, and
  nothing says so.

## Acceptance criteria

- [x] **Set apart in the listing.** A bundle with a server half shows a
      warning tag ("Runs code on the server"), unlike the neutral tags for
      screens and content, on the Marketplace and in Installed.
- [x] **An explicit yes.** Installing such a bundle opens a panel in its card,
      which:
      - says, in plain words, that once the site's developers turn it on its
        code runs on the server with access to the site's data, files and
        settings;
      - names the publisher, with links to the package and its source;
      - has an unticked confirmation ("I trust this publisher with the site's
        server");
      - has an install button that stays disabled until it is ticked.
      Cancelling installs nothing.
- [x] **The server enforces it.** `install` refuses a package whose manifest
      declares `server` unless the request carries `acceptServerCode: true`,
      and says why. It checks the registry's manifest before installing, and
      the installed package's manifest again after, so a version that gained a
      server half meanwhile is caught and removed. Neither the screen nor an API
      caller can skip it.
- [x] **Recorded.** The audit log records who accepted server code, for which
      package and version.
- [x] **Screens are named for what they are.** Installing any third-party bundle
      says once, in the existing notice area, that its screens run in editors'
      browsers. There is no extra click for bundles without server code.
- [x] **No install scripts.** `bunInstaller` runs `bun add --ignore-scripts`.
- [x] **Wording in the UI is for the person installing.** It speaks of code
      running on the server and access to the site's data, files and settings,
      not of `crombolo.config.ts` or capabilities. Those stay in the docs.
- [x] **Tests:**
      - refused without `acceptServerCode`;
      - accepted with it, and audited;
      - a server half that appears in the installed version but not the listed
        one is caught, and the package is removed;
      - a bundle with screens only installs as before;
      - `--ignore-scripts` is passed.
- [x] **Docs.** `docs/bundles.md`, "Runtime install", says what the
      confirmation covers and that the server enforces it.

## Decided (2026-10-28)

- **The yes is an inline panel in the card,** not a modal. Umbraco's standard
  confirm dialog cannot hold the checkbox, and a modal of our own is more UI
  to keep than this needs.
- **There is no update path to cover.** Installed offers only Uninstall. A
  newer version arrives by a deploy, or by installing again from the
  Marketplace, which goes through the same check.

## Plan (2026-10-28)

1. **The manifest of the version being installed**
   (`server/src/marketplace.ts`).
   - `declares(name)` becomes `declaresAt(name, version?)`: the packument's
     `versions[version ?? latest]`, read as the listing already reads it.
   - `install` calls it before `bun add`. A package that declares `server`
     without `acceptServerCode: true` is refused, with
     `{ ok: false, needsServerConsent: true, message }`, and nothing is
     installed.
   - A registry that cannot be read also refuses, because what the package
     carries cannot be checked.
2. **The check after install.**
   - Once `bun add` finishes, the installed package's own manifest
     (`found.carries.server`) is checked again.
   - If it has a server half that was not accepted, `bun remove` runs, the
     registry is invalidated, and the install is refused with what happened.
     This catches a `latest` that moved between the listing and the install.
3. **No install scripts.** The installer's command is a pure
   `installCommand(action, specifier)` that adds `--ignore-scripts` to `add`,
   so a test checks the arguments without spawning Bun.
4. **The route** (`server.ts`, `bundles/install`).
   - It passes `acceptServerCode` through.
   - On success it writes its own audit entry: `system` / `Install` /
     `Bundle`, with `entityName` as `name@version` and a detail of
     `accepted server code` when it was. Uninstall writes an entry the same
     way.
   - Both paths are left out of the generic plugin-write entry, so each
     install is recorded once, with its package.
5. **The Marketplace UI** (`plugin/bundles-marketplace.js`, `bundles-carries.js`,
   `bundles-client.js`).
   - The `server` tag becomes a warning-coloured "Runs code on the server", in
     Marketplace and Installed.
   - **Install** on a bundle with server code opens the panel:
     - "Once your site's developers turn it on, this bundle's code runs on
       the server, with access to the site's data, files and settings."
     - The publisher, and links to npm and the source.
     - An unticked "I trust this publisher with the site's server" box.
     - **Install server code**, disabled until the box is ticked, and
       **Cancel**.
   - `installBundle` sends `acceptServerCode`. A `needsServerConsent` answer
     from the server opens the panel too: the latest version may have gained
     a server half since the listing was read.
   - Every successful third-party install adds one line to the notice: "Its
     screens run in the browser of everyone who uses the back office."
6. **Tests** (`tests/marketplace.test.ts`, with its stub installer and a fake
   registry, and the install route's test).
   - Refused without consent, with no `add` called.
   - Installed with consent, and the audit entry names the package and the
     consent.
   - A server half only in the installed version: `remove` is called, and the
     install is refused.
   - A registry that cannot be read: refused.
   - A bundle with screens only installs as before, with no consent asked.
   - `installCommand('add', …)` includes `--ignore-scripts`.
   - The UI panel is not unit-tested: the plugin has no harness for it. It is
     checked in the browser suite only if asked.
7. **Docs.** `docs/bundles.md`, "Runtime install": the consent, that the
   server enforces it before and after the install, the audit entry, and
   `--ignore-scripts`. The story's release note.

## Out of scope

- Sandboxing a server half (a separate process with an RPC for capabilities):
  its own story, if wanted.
- `bun add` run by a developer outside the back office, which `bundle check`
  and code review cover.

## As built (2026-10-28)

- **The checks** are in `server/src/marketplace.ts`.
  - `declaresAt(name, version?)` resolves an exact version, a dist-tag, the
    highest version a range admits, or the latest. It returns what that
    version carries, `not-a-bundle`, or `unreachable`.
  - `install` refuses the last two before `bun add`. A 404 from the registry
    counts as not a bundle.
  - `serverConsentNeeded()` is the refusal with `needsServerConsent`, used
    both before and after the install.
- **Beyond the plan:**
  - A package that is not a bundle is now refused before install. Before, it
    was installed, and the response said "not a valid bundle".
  - The success message no longer names `crombolo.config.ts`: it says "once
    your site's developers turn it on".
  - `SCREENS_NOTICE` is added only when the bundle has screens.
- **No install scripts.** `installCommand()` builds the argv, and
  `bunInstaller` spawns it.
- **The route** (`server.ts`, `bundles/install` and `uninstall`) writes its
  own audit entry, and `bundleInstallPaths` keeps the generic plugin-write
  entry from recording them twice.
- **The UI.** `bundles-carries.js` gives the server tag `look="primary"
  color="warning"`. `bundles-marketplace.js` holds the panel (`#consent`),
  which also opens on a `needsServerConsent` answer.
  `bundles-client.js#installBundle` sends `acceptServerCode`.
- **Tests** (`tests/marketplace.test.ts`):
  - refused without the yes, with nothing run;
  - installed with it;
  - a server half found only after install, then removed;
  - a range checked at the version it resolves to;
  - an unreachable registry;
  - a package that is not a bundle;
  - screens only, with the notice;
  - `installCommand`;
  - the endpoint's refusal, with no entry written;
  - an uninstall recorded once by name.

  The successful-install entry, `accepted server code`, is not exercised end
  to end, because that would need a real `bun add` from a registry that serves
  tarballs. The panel itself is browser-only.
