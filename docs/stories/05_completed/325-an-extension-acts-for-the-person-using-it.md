# 325 — An extension acts for the person using it

**Epic:** I — Hardening · **Priority:** should · **Size:** L
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

## Decisions (2026-11-11, planning)

- **`actAs` goes in this story.** `user.delegate` replaces it: one permission, no choice of
  whom to act for at grant time. The manifest reader refuses `actAs` by name from schema 6,
  with the message naming `user.delegate`; an installed schema 5 package that asks for it
  keeps running on its recorded grant until its next version, which is refused until rewritten.
  (`content.actAs`, the config's API user for the site's own code, is story 298's and stays.)
- **Not from the config.** `user.delegate` is granted only from the back office, the CLI or a
  remote by a signed-in administrator, who becomes the installer a job or event acts for. A
  config `extensions` entry granting it is refused at boot, naming the person who must grant
  it instead. So the config entry loses `actAs` and gains nothing.
- **`extension migrate` rewrites `actAs` to `user.delegate`**, removing the area permissions
  beside it, and says so: the extension becomes Acts as you, and administrators grant it again.
- **The grant row's `act_as` column is replaced by a migration:** `delegate_key`, the
  installer's user key when `user.delegate` is granted, null otherwise. Rows with
  `installer:<key>` are copied across; `caller` and `user:<key>` rows become null, since those
  grants name `actAs`, which the next version cannot ask for. `act_as` is dropped. The
  migration's `release` is the version it ships in, and every test rewind is extended.
- **Attribution** rides on what exists: an extension's call through `api` runs inside
  `calling.run(bundleId, …)`, so the audit sink reads `callingExtension()` and writes the
  person as `userKey` and `userName` with `detail` prefixed "<Extension name>, for <person>".
  No new audit column.

## The plan (2026-11-11)

What `actAs` touches today, every line of which changes or goes: the catalogue entry and
`DECLARATION_PERMISSIONS`; `actAsChoice`, the grant's `actAs` field, `grantGaps`'s "whom it
acts for", `approvalHolds`' third argument and `narrow`; `core.ts`'s principal choice in the
`api` capability and the config grant's `actAs`; `ExtensionEntry.actAs` and
`extensionEntryProblems`; `marketplace.ts`'s `asksActAs` and `consented`; `bundle-admin`'s
grant and install requests; `server.ts`'s install and grant bodies; `remote.ts`'s two bodies;
the panel's "Acts for" select in `bundles-marketplace.js` and `bundles-installed.js` and
`bundles-client.js`'s two calls; the CLI's `--act-as` on `extension install` and
`extension grant` and `support/bundles.ts`; `tests/extension-grants.test.ts`; `bundles.md`
(nine mentions), the threat model and the release notes.

### Slice 1: the permission

- `bundle-permissions.ts`: `user.delegate` in the catalogue with the sentence from the
  decisions and the expanded reason as its `warning`; `actAs` removed; `readPermissions`
  refuses `actAs` by name ("`actAs` is retired: ask for `user.delegate`, which acts for the
  person using it across every area") and refuses `user.delegate` beside any area permission
  ("`user.delegate` already reaches every area: drop the others"). `BUNDLE_SCHEMA_VERSION` 6
  if 323 has not moved it already.
- `bundle-grants.ts`: `user.delegate` joins `DECLARATION_PERMISSIONS`; `grantGaps` loses the
  acting line; `approvalHolds` loses its third argument; `grant` and `narrow` carry
  `delegateKey`.
- `bundle-api.ts`: `extensionPrincipal` is unchanged for the extension acting as itself. A new
  `delegatePrincipalOf(caller, grant)` returns the caller's principal for a back-office caller
  and `userPrincipalByKey(grant.delegateKey)` otherwise; a missing or deleted installer leaves
  the extension acting as itself and logs once. `actAsChoice` is deleted.
- `core.ts`: the `api` capability's `principal` uses the grant's `user.delegate`; the boot
  refuses a config entry whose `grant` names `user.delegate`, naming the person who must grant
  it; `ExtensionEntry.actAs` is removed with its reading.

### Slice 2: the three refusals and the audit

- `bundle-api.ts` `permissionsFor`: under `user.delegate` every `API_PERMISSIONS` reach is
  open, and three are refused whoever the person is: `management/api/v1/user` and `user-group`
  writes, `crombolo/api/extensions/*` and `crombolo/api/bundles/*`. The refusal names the
  rule: "an extension may not install or grant extensions, or change users and groups, for
  anyone". `users.read` stays as the area it is.
- The audit sink in `server.ts` (`createAuditSink`'s `record`) reads `callingExtension()` and,
  when set, prefixes `detail` with "<name>, for <person>" and keeps the person as the user;
  `extensionPrincipal`'s own calls keep "Extension <name>" as today. Story 327 reads the
  prefix.

### Slice 3: the migration

- `packages/data/src/schema/bundle-grant-delegate.ts`, migration 071 from
  `STATE_CONTENT_TYPE_SEO`: add `delegate_key` (varchar 36), copy the key out of
  `act_as` where it starts with `installer:`, drop `act_as` with `ops.dropColumn` as
  `bundle-components.ts` did. `kind: 'contract'`, as `drop-assistant.ts` is. `release` is the
  next version at the time it lands.
- Repository: `BundleGrant.actAs` becomes `delegateKey`; `tables.gen.ts` regenerated.
- Rewinds: `tests/support/db.ts`, `tests/integration/first-boot.integration.ts`,
  `tests/media-access.test.ts`, `tests/permissions.test.ts` and
  `tests/upgrade-from-release.test.ts` each undo it before `AddBundleGrantReach`.

### Slice 4: the surfaces

- `marketplace.ts`: `asksActAs` and `consented`'s acting check go; `grantStateOf` says
  `delegates: boolean` for the panel's Acts as group (story 324 reads it).
- `bundle-admin.ts`, `server.ts`, `remote.ts`: the `actAs` field leaves the install and grant
  bodies; the installer's key is the actor's `id`, which the CLI's actor lacks, so a CLI grant
  of `user.delegate` needs `--delegate-to user:<key>` or is refused with that message; a remote
  grant carries the remote principal's key.
- The panel and Installed drop the "Acts for" select; the client's two calls lose the argument.
- `extension migrate` (`support/extension-migrate.ts`): a schema 5 manifest with `actAs` is
  rewritten to `user.delegate` with the areas removed, printed as a move; the reason is the
  old `actAs` reason.
- The CLI's `extension install` and `extension grant` lose `--act-as`; `extension list` shows
  "acts for the person using it" on a delegating row.

### Slice 5: tests and docs

- `tests/extension-permissions.test.ts`: `user.delegate` reaches every area as the caller and
  not beyond the caller's own rights; a non-administrator caller is still bound; the three
  refusals hold for an administrator caller; a job acts for the installer; `actAs` is refused by
  name; `user.delegate` beside an area is refused; a config grant of it is refused at boot.
- `tests/extension-grants.test.ts`: the acting lines go; `delegateKey` is recorded and
  narrowed.
- `tests/migrations.test.ts` and `tests/upgrade-from-release.test.ts`: the new migration, with
  an `installer:` row copied and a `caller` row nulled.
- `tests/audit*.test.ts`: an entry written through `api` under `user.delegate` names the person
  and carries the extension in `detail`.
- `tests/extension-migrate.test.ts`: the `actAs` rewrite.
- Docs: `bundles.md` "Permissions" (the catalogue table's acting rows, "Least privilege",
  "The install", "A grant is what lets it run"), `extensions.md`, `extension-threat-model.md`
  T10 and "Permissions an extension asks for", `release-notes.md` with the migration listed and
  the upgrade note: an extension asking for `actAs` must be rewritten with
  `extension migrate` before its next version installs.

## Acceptance criteria

- [x] An extension asking for `user.delegate` reaches every area as the caller, and nothing
      beyond what the caller holds.
- [x] `user.delegate` beside an area permission is refused at boot with the reason.
- [x] Installing, granting and writing users and groups are refused under it, for an
      administrator caller too.
- [x] A job or event with no caller acts for the installer, and the expanded reason says so.
- [x] The audit names the extension and the person on each call.
- [x] `actAs` is gone: refused by name in a manifest, absent from the config entry, the grant
      bodies, the panel and the CLI; `extension migrate` rewrites it to `user.delegate`.
- [x] A config entry granting `user.delegate` is refused at boot, naming who grants it instead.
- [x] The migration adds `delegate_key`, copying installer keys, and every test rewind undoes
      it; `act_as` is left unread for a later contract (see "What was built").
- [x] Covering tests; `bundles.md` "Permissions", the threat model and release notes.

## What was built (2026-11-11)

- **Two changes from the plan,** both narrower:
  - `actAs` is refused by name at every schema, not kept running for an installed schema 5
    package: keeping it would have kept all the `act_as` machinery this story removes. An
    installed version asking for it stops until one asking for `user.delegate` is installed.
  - The migration (`AddBundleGrantDelegate`, 071) adds `delegate_key` and copies installer
    keys, but does not drop `act_as`. Dropping a column is a contract migration, which would
    make 0.61.0 a release that cannot upgrade node by node. A later release's contract drops
    it. Its `release` is 0.61.0, so `tests/migrations.test.ts`'s version check fails until
    the release raises `VERSION`, as AGENTS.md describes.
- **A visitor borrows nobody.** The plan said a caller with no person acts for the installer;
  that is narrowed to a job or an event (the `job` caller). A public route under
  `user.delegate` acts as the extension itself, so a visitor never borrows an administrator.
- **The catalogue** (`bundle-permissions.ts`): `user.delegate` with its sentence and detail,
  `AREA_PERMISSIONS`, and `readPermissions` refusing `actAs` and `user.delegate` beside an area.
- **The reach:** `delegatedPermissions` (`bundle-grants.ts`) gives a back-office caller's
  capabilities the areas of the sections they hold; `createBundleApi` opens every area's paths
  under it and acts as the caller (or, for a job, the installer by `delegateKey`), so the API
  holds it to their rights; `refusedForEveryone` refuses extension install and grant, the
  remote, and user and group writes, for anyone.
- **The grant:** `BundleGrant.delegateKey`; `grantGaps` names a missing installer; the admin's
  install and grant take `delegateTo`, the actor's own key unless named; the CLI's
  `--delegate-to` replaces `--act-as`; the remote takes a named key for a CI job; a config
  grant of it stops the boot (`extensionEntryProblems`).
- **The audit:** the calling extension's name rides `calling.run`; `createAuditSink` writes
  the detail "<Extension>, for <person>" with the person as the user.
- **The panel and Installed** lose the "Acts for" choice.
- **`extension migrate`** rewrites `actAs` to `user.delegate` and drops the areas it covers,
  at any schema (`retireActAs`).
- **Tests:** `tests/extension-delegate.test.ts`, with real calls through a process for an
  administrator and a writer, the refusals, the audit wording and a job acting for its
  installer; `tests/extension-grants.test.ts` moved to `delegateKey`; the five rewinds.
