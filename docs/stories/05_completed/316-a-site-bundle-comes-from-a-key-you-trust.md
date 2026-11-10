# 316 — A site bundle is applied only from a key you trust

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** 306

## Story

As someone running a site, I want a site bundle applied only when it was signed
by a key I trust, a person's or a site's, possibly this site's own, or built in CI
from a repository I trust, and never an older one than I last applied,
so that someone who overwrites a bundle on disk, in an artifact store or in
transit cannot put their content or code on my site.

## Context

A site package carries the site's code (story 306), and is applied by
`site apply`, `push`, `pull`, `site deploy`, a remote's apply and
`start --bundle`. Signing (story 060) is Sigstore keyless, in CI only, and
optional by default (`CROMBOLO_BUNDLE_SIGNATURES=optional`). So:
- an attacker who replaces a site bundle strips its signature, and it applies;
- a bundle made on a developer's machine or in the back office (the Bundle
  Editor's site bundles, story 312) cannot be signed at all;
- a validly signed older bundle, put back, applies too.

## Decisions (2026-11-10)

- **Keys for site bundles, Sigstore for what is published.** Keys sign site
  bundles, many of which a server makes, without asking anyone and without
  publishing anything. Sigstore (story 060) stays for what is built in CI and
  published to sites nobody knows: our extensions and demo bundles, where CI
  holds no secret and a site trusts a repository rather than a key.
- **One trusted list, managed as GitHub manages keys.** An administrator keeps
  the list in Settings, adding, renaming and removing entries. An entry is one
  of:
  - **a user key:** a person's own, made on their machine with
    `crombolo keys create`, its private half never leaving it. A CI job signs with
    one kept as a secret;
  - **a site key:** a site's own, made the first time it needs one, its private
    half kept in that site's database, sealed with its secret key;
  - **a CI source:** a Sigstore identity, `org/repo`, `org/*` or `org/repo@v*`,
    what `CROMBOLO_BUNDLE_SOURCES` names today. That setting becomes a locked
    entry.
- **Required in production.** With `NODE_ENV=production`, a site bundle must be
  signed by a trusted key or CI source, or it is not applied. In development it is optional,
  and an unsigned one is flagged. Extensions keep today's setting.
- **No downgrades.** A validly signed site bundle older than the last one this
  site applied from the same signer is refused, naming both versions.
  `--allow-downgrade` applies it, for a deliberate rollback, and the audit log
  records that.

## The design

- **Keys:** Ed25519. A public key is written as `crombolo-ed25519 <base64>
  <comment>`, one line to copy and paste, and known by its SHA-256 fingerprint,
  shown as `SHA256:…` as GitHub shows SSH keys.
- **Making a key:**
  - `crombolo keys create [--name <comment>]` writes a user key pair to the
    user's own config directory and prints the public line;
    `crombolo keys list` shows the keys there.
  - A site's key is made when it first signs; `crombolo site key` and Settings
    show its public line.
- **Signing:** everything a site makes as a site package is signed with its key:
  `site export`, `site build`, the Bundle Editor's site bundles, a `pull`'s
  bundle and a `push`'s. `site build --sign-with <key>` signs with a user key
  instead, as a CI job does. The signature covers the package digest story 060
  defines, so it covers `package.json` and every file, and sits in
  `provenance.json`, naming the key's fingerprint and the bundle's version.
- **Trusted signers, in Settings** (an administrator's, like GitHub's SSH keys
  page):
  - a list showing each entry's name, its kind (user key, site key or CI
    source), its fingerprint or source, who added it and when, and when it last
    signed something applied here;
  - **Add:** a name, and either a key's public line pasted in, which says which
    kind it is, or a CI source; refused when it is neither, or already listed;
  - **Rename**, and **Remove**, which asks first;
  - this site's own key at the top, always trusted, with its public line to
    copy;
  - every change audited.
- **In the CLI and the config:** `crombolo keys trust <name> <public line>`,
  `crombolo keys trust <name> --source <org/repo@v*>`,
  `crombolo keys untrust <fingerprint|source>` and `crombolo keys trusted`,
  locally or on a remote. The config's `trustedKeys: [{ name, publicKey }]` and
  `trustedSources` list entries that are trusted and locked: Settings shows them,
  and cannot remove them. `CROMBOLO_BUNDLE_SOURCES` is read as locked sources.
- **Checking,** wherever a site bundle is applied (`site apply`, `push`, `pull`,
  `site deploy`, a remote's apply, `start --bundle`):
  - a signature that does not check out is refused, always;
  - in production, no signature by a trusted key or CI source is refused;
  - an older version from the same signer is refused without `--allow-downgrade`,
    the versions compared from the signed `package.json`, recorded with each run.
- **What a person sees:** a check and an apply name the signer, "Signed by Adam's
  laptop (SHA256:a1b2…)" or "Built from acme/site at v1.4.0", or say why it was
  refused, in plain words.
- **A key that leaks** is removed from the trusted list; bundles it signed are
  refused from then on.

## Open questions

- **Remotes.** A `push` is already authenticated by the remote's credentials.
  Proposed: the remote checks the signature anyway, so a bundle changed between
  building and sending is caught.

## Acceptance criteria

- [x] A site has a key pair; `crombolo site key` and Settings show its public key
      and fingerprint, and the private half is stored sealed.
- [x] `crombolo keys create` makes a user key on the person's machine, and
      `site build --sign-with` signs with it.
- [x] Every site package the site makes is signed with its key.
- [x] In production, an unsigned site bundle, or one signed by a key it does not
      trust, is refused wherever site bundles are applied; in development it
      applies, flagged.
- [x] A bundle whose files changed after signing is refused, always.
- [x] An older version from the same signer is refused, naming both, unless
      `--allow-downgrade`, which is audited.
- [x] Trusted signers, user keys, site keys and CI sources, are added, renamed and
      removed in Settings and the CLI, each audited, and locked by the config's
      `trustedKeys` and `trustedSources`, and by `CROMBOLO_BUNDLE_SOURCES`.
- [x] A site bundle signed in CI by a trusted source applies in production, as
      one signed by a trusted key does.
- [x] A browser test adds a key in Settings, sees it listed with its
      fingerprint, and removes it.
- [x] `bundles.md`'s signing section and the threat model describe trusted keys.

## Implemented (0.57.0)

- **Keys** (`packages/server/src/signing-keys.ts`): Ed25519 by `node:crypto`; the
  public line and its `SHA256:` fingerprint; user keys as JSON, mode 0600, in
  `$XDG_CONFIG_HOME/crombolo/keys/`.
- **This site's key** (`site-trust.ts`, `siteSigningKey`): in `umbraco_key_value`
  under `Crombolo.Signing.SiteKey`, the private half sealed with
  `CROMBOLO_SECRET_KEY`; a site without one makes no key, and its bundles go
  unsigned.
- **Signatures** (`provenance.ts`): `provenance.json` takes `key` beside or
  instead of Sigstore's `signature`, over the same digest with the package's name
  and version. `signPathWithKey` signs a directory or `.tgz`; `keySignatureOver`
  signs files not yet written. Signing with Sigstore after a key keeps the key's.
- **Where it signs:** `exportSite` (so `site export` and the remote's export for
  `pull`), `content export`, `site build` and `site deploy` (the CLI's
  `support/signing.ts`, with `--sign-with`), and the Bundle Editor's site bundles.
- **Where it checks:** `bundle-install`'s check and import (`signatureDecision`:
  a site bundle by `siteBundleTrust`, an extension by the policy as before), the
  remote's apply, and `start --bundle`. The run records `signed_by`, and the
  signer's "last signed"; an allowed downgrade is audited.
- **The list:** migration 069; `TrustedSignerRepository`;
  `createTrustedSignersAdmin` behind `<backoffice>/crombolo/api/bundles/signers`
  and the `keys` commands; Settings → Trusted signers
  (`plugin/trusted-signers.js`).
- **Differences from the plan:**
  - A key's kind, user or site, is chosen when it is added: the line itself does
    not say.
  - `keys trust`, `untrust` and `trusted` work on the local site. A remote's list
    is managed in its Settings.
  - A remote checks a pushed bundle's signature as any apply does, as proposed.
- **Tests:** `tests/site-trust.test.ts`, and
  `tests/browser/trusted-signers.browser.ts`.
