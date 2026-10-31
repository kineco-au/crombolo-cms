# 225 — Bundles in the site's code are approved, and an administrator can disable one

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** 222

## Story

As a developer adding a bundle to a site, I want wiring it in
`crombolo.config.ts` to be its approval, so that a deploy does not leave it off
until someone signs in. As an administrator, I want to be able to disable a
bundle, so that I can still stop one that misbehaves without a deploy.

## Context

Story `222` made every bundle with a server half wait for an administrator's
approval of its permissions (decision 5), and ruled out approving one in the
config (decision 4). A server half only runs once it is imported into
`crombolo.config.ts` (an install from the back office adds the package, never
its server code), so that gate applied to every bundle that could run.

What `222` built and this keeps:

- a bundle declares its `permissions`, and its capabilities are checked against
  them at boot and on every call;
- the install panel lists the permissions before a back-office install;
- `bundle_grant` (migration 054) records what each bundle was approved for.

## Decisions (2026-10-31)

1. **Wiring a bundle in `crombolo.config.ts` approves it.** Reverses `222`'s
   decisions 4 and 5. Each boot of a node that writes records the wired
   bundles as approved by the site's code, with the version and permission
   list, and audits it whenever those change. The Installed card shows what
   the bundle may do and who approved it.
2. **An administrator can disable a bundle** (option B of three). A disabled
   bundle is off as an unapproved one was: its routes answer 503, its jobs do
   not run, its screens are hidden. It stays disabled, through new versions,
   until an administrator enables it again; a version asking for more does not
   turn it back on. Per environment, kept in its own database, audited, in
   Packages → Installed for those with the Packages section.
   - Not chosen: nothing to approve and no way to disable short of a deploy
     (A); approval at first wiring with a later version asking for more waiting
     for an administrator (C).

## Plan

1. **Migration 056** (`DisableBundles`): `bundle_grant` gains `disabled_by` and
   `disabled_at`, both nullable.
2. **The repository** keeps a bundle's disabled state when its approval is
   recorded again, and gains `disable` and `enable`; `withdraw` goes.
3. **The service** (`packages/server/src/bundle-grants.ts`):
   - `isOn` is "not disabled": the code is the approval, so a node never sees a
     just-upgraded bundle as off while another records it;
   - `approveWired`, at boot, on a node that writes, records each wired
     bundle's version and list where they changed, and audits it;
   - `disable` and `enable`.
4. **The back office:** `POST …/api/bundles/disable` and `…/enable` replace
   `grant` and `withdraw`; the Installed card shows **Disable** or **Enable**
   and who approved what, and an install records its approval as now.
5. **What goes:** `crombolo bundle grant`, the boot warning and banner for a
   bundle waiting on approval, and the templates' first-run note. A disabled
   bundle is logged at boot and named in the banner instead.
6. **Tests:** `tests/bundle-permissions.test.ts` and
   `tests/marketplace.test.ts`; the harness's `ungranted` becomes `disabled`.
7. **Docs:** `docs/bundles.md`, "Permissions"; release notes with the upgrade
   note; `222` points here.

## Acceptance criteria

- [x] A bundle wired in the config runs on its first boot with no approval, and
      the boot records its version and permissions as approved by the site's
      code, audited once per change.
- [x] Its capabilities are still checked against its declared permissions.
- [x] An administrator can disable a bundle and enable it again, in Packages →
      Installed, audited; disabled, its routes answer 503, its jobs do not run
      and its screens are hidden, on every node.
- [x] A disabled bundle stays disabled through an upgrade, including one asking
      for more permissions.
- [x] `crombolo bundle grant` is gone, and nothing in the UI or the docs asks
      anyone to approve a bundle wired in code.
- [x] Migration 056 is undone in every test rewind.
- [x] `docs/bundles.md` and the release notes say what changed.

## What was built

- **Migration 056** (`packages/data/src/schema/bundles-disabled.ts`,
  `DisableBundles`): `disabled_by` and `disabled_at` on `bundle_grant`.
- **The repository** (`repositories/bundle-grants.ts`): `grant` upserts and
  keeps the disabled state; `disable` (recording the package when it has no row
  yet) and `enable`; `withdraw` is gone.
- **The service** (`packages/server/src/bundle-grants.ts`): `isOn` is "wired
  and not disabled"; `grant` returns whether the approval changed
  (`approvalHolds`); `disable`, `enable`; `APPROVED_BY_CODE`.
  `disabledResponse` replaces `waitingResponse`.
- **Boot** (`core.ts`): on a node that owns writes, each wired bundle's
  approval is recorded by the site's code and audited when it changes (audit
  source `boot`, shown as "Site start-up"); a disabled bundle is logged.
- **The back office:** `POST …/api/bundles/disable` and `…/enable`, audited;
  the Installed card shows who approved it with **Disable**, or who disabled it
  with **Enable**. `ServerHandle.disabledBundles()` and the `crombolo start`
  banner name disabled bundles.
- **Removed:** `crombolo bundle grant` and its operation, the harness's
  `ungranted` and `grantWired`.
- **Tests:** `tests/bundle-permissions.test.ts` (approval recorded once per
  change, disabled through an upgrade asking for more, disabled before any
  approval, a wired bundle running on first boot then disabled and enabled with
  its audit); 056 undone in every rewind.
- **Docs:** `docs/bundles.md`, "Permissions"; the release notes; `222` points
  here.

## Out of scope

Disabling a bundle from the command line, or in the config.
