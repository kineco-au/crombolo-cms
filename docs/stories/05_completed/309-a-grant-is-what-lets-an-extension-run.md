# 309 — A grant is what lets an extension run

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** 308

## Story

As someone who granted an extension some permissions, I want it to run only with
exactly those, for the version I granted, so that an upgrade cannot quietly give
itself more.

## Context

The grant is recorded in `bundle_grant` with the version and the permissions. But
nothing reads it while the extension runs:
- `gated()` checks the package's own declaration;
- `isOn` checks only "present and not disabled";
- `member.delegate` is checked at boot and never again;
- a turned-off extension's screen files are still served.

See `extension-threat-model.md`, T3, T4, T9, T10.

## Decisions (2026-11-09)

- **The site's config grants:** an extension wired in `crombolo.config.ts` (and after
  story 310, listed in its `extensions`) is granted what its installed version asks
  for at boot, audited as the site's code.
  - Installed, `bundle list` and the install panel show it as **Developer
    installed**, not with an administrator's name.
- **No grant is carried over:** an extension installed before this release with no
  grant on record is off until someone grants it.
  - Simple Redirects and Entra move to schema 4 first (story 308), so a site that
    wires them is granted by its config on the first boot, and stays on.
  - Every other extension needs its site to grant it, or a version and a config
    that do. The release notes say so.
- **Fewer permissions stay on:** a version that asks for less than was granted keeps
  running. The grant is narrowed to what it asks for, and the narrowing is audited.

## The design

- **On means granted.** An extension runs while all of these hold:
  - it is installed and not turned off;
  - its grant covers what the installed version asks for: every permission, every
    `http.outbound` origin, and the `actAs` choice;
  - and, for one with a server half, it is wired.
- **When it does not:**
  - A version that asks for more, or different, is off: "waiting for a grant". The
    Installed view shows what it now asks for beside what was granted.
  - One that asks for less is narrowed, and stays on.
- **Every extension needs a grant,** screens-only ones included: their grant is of
  nothing, recorded when they are installed. One with no grant is off.
- **Every call is checked against the grant,** not the manifest: `gated()` reads the
  granted set. `log` and the extension's own tables stay ungated.
- **`member.delegate`** is checked on every call made as a member: media today, and
  each area story 308 adds.
- **Off is off everywhere:**
  - its routes answer 503, as now;
  - its events fail without retrying, its jobs wait, and its templates render
    nothing (story 312);
  - its screens leave the manifest, and their files are no longer served
    (`server.ts`, the extension file route).
- **Granting:**
  - **Who:** an administrator; over a remote, someone holding "Install code on this
    site".
  - **Where:** the Installed view's **Grant** button, which shows the permissions,
    the reasons and the `actAs` choice. Or the CLI's new
    `crombolo bundle grant <name> [--remote …] --grant … [--act-as …]`, or the
    remote's `bundle-manage`.
  - **Install and grant at once:** a Marketplace install grants what the panel
    showed, as now.
- **Who granted it:** the grant records who: a user, "the site's code", or a CI
  rule. Installed shows "Developer installed" for the site's code, and the
  administrator's name otherwise.

## Implementation plan

1. **The grant** (`bundle-grants.ts`):
   - `isOn` requires a grant covering the installed version, by `grantCovers`;
     `stateOf` says which of "on", "turned off", "waiting for a grant" or
     "not granted" it is.
   - A narrowing when the version asks for less.
   - `gated()` takes the granted set.
2. **The boot** (`core.ts`): the config's grant as now, and nothing granted
   otherwise. A wired extension that is not granted is not mounted, with a warning
   naming what it waits for.
3. **Files:** the extension file route serves only the files of extensions that are
   on.
4. **`member.delegate`** checked per call, in `contextFor`.
5. **Granting:** a `grant` action on the bundle admin, the remote's
   `bundle-manage/installed/<name>/grant`, the CLI's `bundle grant`, and the
   Installed view's Grant panel, which reuses the install panel's permission list.
6. **Words:** "Developer installed", "Waiting for a grant: it now asks for …", and
   "Not granted".
7. **Docs:** `bundles.md` "Permissions"; release notes, as a breaking change for
   extensions installed without a grant.

## Tests

- **No grant:** an extension without a grant is off, its files 404 and its routes
  answer 503. Granting it turns it on.
- **More:** a version that asks for one more permission, or one more origin, is
  off, and the state names the difference. Granting it turns it on.
- **Less:** a version that asks for fewer stays on, the grant narrowed and audited.
- **Per call:** a call needing a permission the grant lacks is refused, even with the
  manifest declaring it. A media call as a member without `member.delegate` is
  refused.
- **The config:** a wired extension is granted at boot and listed as Developer
  installed. Simple Redirects runs after the upgrade with no administrator acting.

## Implemented (0.57.0)

- `bundle-grants.ts`:
  - `grantGaps` names what a grant leaves out.
  - `state()` answers `on`, `off`, `waiting` or `not-granted`, with `missing`.
  - `isOn` requires a grant covering the installed version; `granted(id)` is what
    the capabilities and `api` use.
  - `narrow` narrows a grant for a version that asks for less.
  - A schema 3 grant's `documents.read` counts as `content.read`.
- **A grant on record:** the row `disable` keeps for an extension never granted
  carries an epoch `granted_at`, so `BundleGrant.recorded` tells it from a grant.
- **Boot** (`core.ts`): the config's grant as before; a wired extension waiting for
  a grant is warned about; every installed extension's grant is narrowed where it
  can be.
- **Off everywhere:** `onExtensions` in `server.ts` filters the manifests, the
  import map and the extension file route by `isOn`.
- **Calls:** `contextFor` takes `options.granted`, and a member calling `media`
  without `member.delegate` is refused.
- **Granting:**
  - `BundleAdmin.grant` refuses anything but the exact list, and `actAs` without a
    choice;
  - the back office's `bundles/grant`, administrators only; the remote's
    `installed/<name>/grant`, with InstallCode;
  - `crombolo bundle grant`;
  - the Installed view's status line and Grant button, with the `actAs` choice;
    "Developer installed" for the site's code.
- **Tests:** `tests/extension-grants.test.ts`; existing tests now grant what they
  install.

## Acceptance criteria

- [x] An extension with no grant does not run, and nor do its screens or files.
- [x] A version asking for one more permission is off until granted, and the view
      shows the difference.
- [x] A call needing a permission the grant lacks is refused, even when the manifest
      declares it.
- [x] A media call as a member needs `member.delegate`.
- [x] An extension wired in the config is granted by it and shown as Developer
      installed. One installed before this release, and not wired, is off until
      granted.
- [x] A version asking for less stays on, its grant narrowed.
