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
- **Nothing restarts but `crombolo restart [--remote]`.** Install, uninstall,
  apply and revert install code and leave it not yet live, saying so, so a
  script can make several changes and restart once. Until a restart, status
  and Settings → Bundles say code is waiting for one.
- **Any administrator may restart** (on a remote, at level `all`): a
  supervised restart is not an outage, and the code it makes live needed
  InstallCode to get there.
- **Grants are named, not blanket:** `--grant` lists every permission the
  bundle asks for. A version that asks for more than was named is refused, so a
  script never grants something new without a change to the script.

## Acceptance criteria

- [ ] `crombolo bundle list [--remote]`: installed bundles, their version,
      whether their server features are on, what was granted and by whom, and
      whether code is waiting for a restart
- [ ] `crombolo bundle install <name[@version] | file.tgz> [--grant <what>…]
      [--apply-content] [--remote]` adds a bundle as a dependency; a bundle
      with server code needs every permission it asks for named, and installs
      nothing otherwise
- [ ] `bundle install <site-bundle> --code-into <dir>` does what
      `bundle install-code` did; `install-code` is gone
- [ ] `bundle uninstall <name> [--remote]`, `bundle disable|enable <name>
      [--remote]`, with the back office's refusals
- [ ] `bundle apply` installs the code a bundle carries, where runtime installs
      are on, needing level `all`, ApplyStructure and InstallCode; refused
      before anything is written otherwise. Its run backs up the code,
      package.json and bun.lock it replaces, and `bundle revert` restores and
      reinstalls them
- [ ] `Crombolo.Remote.InstallCode` ("Install code on this site"): held only
      by explicit grant, administrators included; offered in group editing and
      CI trust rules; granting audited; a status check names who holds it
- [ ] `crombolo start` supervises the server as a child; `crombolo restart
      [--remote]`, administrators only, starts a new one, switches once it is
      healthy and stops the old; a new one that fails leaves the old serving
      and says why
- [ ] Nothing else restarts; each command that installs code says it is not
      live until `crombolo restart`
- [ ] Remote endpoints and capabilities documented in docs/remote-protocol.md;
      docs/bundles.md and story 192's rule updated
- [ ] Idempotent, `--dry-run`, `-o json`, audited
- [ ] Tests on SQLite and Postgres, including an administrator refused
      InstallCode until granted, and a failed restart leaving the old server
