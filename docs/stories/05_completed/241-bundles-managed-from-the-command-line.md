# 241 — Bundles managed from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** L
**Depends on:** 160, 167

## Story

As an administrator setting a site up from a script, I want to install a
bundle with the permissions it asks for, and to list, turn off, turn on and
uninstall installed bundles, so that a bundle's server features never need a
click in Settings → Bundles.

## Context

Found 2026-11-02, reviewing the CLI's gaps. The CLI builds, exports, applies,
checks and purges bundles, but the installed-bundle screen's actions are
buttons only (`bundles-client.js`):
- installing from the Marketplace, with `acceptServerCode` and the `grant`
  list of what its server code may do;
- disabling and enabling a bundle's server features (story 225);
- uninstalling one.

`bundle apply` installs a bundle's content and structure but grants nothing:
a bundle whose server features need approval stays off until someone approves
them in the back office.

## Decisions (planning, 2026-11-02)

- **`install` and `apply` stay distinct.** `bundle install` adds a bundle as a
  dependency (`bun add`, what the Marketplace's Install does), recorded as
  installed with its grant. `bundle apply` writes a bundle's content and
  structure as a run that can be reverted.
- **`bundle install-code` folds into `bundle install`:** a host's step becomes
  `bundle install <site-bundle> --code-into <dir>`. No alias is kept.
- **Applies install code.** This reverses story 192's rule that an import never
  installs code. A bundle that carries code needs
  `CROMBOLO_REMOTE_ACCESS=all`, ApplyStructure and a new permission.
- **"Install code on this site" (`Crombolo.Remote.InstallCode`)** is the one
  permission administrators do not hold by default: it is checked against
  explicit grants only, for administrators too, and no migration grants it.
  An administrator grants it to a group they are in, or one made for it;
  granting and removing it are audited. A person gets it through a group, as
  every permission is held. The back office advises a group of its own rather
  than the Administrators group, which also holds an unattended install's API
  client. A status check names who holds it.
- **CI may hold it** when its trust rule names it, never by default; adding it
  to a rule is audited.
- **Only where runtime installs are on** (`CROMBOLO_RUNTIME_INSTALLS`): elsewhere
  a bundle carrying code is refused before anything is written, saying to
  deploy the code, or giving `CROMBOLO_INSTALLS_ELSEWHERE_MESSAGE`.
- **`crombolo start` supervises:** it runs the server as a child it owns. A
  restart starts a new child, waits for `/health`, switches traffic, then stops
  the old one; a child that fails to boot leaves the old one serving, and the
  code is reported as not live.
- **Revert puts the code back:** a run backs up the code, package.json and
  bun.lock it replaces; revert restores them, reinstalls from the restored
  bun.lock, needing what the apply needed.
- **`bundle install` and `uninstall` take `--remote`**, under the same gates.
- **Nothing restarts but `crombolo restart [--remote]` and `bundle deploy`.**
  Install, uninstall, apply and revert install code and leave it not yet live,
  saying so, so a script can make several changes and restart once. Until a restart, status
  and Settings → Bundles say code is waiting for one.
- **Any administrator may restart** (on a remote, at level `all`): a
  supervised restart is not an outage, and the code it makes live needed
  InstallCode to get there.
- **`bundle install --wire` turns a bundle's server code on locally:** it adds
  the import and the `bundles: [...]` entry to `crombolo.config.ts`. A code
  change to commit and review, so it is refused with `--remote`: on a remote,
  server code is only ever turned on by a reviewed change arriving by apply.
- **A structural bundle always carries `package.json`, `bun.lock` and
  `crombolo.config.ts`,** whether or not the site names code of its own, so a
  site with none can still send a new dependency and its import.
- **`bundle deploy --remote <name>` runs the whole deploy from here:** it
  refuses a site directory with uncommitted changes, builds the bundle with its
  structure and code, applies it on the remote (showing the dry run and
  stopping on anything outstanding unless `--yes`), restarts the remote and
  waits for the new server to be healthy, then reports the run. A new server
  that fails leaves the old one serving and prints the `bundle revert` that
  undoes it. `--no-restart` stops after the apply. It does not install or wire:
  `bundle install --wire`, a commit, then `bundle deploy`. It is the one-line
  CI deploy, for a trust rule that names InstallCode.
- **Grants are named, not blanket:** `--grant` lists every permission the
  bundle asks for. A version that asks for more than was named is refused, so a
  script never grants something new without a change to the script.

## Acceptance criteria

- [x] `crombolo bundle list [--remote]`: installed bundles, their version,
      whether their server features are on, what was granted and by whom, and
      whether code is waiting for a restart
- [x] `crombolo bundle install <name[@version] | file.tgz> [--grant <what>…]
      [--apply-content] [--remote]` adds a bundle as a dependency; a bundle
      with server code needs every permission it asks for named, and installs
      nothing otherwise
- [x] `bundle install <site-bundle> --code-into <dir>` does what
      `bundle install-code` did; `install-code` is gone
- [x] `bundle uninstall <name> [--remote]`, `bundle disable|enable <name>
      [--remote]`, with the back office's refusals
- [x] `bundle apply` installs the code a bundle carries, where runtime installs
      are on, needing level `all`, ApplyStructure and InstallCode; refused
      before anything is written otherwise. Its run backs up the code,
      package.json and bun.lock it replaces, and `bundle revert` restores and
      reinstalls them
- [x] `Crombolo.Remote.InstallCode` ("Install code on this site"): held only
      by explicit grant, administrators included; offered in group editing and
      CI trust rules; granting audited; a status check names who holds it
- [x] `crombolo start` supervises the server as a child; `crombolo restart
      [--remote]`, administrators only, starts a new one, switches once it is
      healthy and stops the old; a new one that fails leaves the old serving
      and says why
- [x] Nothing else restarts but `bundle deploy`; each command that installs
      code says it is not live until `crombolo restart`
- [x] `bundle install --wire` adds the import and the `bundles` entry to
      `crombolo.config.ts`, idempotently; refused with `--remote`
- [x] `bundle apply --structure` always carries `package.json`, `bun.lock` and
      `crombolo.config.ts`
- [x] `bundle deploy --remote <name> [--yes] [--no-restart]`: refuses
      uncommitted changes, builds, dry-runs, applies, restarts and waits for
      health; a failed restart names the revert
- [x] Remote endpoints and capabilities documented in docs/remote-protocol.md;
      docs/bundles.md and story 192's rule updated
- [x] Idempotent, `--dry-run`, `-o json`, audited
- [x] Tests on SQLite and Postgres, including an administrator refused
      InstallCode until granted, and a failed restart leaving the old server

## Implementation (2026-11-02)

- **The permission.** `RemotePermissions.InstallCode` and `EXPLICIT_PERMISSIONS`
  (`core/src/permissions.ts`): `hasPermission` and the remote's `may()` give
  administrators everything but these. The admin group's seed leaves it out;
  no migration grants it. Offered in group editing (`umbraco-package.json`),
  CI access (`ci-access-words.js`) and `remote trust add --may install-code`.
- **Code from an apply.** `server/src/bundle-code-install.ts`: `planCode`,
  `installCode` (files to site paths, originals kept under the run as `code/`
  with `code.json`, `bun install --frozen-lockfile --ignore-scripts` when
  `package.json` or `bun.lock` changed) and `revertCode`, called from
  `installBundleContent` (input `installCode`) and `revertSections`. The CLI's
  local apply asks for it; `start --bundle` and the Changes dashboard do not.
  `bundle-build.ts` carries `package.json`, `bun.lock` and `crombolo.config.ts`
  once the site has a lockfile.
- **Remote apply** (`remote.ts`): `forbidden-code`, `installs-elsewhere`,
  `replaceFiles`, the answer's `code`; reverting a run that installed code
  needs InstallCode.
- **Installed bundles.** `server/src/bundle-admin.ts`, shared by Settings →
  Bundles and the remote's `bundle-manage` endpoints
  (`environments/{env}/installed…`); `localBundleAdmin` for the CLI on its own
  machine. `marketplace.ts` gained `installFile` and `inspect`. CLI:
  `bundle list|install|uninstall|disable|enable`; `install --wire`
  (`support/wire.ts`), `--code-into` (in place of `install-code`), exact
  `--grant`.
- **Restarts.** `cli/src/support/supervise.ts`: `crombolo start` runs the server
  as a child over IPC, children listen with `reusePort`, a restart's child boots
  fully before listening and must be ready in 120 s, the old one stops a second
  after. SIGHUP restarts; `.crombolo/supervisor.json` and `restart.json`.
  `crombolo restart [--remote]`; `POST <api>/environments/{env}/restart`
  (capability `restart`, level `all`, administrators, CI with InstallCode).
  `server/src/restart-pending.ts` marks installed code; a child that boots
  clears it.
- **Deploy.** `cli/src/commands/bundle/deploy.ts`: refuses uncommitted
  changes (and no git), packs once, dry-runs, confirms unless `--yes`,
  applies with `replaceFiles`, restarts through `restartRemote`.
- **Seen.** Health check "Installing code" (Site group) names the groups, their
  member counts and CI rules holding it, and warns while a restart is pending;
  Settings → Bundles → Installed says so too.
- **Tests:** `tests/install-code.test.ts`, the story-241 block in
  `tests/remote-apply.test.ts`, `tests/bundle-manage.test.ts`,
  `tests/remote-restart.test.ts`, `tests/integration/restart.integration.ts`,
  and additions to `cli.test.ts`, `bundle-code.test.ts`, `remote.test.ts`.
- **Docs:** `docs/bundles.md` (the security story's guarded route, apply
  installing code, the CLI), `docs/remote-protocol.md` (`bundle-manage`,
  `restart`, code on apply, InstallCode), `docs/operations.md` (Restarting),
  the product site's remotes guide (Deploying a site), release notes.
