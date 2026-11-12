# 336 — A bundle's components are installed as code

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** —

## Story

As a site administrator, I want a bundle's components held to the same consent as its
code, so that someone allowed to change the site's structure can't run code on the
server by sending a template.

## Context

A component is a `.tsx` module the server imports and runs in its own process
(`components.ts:159`). It is code, as much as anything in a bundle's `code/`.

A bundle's `components/` section is written with the other file sections
(`FILE_SECTIONS`, `bundle-sections.ts:122`): styles, scripts and `public/`. So:
- **Remotely** it needs `Crombolo.Remote.ApplyStructure` and the access level `all`
  (`remote.ts:733`), but not `InstallCode`. A revert of a run that changed
  components needs only ApplyStructure too (`remote.ts:1043`), and a whole-site
  push needs only ApplyStructure (`remote.ts:1514`).
- **In the back office,** Settings › Transfer installs an uploaded bundle with no
  code consent (`transfer-dashboard.ts:179`). The only check is the Settings
  section (`server.ts:3089`). Its `code/` and migrations are already refused
  there, but its components are written. So any Settings user can run code on the
  server by uploading a template.
- **Locally,** `crombolo bundle install` always installs code (`installCode: true`,
  `cli/src/support/flags.ts:99`). That is the operator's shell, so nothing more is
  asked there.
- **Anywhere,** nothing checks `runtimeInstalls`, so a site that doesn't install
  code while it runs still takes a bundle's components.

Value migrations had the same gap, and story 300 closed it: they count as code
(`migrationChanges`, `bundle-install.ts:777`). Components are the last section that
runs on the server without the code rules.

An extension's components are already apart: they stay in its package and render in
its own process (story 312). This story is about a site bundle and a whole-site push.

## The design

Planned 2026-11-12. Templates only count as code: stylesheets and scripts stay
ordinary files under ApplyStructure, and story 337 gives the back office's editing
of them a switch.

- **Templates count as code.** `componentChanges(config, carried)` in
  `bundle-sections.ts`, beside `migrationChanges`, lists the components an install
  would create or overwrite. They join the code wherever migrations do:
  - **Remotely:** `InstallCode` is needed, refused with 403 `forbidden-code`
    naming the files.
  - **Transfer dashboard:** the user needs "Install code on this site"
    (`Crombolo.Remote.InstallCode`) from a group. Administrators need it too,
    since being an administrator never gives it. Without it the install is
    refused, naming the templates.
  - **CLI:** installs as now, since it always installs code.
- **A site that doesn't install code while it runs** (`runtimeInstalls` off)
  refuses a bundle that changes templates, code or migrations. All three use one
  plain message: installing code while the site runs is turned off on this
  site. This replaces the host's `installsElsewhere` text for bundle installs;
  the Marketplace keeps using that text.
- **Reverting** a run that changed templates needs `InstallCode`, as one that
  installed code does.
- **A whole-site push** always needs `InstallCode` as well as ApplyStructure. The
  push is checked before it is uploaded, when what it would change isn't known.
- **What stays as it is:**
  - A template the bundle carries unchanged is not code being installed.
  - A bundle the site vouches for as its own (`vouchedBy === 'site'`) is exempt,
    as its migrations are.
  - `--no-files` still skips the section.
- **Wording.**
  - `ApplyStructure`'s description stops saying "and code".
  - `InstallCode`'s description, the remote docs, `bundles.md` and the threat
    model say templates are code.

## Acceptance criteria

- [x] A remote install of a bundle that adds or changes a template, by someone with
      `ApplyStructure` but not `InstallCode`, gets 403 `forbidden-code` naming each
      template, and nothing is written.
- [x] The Transfer dashboard refuses the same bundle for a user without "Install
      code on this site", naming the templates, and installs it for one with it.
- [x] `crombolo bundle install` installs it as now.
- [x] On a site with `runtimeInstalls` off, a bundle changing templates, code or
      migrations is refused with the plain message that installing code while the
      site runs is turned off.
- [x] A bundle whose templates are all unchanged installs without `InstallCode`.
- [x] A bundle the site vouches for as its own installs its templates as now.
- [x] Reverting a run that changed templates needs `InstallCode`.
- [x] A whole-site push needs `InstallCode`.
- [x] Stylesheets and scripts install as now.
- [x] `bundles.md`, `remote-protocol.md`, the threat model and the release notes
      say templates are code, and the upgrade notes say who now needs
      `InstallCode`.

## Implementation

- **The check** is `componentChanges(config, carried)` in `bundle-sections.ts`:
  the bundle's `components/` files whose target is missing or differs, compared as
  bytes.
- **Install** (`installBundleContent`, `bundle-install.ts`):
  - templates are refused unless `installTemplates` (default `installCode`) is
    set and `runtimeInstalls` is on;
  - the site's own content files (`vouchedBy: 'site'`) and `withoutFiles` skip
    the rule;
  - `RUNTIME_INSTALLS_OFF` is the one message for code, migrations and
    templates where installs are off.
- **Remote** (`remote.ts`):
  - `componentChanges` joins the code list, so a template needs `InstallCode`
    (403 `forbidden-code`, naming it in `items`);
  - `installs-elsewhere` answers with the plain message;
  - a revert needs `InstallCode` when the run swapped `components`;
  - a whole-site push, and the environment's `may.push`, need `InstallCode` as
    well as ApplyStructure. The push job then installs with `installTemplates`,
    because the request it runs for was already held to that.

  Installing a package as a dependency keeps the host's `installsElsewhere` text,
  as the Marketplace does.
- **Transfer dashboard:** `server.ts` passes
  `mayInstallCode: may(principal, InstallCode)`, and the dashboard installs with
  `installTemplates` set to it. A bundle's `code/` and migrations are still never
  installed from there.
- **Command line:** `contentImport` (`crombolo import`, `pull`, `site apply`,
  `start --from`) and the bundles `serve` installs at start-up pass
  `installTemplates: true`, as `bundle install` passes `installCode`. They are
  the operator's own shell.
- **Wording:** the permission labels and descriptions in `umbraco-package.json`,
  `ci-access-words.js` and `permissions.ts`.
- **Docs:** `remote-protocol.md`, `bundles.md`, `extension-threat-model.md` (T6)
  and the release notes.
- **Tests:**
  - `tests/bundle-install.test.ts`, "a site package's templates are code
    (story 336)": install, runtime installs off, unchanged, the dashboard,
    stylesheets and scripts, the site's own files and `withoutFiles`.
  - `tests/remote-apply.test.ts`, "templates are code (story 336)": remote
    install, revert, installs off, whole-site push.
  - The push tests give administrators `InstallCode` through
    `giveAdminsInstallCode` (`tests/support/harness.ts`).
