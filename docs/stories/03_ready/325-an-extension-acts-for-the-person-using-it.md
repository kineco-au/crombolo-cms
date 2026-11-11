# 325 — An extension acts for the person using it

**Epic:** I — Hardening · **Priority:** should · **Size:** M
**Depends on:** 309

## Story

As the author of a bulk editor, a migration tool or an assistant, I want my extension to do
whatever the person using it may do on the site, through the capability surface, so that it
does not need the browser to be useful, and everything it does is still checked and recorded.

## Context

`actAs` (story 308) lets an extension act for a chosen back-office user or the caller, but
only within the area permissions it also asked for. `member.delegate` acts for the member
using it. There is no way to say "as wide as the person using it" without shipping code into
the back office, which is the Unrestricted level (story 324). A tier between is useful: more
powerful than area grants, far more observable than in-realm code.

## Decisions (2026-11-11)

- **One permission, `user.delegate`** (the maintainer's choice), mirroring `member.delegate`:
  "Act for the person using it in the back office: it can do anything they can do here, and
  everything it does is recorded against them." Expanded: "When nobody is using it, for a
  scheduled job or an event, it acts for whoever installed it instead."
- **It is `actAs: caller` plus every area**, so the capability checks do not change. Asking
  for it beside any area permission is refused as redundant, as `data.tables` without tables
  is, so the panel never shows a wide grant beside a narrow list.
- **Three things stay refused however wide the person's own access:** installing or granting
  extensions, and writing users and groups. These are checked server-side on the capability
  calls.
- **It produces the Acts as you level** (story 324): administrators only, provenance required.
- **Every call is audited** with the extension and the person: "Bulk Editor, for Adam", which
  story 327 shows per extension.

## Acceptance criteria

- [ ] An extension asking for `user.delegate` reaches every area as the caller, and nothing
      beyond what the caller holds.
- [ ] `user.delegate` beside an area permission is refused at boot with the reason.
- [ ] Installing, granting and writing users and groups are refused under it, for an
      administrator caller too.
- [ ] A job or event with no caller acts for the installer, and the expanded reason says so.
- [ ] The audit names the extension and the person on each call.
- [ ] Covering tests; `bundles.md` "Permissions", the threat model and release notes.
