# 324 — The install panel says what you accept at a glance

**Epic:** I — Hardening · **Priority:** must · **Size:** L
**Depends on:** 308, 320

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
- **Who may grant.** Settings access installs and grants Limited, as today. Acts as you and
  Unrestricted need an administrator; anyone else sees "An administrator can turn this on."
  in place of the button. Revoking and removing stay open to Settings access.
- **Provenance is required for the upper two levels.** Without it the button reads "Nobody
  has vouched for who built this, so it can't be turned on here." A Limited extension without
  provenance installs, with "Nobody has vouched for who built this" shown in place of the build
  line, in the badge's colour.
- **Unrestricted can be granted from the back office or the config** (the maintainer's
  choice), as every grant can: an administrator's click is an audit entry naming them, the
  extension and the level. A host that wants the stricter rule sets
  `extensions.unrestricted: 'config'`, which puts the config snippet in place of the button.
  Off by default.
- **Never offered, whatever is asked:** `users.write`, as now, and two new keys the manifest
  reader rejects by name so an author sees why: `extensions.install` and `extensions.grant`.
  No extension may bring in another or widen a grant.
- **Installed shows the badge on every row**, and an upgrade that moves an extension up a
  level, or asks for anything new, is "Off · asks for more", with Review opening this panel
  under "This version asks for more".

## The design

- `bundle-permissions.ts`: `levelOf(permissions)`, `groupsOf(declared)` (pure, tested), the
  level sentences and the group words; `NEVER_OFFERED` grows; `BACKOFFICE_CODE_WARNING` becomes
  the Unrestricted sentence.
- The install panel (`bundles-marketplace.js`) and Installed (`bundles-installed.js`): the
  badge, the four lines, the expander, the button states, the provenance line. Settings for an
  extension stay below the groups.
- The server's grant route refuses the upper levels from a non-administrator and from an
  unattested package, and refuses `backoffice.code` from the back office when
  `extensions.unrestricted` is `config`, each with the panel's words.
- `crombolo extension install` prints the same badge and lines, and `--grant` of an upper level
  needs the same.
- Docs: `bundles.md` "Permissions" gains the levels and groups; the threat model's permissions
  section; release notes.

## Acceptance criteria

- [ ] Every extension lands on one level from its permissions, and the panel shows the badge,
      its sentence and the four groups before anything else.
- [ ] The expander shows each permission's sentence and reason, and `http.outbound`'s origins.
- [ ] Non-administrators cannot grant the upper two levels, from the panel, the API or the CLI.
- [ ] The upper two levels refuse an unattested package; Limited installs it, saying nobody vouched.
- [ ] `extensions.unrestricted: 'config'` replaces the button with the snippet.
- [ ] `extensions.install` and `extensions.grant` are refused by name; `users.write` as before.
- [ ] Installed shows each row's badge; a version asking for more is off until re-granted, and
      Review says what changed.
- [ ] Covering tests; docs and release notes.
