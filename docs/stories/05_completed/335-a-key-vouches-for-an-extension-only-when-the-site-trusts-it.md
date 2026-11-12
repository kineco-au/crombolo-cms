# 335 — A key vouches for an extension only when the site trusts it

**Epic:** E — Cross-cutting · **Priority:** must · **Size:** M
**Depends on:** 316, 324

## Story

As a site administrator, I want only signatures I trust to let an extension act as me or
run code in the back office, so that a package someone signed with a key they made a
minute ago is treated as the unsigned package it is.

## Context

Story 324 lets an upper level (Acts as you, `user.delegate`; Unrestricted,
`backoffice.code`) be granted only for a package someone vouched for. `vouchedFor`
(`server/src/grant-policy.ts`) takes `state: 'signed'`. Story 316 added key signatures,
and `verifyProvenance` returns `signed` for a package with a key signature that checks
out, whoever made the key. Trusted signers are consulted only for site bundles
(`site-trust.ts`).

So `crombolo keys create anyone` and `signPathWithKey` turn an unsigned extension into a
signed one, and the upper levels open for it (checked 2026-11-12 on 0.62.0: a new key over
a package asking for `backoffice.code` gives `state: "signed"`).

A Sigstore signature is different: it names the GitHub repository and commit that built
the package, in a public log.

Read again 2026-11-12:
- Two places grant a level, `bundle-admin.ts:511` (Settings, the CLI, a remote)
  and `marketplace.ts:360` (the install panel and a host's `installExtension`).
  Both go through `grantRefusal`, which is pure and decides from
  `provenance.state` alone.
- Nothing looks at a grant again after it is given. The Trusted signers list
  (`trustedSigners`, `site-trust.ts`) lives in the database and the config, and
  is used only for site bundles today.
- `bundle sign` and `bundle verify` exist; `sign` is Sigstore only.

## The design

Planned 2026-11-12.

- **One list decides.** A signature vouches for an upper level only when its
  signer is on this site's Trusted signers list, the one site bundles use:
  - this site's own key;
  - keys and sources in the config;
  - keys and sources added in Settings.

  That holds for Sigstore as well as keys: a build vouches only when its
  repository is a trusted source (`sourceAllowed`, as for site bundles).
  `vouched` (the host) and `local` (installed from a path or workspace) vouch as
  now.
- **The rule stays pure.** `trustedSigner(db, config, provenance)` in
  `site-trust.ts` answers whether the signer is on the list, and the two callers
  pass `signerTrusted` into `grantRefusal`. `vouchedFor(provenance, signerTrusted)`
  then means vouched, local, or signed by a trusted signer. The Marketplace takes
  a `signerTrusted` callback in its options, as it takes `verify`.
- **The refusal names who signed it** and says how to change that: "It is
  signed by the key <name> (<fingerprint>), or a build of github.com/<repo>,
  which this site doesn't trust. An administrator can add it in Settings →
  Trusted signers." This applies in the panel, the API, the CLI and a remote.
- **Existing grants are checked at start-up.** On each start, each upper-level
  grant recorded here whose extension's signer isn't trusted is withdrawn:
  - audited, and logged as a warning naming the extension and its signer;
  - granting it again goes through the same rule.

  That catches the upgrade, and also a signer removed from the list later. A
  grant the site's code makes is the developer's, and kept. A signature that
  can't be checked at the time is left alone. Turning a disabled upper-level
  extension back on (`setEnabled`) is held to the rule too.
- **The panel and `extension install`** name the signer and whether this site
  trusts it, for a key (name and fingerprint) as for a build (repository and
  ref).
- **`bundle sign --key <name>`** signs a package directory or `.tgz` with a key
  from `crombolo keys` (`signPathWithKey`). `bundle verify` names the signer and
  whether this site trusts it.
- **Limited extensions are unchanged:** a signature, trusted or not, only labels
  them, and the site's signature policy (story 332) still applies.
- **Docs:** `bundles.md`, "What a site takes" and the levels table, say what
  vouches at each level. The release notes' upgrade notes say:
  - upper-level extensions signed by an untrusted key or repository are switched
    off at start-up;
  - to keep one, add its signer in Settings → Trusted signers and turn it on
    again.

## Acceptance criteria

- [x] An extension at an upper level signed by a key, or built by a repository,
      this site doesn't trust is refused at every way of granting it, naming the
      signer. Adding the signer to Trusted signers lets it be granted.
- [x] Signed by a trusted key or source, installed from a path, or vouched by the
      host, it is granted as now.
- [x] At start-up, an upper-level grant whose signer isn't trusted is withdrawn,
      audited and logged. Granting it again needs the signer trusted.
- [x] The panel and `extension install` name the signer and whether it is
      trusted.
- [x] `bundle sign --key` signs an extension, and `bundle verify` names the signer
      and whether this site trusts it.
- [x] Limited extensions are unchanged: a signature, trusted or not, only labels
      them.
- [x] `bundles.md` and the release notes say what vouches, and what happens to
      existing grants at upgrade.

## Implementation

- **Trust mark:** `ProvenanceResult.trusted`.
  - `signerTrusted(db, config, provenance)` (`site-trust.ts`) checks a key by
    fingerprint, and a build by `sourceAllowed` against the Trusted signers list.
  - The Marketplace takes `trustSigner` and marks every signature it returns
    (`withTrust`), asking again each time, since the list changes. Both
    Marketplaces (`server.ts`, `bundle-admin.ts`) pass it.
- **Rule** (`grant-policy.ts`):
  - `vouchedFor` needs `signed` and `trusted`, or `vouched`, or `local`;
  - `grantRefusal` answers `untrustedSigner(provenance)`, naming the signer
    (`signerWords`), for a signature from someone untrusted;
  - `setEnabled` holds an upper-level extension to the same rule.
- **Start-up:** `switchOffUntrusted` (`grant-trust.ts`) runs in `createCore` on
  the node that writes, after grants from code. It forgets upper-level grants that
  aren't recorded by `APPROVED_BY_CODE` and aren't vouched for, skips `unchecked`,
  and audits and logs each one.
- **Panel:**
  - `signatureWords` names a key signature, and whether the site trusts the
    signer;
  - `vouchState` turns an untrusted signature into `untrusted` for `grantChoice`,
    which then says to add the signer.
- **CLI:**
  - `describeProvenance` adds "this site trusts / doesn't trust its signer" when
    known;
  - `bundle sign --key <name>` signs with `signPathWithKey`;
  - `bundle verify` marks trust when run in a site (`withSiteTrust`).
- **Tests:**
  - `tests/bundle-levels.test.ts`: the rule's words, the panel's choice, a
    key-signed Unrestricted extension refused and then granted once trusted, and
    the start-up withdrawal and its audit entry.
  - `tests/bundle-signatures.test.ts`: the signature words.
  - `tests/provenance.test.ts`: `bundle sign --key` and `bundle verify`.
