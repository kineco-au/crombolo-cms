# 319 — A host vouches for the site bundles it applies

**Epic:** I — Hardening · **Priority:** should · **Size:** S
**Depends on:** 316

## Story

As a platform that runs sites and authenticates every site bundle it accepts itself, with
deploy tokens, its own sessions, moves and copies between environments, I want to tell
the CMS when it applies one, so that a production site takes it without a signer of its
own, and the CMS's signer check stays as it is for everyone else.

## Context

Story 316 has a production site apply a site bundle only from a signer it trusts. The host
API's `contentImport` accepts `provenance: 'local'` (`TransferInput`,
`packages/server/src/bundle-install.ts`). That skips the signer check, the downgrade check
and the value-migration gate. The CMS uses it for the site's own content files
(`site/apply.ts`, `support/serve.ts`), and nowhere documents it as a host's.

A host relying on an undocumented field could lose it in any release. And the field
sits in `TransferInput`, the same object the HTTP handlers fill from a request:
- the remote protocol's `PUT bundles` (`remote.ts`);
- the transfer dashboard (`transfer-dashboard.ts`);
- the back office's install (`bundle-admin.ts`).

Each of these copies its fields one by one today, so no request can set it. That rests
on how the handlers are written: one spread of the request body into the input would let
any caller over HTTP switch the signer check off.

## Decisions (2026-11-10)

- **Vouching is an argument, never input.** What separates a vouched apply from a
  request is the process boundary. Only the CMS and the host that embeds it can call
  `contentImport` directly: since 311, extension code runs in a process of its own, and
  a wired bundle gets a narrow interface, not the server. So vouching is a parameter a
  request has no way to express. It is not a field the handlers promise not to copy.
  The rejected options were:
  - a symbol key on the input: unforgeable from JSON, but an unusual API for a host to
    call, and lost when an input is copied;
  - keeping the field with a guard test: the guarantee would still rest on how the
    handlers are written.
- **The site and the host vouch differently.** The site's own content files are built
  here. A host's bundle comes from elsewhere, so it keeps the checks that protect a site
  from an old or unmigrated bundle.
- **`provenance` goes, with no transition period.** It was never documented as a
  host's, so it is removed outright, and the upgrade notes say so.

## The design

- **`TransferInput` loses `provenance`.** `contentImport` and `contentCheck`, and
  `installBundleContent` and `checkBundleContent` under them, take a third argument:

  ```ts
  contentImport(config, input, { vouchedBy: 'host' })
  ```

  | | Signer check | Downgrade check | Value-migration gate | Recorded as |
  |---|---|---|---|---|
  | none | as 316 | as 316 | as now | the signer |
  | `vouchedBy: 'site'` (the site's own content files) | skipped | skipped | skipped | as today's `local` |
  | `vouchedBy: 'host'` | skipped | kept | kept | `signed_by: 'host'` |

- **The CLI's two callers** of `provenance: 'local'` (`site/apply.ts`,
  `support/serve.ts`) pass `{ vouchedBy: 'site' }`.
- **The downgrade check for a vouched bundle** is 316's check, with `'host'` as the
  signer: `versionsSignedBy('host', name)` over the package name and version. Those come
  from the bundle's own `package.json`, since an unsigned bundle has no verified
  `provenance.package`. An older version than one already applied is refused unless
  `allowDowngrade` is given.
- **The runs list** shows a vouched run as vouched for by the host.
- **The host API** (`packages/crombolo/src/host.ts`) exports `contentCheck` beside
  `contentImport`, with the third argument in its documented types.
- **Never over HTTP:** the HTTP handlers in `remote.ts`, `transfer-dashboard.ts` and
  `bundle-admin.ts` never pass the third argument. A guard test, in the style of
  `tests/plugin-boundary.test.ts`, fails if any of them does.
- **Docs:**
  - `content-transfer.md` gains a "Hosting" section: what vouching means, what a host
    must have checked before it vouches, and that it is never offered over HTTP or the
    remote protocol.
  - `docs/api.md` documents the argument.
  - The release notes list the change, and say in the upgrade notes that a host passing
    `provenance: 'local'` passes `{ vouchedBy: 'host' }` instead.

## Acceptance criteria

- [x] `TransferInput` has no `provenance`; `contentImport` and `contentCheck` take
      `{ vouchedBy: 'site' | 'host' }` as a third argument, both exported by the host API.
- [x] A production site with no trusted signer applies an unsigned site bundle given
      `vouchedBy: 'host'`, and refuses it without.
- [x] A vouched run is recorded with `signed_by: 'host'` and listed as vouched for by the
      host.
- [x] A vouched bundle older than one already vouched for under the same package name is
      refused without `allowDowngrade`, and applied with it.
- [x] A vouched bundle still meets the value-migration gate.
- [x] The CLI's content files apply as before, through `vouchedBy: 'site'`.
- [x] A remote `PUT bundles` whose body carries `provenance: 'local'` or `vouchedBy` is
      still refused for its signer.
- [x] A guard test fails if an HTTP handler passes the third argument.
- [x] `content-transfer.md` has a "Hosting" section, and `docs/api.md` documents the
      argument.

## Implementation (0.58.0)

- `Vouch` (`packages/server/src/bundle-install.ts`): `checkBundleContent` and
  `installBundleContent` take it as a fourth argument, and the CLI's `contentCheck`
  and `contentImport` as a third. `TransferInput` has no `provenance`.
- `vouchedBy: 'site'` gives the provenance `local`, as before; `vouchedBy: 'host'` gives
  a new state, `vouched` ("Vouched for by the host"; "From the host" in the back office).
- `vouchedTrust` (`site-trust.ts`) shares 316's downgrade check, factored out as
  `downgradeCheck`, with `HOST_SIGNER = 'host'` as the signer and the package name and
  version from the bundle's `package.json`.
- The host API exports `contentCheck`, `TransferInput`, `ContentImportInput`,
  `ContentCheckResult`, `ContentImportResult` and `Vouch`.
- `site runs` prints a vouched run with "vouched for by the host" (`runLine`), and its
  JSON has `signedBy`.
- Tests:
  - `tests/site-trust.test.ts`: production, unsigned, vouched; recorded as `host`;
    an older version refused, then applied with `allowDowngrade`.
  - `tests/bundle-install.test.ts`: a vouched bundle still meets the gate.
  - `tests/remote-apply.test.ts`: a `PUT bundles` carrying `provenance` or `vouchedBy`
    is weighed as unsigned.
  - `tests/vouch-boundary.test.ts`: no handler names a vouch or passes a fourth
    argument.
- `content-transfer.md` "Hosting", and `api.md` "A host vouches for the bundles it
  applies".
