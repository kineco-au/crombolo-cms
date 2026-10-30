# 222 — Bundles ask for permissions

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** L
**Depends on:** 063, 194

## Story

As a site administrator, I want a bundle to say which of the site's powers it
needs, such as reading members or writing media for them, and to grant or
refuse each before it is installed, so that installing a bundle is a decision
about what it may do and not only whether its publisher is trusted.

## Context

Today two things stand in for permissions, and neither is one:

- **Capabilities** (`ServerBundle.capabilities`, `docs/bundles.md` Part 3) are
  what a bundle's code asks for. Each is an interface core owns, and a handler
  sees only what it declared, but nobody grants them: the code declares, and
  it gets.
- **The yes at install** (story 194) is one question about the whole bundle:
  "I trust this publisher with the site's server". It names no power.

Raised while planning 187 (decision 4). A site's import writes each record's
photographs as the member who made it, and its nightly export reads every one
of hundreds of thousands of members. A job acts for nobody, so both need a power
a public route does not have. Giving jobs a system identity instead would let
a bundle do in a job what its own routes may not.

The site's own code needs no grants: it is the site, reviewed and deployed by
its developers.

## Proposed shape

- **Declared in the package, readable before install:**
  `"crombolo": { "permissions": ["members.read", "members.write", "media.forMembers"] }`
  in `package.json`, read from the registry's manifest as 194's check is.
- **Shown in plain words** in the install panel ("Read members' names, e-mail
  addresses and details"), each granted or refused by the administrator.
- **Granted per site, stored and audited:** who granted what, to which package
  and version. Reviewed and withdrawn from the bundle's card in Installed.
- **Enforced at the capability:** one that needs a permission refuses without
  the grant, naming the permission, so a bundle added with `bun add` and wired
  by hand needs a grant too.
- **An upgrade that asks for more waits** for an administrator to approve the
  new list (decision 3).

## Decisions (2026-10-30)

1. **One model: every capability that reaches the site's data is a
   permission.** The package's manifest lists them (`redirects.write`,
   `documents.read`, `identityProviders.read`, `media.write`, `member.delegate`,
   `members.read`, …), and the administrator sees and grants the whole list.
   - The code's `capabilities` must match what the manifest declares, checked
     at boot as a bundle's declared migrations are: a bundle cannot use more
     than it asked for and was granted.
   - `log` and a bundle's own `database` are not permissions: neither reaches
     the site's data.
   - **No backwards compatibility.** The bundle format moves to its next schema
     version: a package with a server half must declare `permissions`, and one
     written for an earlier schema is refused, naming the change, as 0.37's
     route handlers were. Simple Redirects and Entra are updated with it.
   - Not chosen: permissions only for powers beyond a public route, which
     would show an administrator part of what a bundle can do, under two models.

2. **The vocabulary is `area.read` and `area.write`, split where a capability
   does both.**

   | Permission | Allows | From |
   |---|---|---|
   | `redirects.read` | list and look up redirect rules | `redirects` |
   | `redirects.write` | save, replace and remove the rules it may edit | `redirects` |
   | `documents.read` | a page's address | `documents` |
   | `identityProviders.read` | the providers and their settings, never a secret | `identityProviders` |
   | `identityProviders.write` | an administrator's overrides of those settings | `identityProviders` |
   | `media.read` | read media in its declared folders | `media` |
   | `media.write` | create and update media in its declared folders | `media` |
   | `member.delegate` | act as the signed-in member calling its route: what it writes is theirs, checked against their access | `media` |
   | `media.forMembers` | create media in its declared folders for a member it names, from a job | new, with 187 |
   | `members.read` | members' names, e-mail addresses, groups and properties, one or paged through all | new, with 207 |
   | `members.write` | change those details and groups; never a password or a sign-in | new, with 207 |

   - A reporting bundle can read redirects without being able to rewrite them.
   - `media.forMembers` and the `members` permissions are named now and arrive
     with the work that needs them; a manifest naming one this release does not
     know is refused.
   - Each has a plain sentence for the install panel, kept beside its name.
   - **Acting for the caller is its own permission,** `member.delegate`, not
     part of each area: today's `media` capability, which writes as the member
     who called, needs `media.write` and `member.delegate`. Whatever later acts
     for the caller (207's members) needs it too, so an administrator sees once
     that a bundle acts on members' behalf.
   - Not chosen: one permission per capability, which gives a bundle that only
     reads the power to write, and hides the difference from the administrator.

3. **All or nothing.** The administrator grants a bundle's whole list, or the
   bundle is not turned on.
   - At install it is one decision over the full list: proceed, or cancel.
   - A bundle never runs with some of its permissions refused, so its author
     need not code for every combination, and a capability's refusal only ever
     means something is wrong.
   - Withdrawing a grant turns the bundle off: its routes, jobs and screens
     stop, saying it needs its permissions approved; granting again turns it on.
   - An upgrade that asks for more does not run until the new list is
     approved. The bundle is off meanwhile, and its card says why.
   - Not chosen: a tick box per permission, which would have every bundle cope
     with any permission missing, and fail at run time when one did not.

4. **Grants live in a core table, granted by whoever may install bundles.**
   - A grant records the bundle, the package version, its permission list, who
     granted it and when, and is audited as 194's yes is.
   - Those with access to the Packages section, the people 194 lets accept
     server code, grant and withdraw, in the install panel and on the bundle's
     card in Installed, and nowhere else.
   - Per environment, in its own database: a staging grant says nothing about
     production, and grants do not travel in a site's export or a pull.
   - Never in `crombolo.config.ts` or the repository: a developer cannot grant a
     bundle by committing a file.
   - Not chosen: grants in the config, made in a commit, which would leave the
     people running the site no say in what a bundle may do.

5. **A bundle added in code is off until an administrator grants it, in every
   environment.**
   - The site boots with the bundle mounted and turned off: its routes answer
     that it is waiting for its permissions, and its jobs do not run.
   - The boot log and the Installed view say so; the bundle's card lists its
     permissions with a Grant button, the same panel an install shows.
   - For pipelines and fresh environments, `crombolo bundle grant <id>` grants
     its current list as an operator of that environment, audited as a grant
     in the back office is. It needs that site's credentials, never a
     committed file.
   - A template's first local run says its bundles need granting, and how;
     `bun start` grants nothing by itself.
   - Not chosen: granting automatically in development, which would leave a
     bundle's permissions unreviewed until production, and grant silently on a
     staging site run in development mode.

## Acceptance criteria

- [x] The bundle format moves to its next schema version: a package with a
      server half declares `permissions` from the vocabulary, and one written
      for an earlier schema, or naming a permission this release does not know,
      is refused by name.
- [x] A bundle's `capabilities` match its declared permissions, checked at
      boot; `log` and its own `database` need none.
- [x] Each capability checks its permission: `redirects`, `documents`,
      `identityProviders` and `media` split as decision 2 says, and acting as
      the calling member needs `member.delegate`.
- [x] Installing a bundle lists every permission in plain words before anything
      is installed; the administrator grants the whole list or cancels.
- [x] Grants are kept per environment in core, audited, shown on the bundle's
      card in Installed, and withdrawn there; withdrawing turns the bundle off.
- [x] A bundle with no grant, or a version asking for more than was granted, is
      mounted but off: its routes say so, its jobs do not run, and the boot log
      and its card say what is waiting.
- [x] `crombolo bundle grant <id>` grants a bundle's list as an operator, audited.
- [x] Grants do not travel in an export or a pull.
- [x] Simple Redirects and Entra declare their permissions, and the templates
      that wire them say on first run how to grant them.
- [x] The UI speaks of what a bundle may do, not of capabilities or manifests.
- [x] `docs/bundles.md` documents the permissions, the grant, the checks and the
      schema change; the release notes carry the upgrade note.

## What was built

- **The vocabulary** (`packages/backoffice-host/src/bundle-permissions.ts`):
  `BUNDLE_PERMISSIONS`, each with its sentence, `describePermissions` and
  `permissionsProblem`. `BUNDLE_SCHEMA_VERSION` is 3; `validateBundlePackage`
  requires `crombolo.permissions` of a server half and refuses an unknown or
  repeated one, and `schemaProblem` names what each older schema must change.
- **Grants** (`packages/data/src/schema/bundle-grants.ts`, migration 054,
  `AddBundleGrants`; `repositories/bundle-grants.ts`): one row per bundle,
  replaced on a grant, deleted on withdrawal. Its `release` is the current
  version until the release that ships it sets its own.
- **The server** (`packages/server/src/bundle-grants.ts`):
  `CAPABILITY_PERMISSIONS` and the method table; `permissionProblems`, checked
  in `validateServerBundles`; `gated`, which wraps each capability so a method
  without its permission throws `PermissionRefusedError`; `createBundleGrants`,
  which reads the grants at boot and at most every five seconds after (another
  node's grant), and at once after one made here; `grantableBundle` and
  `grantBundle` for the command line.
- **Off means off:** `createServerBundles` takes `isOn`, and a bundle that is
  off answers its site and back-office routes with a 503 saying it is waiting;
  the webhook service does not deliver its events; the manifest port leaves its
  screens out; boot logs it; `ServerHandle.waitingBundles()` lists it and the
  `crombolo start` banner says how to approve it.
- **Install and Installed:** the install refuses server code unless the request
  says yes and grants exactly the declared list, records the grant against the
  version that landed, and audits it; `POST …/api/bundles/grant` and
  `…/withdraw`, gated on the Packages section and audited; the consent panel
  lists what a bundle asks to do; the Installed card shows it, with **Approve
  and turn on** and **Withdraw approval**.
- **`crombolo bundle grant <id>`**, as an operator, audited.
- **Simple Redirects** asks for `redirects.read`, `redirects.write` and
  `documents.read`; **Microsoft Entra** for `identityProviders.read` and
  `identityProviders.write`.
- **Tests:** `tests/bundle-permissions.test.ts` (the manifest, capabilities
  against permissions, gated methods, grants and an upgrade asking for more on
  both engines, a wired bundle off then granted then withdrawn with its screens
  and audit, the command line); `tests/marketplace.test.ts` (the install panel's
  permissions and an exact grant). The harness grants wired bundles unless a
  test says `ungranted`, and the test fixtures moved to schema 3.
- **Not built:** a bundle's form field and workflow types and the middleware a
  site lists from it still run while it is off: they are the site's own
  choices, wired in its config, and reach no capability.
