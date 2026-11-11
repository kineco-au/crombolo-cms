# 324 — The install panel says what you accept at a glance

**Epic:** I — Hardening · **Priority:** must · **Size:** L
**Depends on:** 308, 320, 325

## Story

As an administrator installing an extension, I want to see in one glance how far it can
reach, and the detail only when I ask, so that the decision is about what I am accepting
rather than about reading thirty permission sentences.

## Context

Story 308 made every permission a sentence with the author's reason. Story 320 added
`backoffice.code` under a warning. The catalogue is now over thirty entries, read as a flat
list, and the one that matters most, whether the extension's code runs in the back office
with the user's session, is one line among them.

## Decisions (2026-11-11)

- **Three levels, computed, never declared.** An extension asks for permissions as now; the
  level is what they add up to, from the highest thing in the list, so it cannot disagree
  with the detail and nothing new is stored:

  | Level | What puts it there | Under the badge |
  |---|---|---|
  | **Limited** | anything else | Works through the site with only the access below. You can see everything it does and undo it. |
  | **Acts as you** | `user.delegate` (story 325) | Can do anything on this site that the person using it can do. Everything it does is recorded against them. |
  | **Unrestricted** | `backoffice.code` | Runs its own code inside your back office, with the same access as the site's own code. Nothing it does there can be watched or limited. Only install this from a publisher you trust as you trust your own developers. |

  The words are Limited, Acts as you and Unrestricted (the maintainer's choice): the top one
  should sound like a risk, not a compliment.
- **Four groups, not thirty lines.** The panel folds the catalogue into Sees, Changes, Sends
  to and Adds, with Acts as when asked for. "Show each permission and why it asks" expands to
  today's list with the reasons. For Acts as you, Sees and Changes read "everything you can
  see" and "everything you can change". For Unrestricted the badge carries the warning and the
  groups follow it with no preface.
- **Who may grant.** An administrator installs and grants at every level (changed on
  2026-11-11 from Settings access for Limited, the maintainer's choice). Acts as you and
  Unrestricted need an administrator; anyone else sees "An administrator can turn this on."
  in place of the button. Revoking and removing stay open to Settings access.
- **Provenance is required for the upper two levels.** Without it the button reads "Nobody
  has vouched for who built this, so it can't be turned on here." A Limited extension without
  provenance installs, with "Nobody has vouched for who built this" shown in place of the build
  line, in the badge's colour.
- **Unrestricted can be granted from the back office or the config** (the maintainer's
  choice), as every grant can: an administrator's click is an audit entry naming them, the
  extension and the level. A host that wants the stricter rule sets
  `CROMBOLO_UNRESTRICTED_EXTENSIONS=config`, which puts the config snippet in place of the
  button. Off by default. (Planned on 2026-11-11 as `extensions.unrestricted`; moved to an
  environment setting because `extensions` in the config is a map of extension ids, and
  because it then sits with the other install policies, `CROMBOLO_BUNDLE_SIGNATURES` and
  `CROMBOLO_BUNDLE_SOURCES`, set per environment and not undone by the commit that grants.)
- **Never offered, whatever is asked:** `users.write`, as now, and two new keys the manifest
  reader rejects by name so an author sees why: `extensions.install` and `extensions.grant`.
  No extension may bring in another or widen a grant.
- **Installed shows the badge on every row**, and an upgrade that moves an extension up a
  level, or asks for anything new, is "Off · asks for more", with Review opening this panel
  under "This version asks for more".

## Decisions (2026-11-11, planning)

- **The config lock is an environment setting**, `CROMBOLO_UNRESTRICTED_EXTENSIONS`, `backoffice`
  (the default) or `config`, documented beside the signature settings in `configuration.md`.
- **A local build counts as vouched for**, everywhere: a package the signature check reports
  as `local` came from this machine, not a registry, and is trusted as the site's own code is.
  Signed and vouched count too. Unsigned, invalid and unchecked do not.
- **`actAs` is 325's to settle.** This story now depends on 325, so `user.delegate` exists
  when the levels are built and the panel never has to place the old `actAs` on its own.
- **The server says what the person may do.** The marketplace and installed listings carry
  `mayGrant: { limited: true, upper: 'yes' | 'administrator' | 'config' }` computed from the
  principal and the setting, so the panel renders the button, the sentence or the snippet
  from that and never reasons about administrators itself.
- **One refusal function for every path.** The panel, the API, the CLI and a remote all go
  through `bundle-admin`'s install and grant, so the check lives once, in a pure
  `grantRefusal` that each calls.

## The plan (2026-11-11)

What exists and is reused: the catalogue and `describePermissions` in
`packages/backoffice-host/src/bundle-permissions.ts`, where `BACKOFFICE_CODE_WARNING` and
`NEVER_OFFERED` already live; `grantStateOf` in `packages/server/src/marketplace.ts`, which
gives each listing row its permissions, status, `missing` and `granted`; `install` and
`grant` in `packages/server/src/bundle-admin.ts`, which every path calls and which audit with
`recordAudit`; `provenanceAt` and `provenanceOfInstalled` in `marketplace.ts`; the consent card
in `bundles-marketplace.js` and the permissions block in `bundles-installed.js`, with
`bundles-backoffice-code-words.js` as the model for pure, browser-free wording; the CLI's
`confirmBackOfficeCode` in `packages/cli/src/support/bundles.ts`; the extension API routes in
`server.ts`, already gated on Settings, with `actorOf` building the actor from the principal.

### Slice 1: levels and groups, pure

- `bundle-permissions.ts`: `levelOf(permissions): 'limited' | 'acts-as-you' | 'unrestricted'`
  (`backoffice.code` wins, then `user.delegate`, else limited); `groupsOf(declared)` folding
  the catalogue into Sees, Changes, Sends to, Adds and Acts as, each a short list of plain
  words (pages, media, members, forms, …; the origins for Sends to; routes, events, tables,
  templates and screens for Adds); `LEVEL_WORDS` with the badge word and the sentence per level;
  `NEVER_OFFERED` gains `extensions.install` and `extensions.grant`, and `readPermissions`
  names each when refused, as it names `users.write`; `BACKOFFICE_CODE_WARNING` becomes the
  Unrestricted sentence.
- `bundles-level-words.js` in the plugin: the same words for the element, pure, tested like
  `backoffice-code-words.test.ts`. The server sends `level` and `groups` on each row, so the
  element needs no catalogue of its own.
- `BundleActor` gains `isAdmin`; `actorOf` fills it from the principal; the CLI's actor is an
  administrator; the remote's actor follows its principal.

### Slice 2: the server

- `packages/server/src/grant-policy.ts`: `grantRefusal({ level, actor, provenance,
  unrestrictedFrom })` returns a message or nothing: an upper level from a non-administrator,
  "An administrator can turn this on."; an upper level with provenance unsigned, invalid or
  unchecked, "Nobody has vouched for who built this, so it can't be turned on here."; the
  unrestricted level from a request when the setting is `config`, the snippet sentence. Pure,
  tested.
- `config.ts`: `unrestrictedExtensions: 'backoffice' | 'config'` from
  `CROMBOLO_UNRESTRICTED_EXTENSIONS`.
- `bundle-admin.ts` `install` and `grant`, and `marketplace.ts`'s registry and file installs,
  call `grantRefusal` after consent and the signature check, with the provenance already in
  hand, and answer 403 with its message. The audit detail names the level: "granted
  Unrestricted: backoffice.code, content.read".
- `grantStateOf` adds `level`, `grantedLevel` (from the recorded grant's permissions) and
  `groups`; the listings add `mayGrant`. `status: 'waiting'` with `level` above
  `grantedLevel` is what Installed reads as "asks for more", with the new level named.
- `server.ts`'s marketplace and installed responses carry `mayGrant` and
  `unrestrictedExtensions`.

### Slice 3: the panel and Installed

- `bundles-marketplace.js` `#consent`: the badge and its sentence first, in the level's colour;
  the provenance line, or "Nobody has vouched for who built this" in the badge's colour when
  Limited and unsigned; the four groups as four lines, with Acts as when asked; "Show each
  permission and why it asks" expanding to today's list with reasons and origins; then the
  settings and layout choices as now. The button follows `mayGrant`: Grant and install, the
  administrator sentence, or the config snippet with the `extensions` entry filled in. The
  trust checkbox stays; the separate back-office code block and its second checkbox go,
  since the Unrestricted badge carries that warning.
- `bundles-installed.js`: the badge on every row's status line; `#permissions` reuses the
  same block; a waiting row says "Off · asks for more" with Review opening the block under
  "This version asks for more", naming the new level when it moved.
- `bundles-backoffice-code.js` and its words module are retired once nothing imports them.

### Slice 4: the CLI and the remote

- `extension install` and `extension grant` print `  access   Unrestricted: <sentence>` and the
  four group lines before the signature line, from the same words; `confirmBackOfficeCode`
  becomes `confirmLevel`, asking at a terminal for either upper level; `--dry-run` prints the
  same. A refusal from `grantRefusal` prints as the server's message.
- `remote.ts`: the install and grant problems carry the level's sentence where they carried
  `BACKOFFICE_CODE_WARNING`.

### Slice 5: tests and docs

- `tests/bundle-levels.test.ts`: `levelOf` for each level and for an empty list; `groupsOf`
  places every catalogue entry in exactly one group; `grantRefusal` for each refusal and for
  each allowed case, local and vouched included; the two new keys refused by name.
- `tests/bundle-install.test.ts` and `tests/bundle-manage.test.ts`: a non-administrator with
  Settings installs Limited and is refused Unrestricted with the sentence, from the install
  route, the grant route and the CLI's admin; an unsigned upper-level package is refused and
  a local one is not; with the setting at `config` the back office is refused and a config
  entry still grants; the listing rows carry `level`, `groups` and `mayGrant`; an upgrade from
  Limited to Unrestricted is `waiting` with the new level; the audit detail names the level.
- `tests/backoffice-code-words.test.ts` becomes `tests/level-words.test.ts`.
- Docs: `bundles.md` "Permissions" gains "Levels" with the table and the groups;
  `configuration.md` adds the setting beside `CROMBOLO_BUNDLE_SIGNATURES`;
  `extension-threat-model.md` "Permissions an extension asks for"; `release-notes.md`.

### Open until built

- The badge colours: Limited in the default look, Acts as you in warning, Unrestricted in
  danger, unless the design pass says otherwise.
- Whether a Settings holder who is not an administrator sees the Marketplace's Unrestricted
  entries at all, or sees them with the sentence. The plan shows them with the sentence, so
  they can ask an administrator.

## Acceptance criteria

- [x] Every extension lands on one level from its permissions, and the panel shows the badge,
      its sentence and the four groups before anything else.
- [x] The expander shows each permission's sentence and reason, and `http.outbound`'s origins.
- [x] Non-administrators cannot grant the upper two levels, from the panel, the API or the CLI.
- [x] The upper two levels refuse an unattested package; Limited installs it, saying nobody vouched.
- [x] `CROMBOLO_UNRESTRICTED_EXTENSIONS=config` replaces the button with the snippet, and the
      grant route refuses the back office while a config entry still grants.
- [x] A local build reaches the upper levels; unsigned, invalid and unchecked do not.
- [x] `extensions.install` and `extensions.grant` are refused by name; `users.write` as before.
- [x] Installed shows each row's badge; a version asking for more is off until re-granted, and
      Review says what changed.
- [x] Covering tests; docs and release notes.

## What was built (2026-11-11)

- **Levels and groups** are pure, in `bundle-permissions.ts`: `levelOf`, `isUpperLevel`,
  `LEVEL_WORDS`, `groupsOf` (each catalogue entry in exactly one place, `user.delegate` read
  as "everything you can see" and "everything you can change"); `NEVER_OFFERED` adds
  `extensions.install` and `extensions.grant`, each refused by name; `BACKOFFICE_CODE_WARNING`
  is the Unrestricted sentence.
- **One refusal,** `grantRefusal` in `grant-policy.ts`, with `mayGrant` for the panel and
  `vouchedFor` (signed, vouched or local). The marketplace's registry and file installs call
  it after the signature check, and the admin's grant calls it with the installed package's
  provenance, so the panel, the API, the CLI and a remote refuse alike. `BundleActor` gained
  `isAdmin`; the CLI's actor is one.
- **A change beyond the plan (the maintainer's choice):** installing, removing and granting
  an extension are an administrator's at every level, where the story had Settings access
  install and grant a Limited one. The grant route was already administrators only (story
  309); the install and uninstall routes are now too, and the panel and Installed say "An
  administrator can install this." and "An administrator can remove this." to anyone else.
  Disabling and enabling stay open to Settings. A remote's actor counts as an administrator,
  since it reaches extensions only with "Install code on this site".
- **The setting:** `CROMBOLO_UNRESTRICTED_EXTENSIONS`, `config.unrestrictedExtensions`, in
  the settings registry and the regenerated `configuration.md`. The CLI and a remote are
  refused too while it is `config`, since the point is that only a reviewed commit grants it.
- **The rows:** Installed rows carry `level`, `groups` and, once granted, `grantedLevel`; the
  consent answer carries `level`, `groups` and the extension `id`; both responses carry
  `mayGrant`. The audit detail names the level: "granted Unrestricted: backoffice.code".
- **The panel and Installed** draw `bundles-level.js` (badge, sentence, unvouched line, four
  groups, the expander) and choose the button, the sentence or the config snippet from
  `bundles-level-words.js`, tested without a browser. Installed shows the level on every row,
  "Off · asks for more" for a version waiting on a grant, and names the level it moved to.
  `bundles-backoffice-code.js`, its words and their test are retired.
- **The CLI:** `confirmLevel` prints the level and the groups and asks at a terminal for
  either upper level.
- **Tests:** `tests/bundle-levels.test.ts`; a `linkedDependencies` helper for fixtures that are
  granted an upper level, since a `*` range now reads as unsigned; marketplace expectations
  moved to the new warning and to listings without the id and screen count.
- **Not done:** badge colours follow the plan's defaults (default, warning, danger) without a
  design pass; a non-administrator sees an upper-level extension in the Marketplace with the
  sentence in place of the button.
