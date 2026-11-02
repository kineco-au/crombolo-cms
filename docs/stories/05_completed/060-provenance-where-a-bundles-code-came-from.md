# 060 — Provenance: where a bundle's code came from

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** L
**Depends on:** 010

## Story

As a bundle producer, I want to sign a bundle in GitHub Actions from the commit
or tag it was built from, with the link inside the bundle, so that anyone
taking it can check where it came from. As a site administrator, I want to see
whether a bundle is signed and by which repository before I install it, and to
be able to refuse one that is not, or not from a source I trust.

Signing is optional: an unsigned bundle installs and applies as it does today
unless the site asks otherwise.

## Context

**What an install trusts today** ([`bundles.md`](../../bundles.md), "Runtime
install"):

- `bun add` runs in the site directory, which verifies the tarball against the
  registry's sha512 integrity. That proves the bytes match what the registry
  holds, and says nothing about who published them.
- The marketplace lists a package only when the `crombolo-bundle` keyword *and*
  a real `crombolo` field agree. That stops a squatter, and does nothing
  against a package that declares a real extension with bad intent.
- Bun refuses lifecycle scripts outside `trustedDependencies`, so an install
  cannot run code in the server process.
- A server half is wired by a committed import, and on a remote only by a
  change applied by someone holding "Install code on this site" (story 241).

A bundle reaches a site four ways: a Marketplace install from npm, a `.tgz` or
directory installed or applied, and an apply to a remote (stories 167, 241).
npm's own provenance (`npm publish --provenance`) lives beside a package on the
registry, so it covers only the first. A signature inside the bundle covers all
four with one check.

**What is signed.** A bundle's own `integrity` covers its content payload, not
the npm package around it, and an extension bundle's code (`plugin/`, `src/`,
`package.json`'s `crombolo` field) is outside that payload. The signed subject
is therefore a **package digest**: SHA-256 over every file in the package, in
path order, as `bundleIntegrity` hashes a payload, excluding the one file that
holds the signature, `provenance.json`. The signature cannot sign itself, and
nothing else is left out.

**How it is signed.** Sigstore, keyless: the job's GitHub Actions identity token
(read as `remote/ci.ts` already reads it for story 160) gets a short-lived
certificate from Fulcio naming the repository, the ref, the commit and the
workflow; the signature is entered in the Rekor transparency log. No producer
keys exist to lose or rotate, and the scheme is Sigstore's, not ours.

## Decisions (planning, 2026-11-02)

- **`crombolo bundle sign <package>`** signs in GitHub Actions with Sigstore
  and writes `provenance.json` into the package: the format version, the package
  digest, the Sigstore bundle (certificate, signature, Rekor entry and its
  inclusion proof), and links to the commit, the tag when built from one, the
  workflow run and the Rekor entry. Verifiable anywhere against Sigstore's
  public trust root, with no call to GitHub. Run after `bundle build` and before
  `npm publish` or packing the `.tgz`.
- **The bundle's signature only.** npm's registry provenance is not read; it can
  be added later as a second source if publishers ask.
- **Unsigned is allowed by default; invalid is always refused.** A bundle whose
  `provenance.json` does not verify (digest, signature, certificate, log entry,
  or claims that disagree with the certificate) is refused with the reason,
  never treated as unsigned.
- **`CROMBOLO_BUNDLE_SIGNATURES`** = `optional` (default) or `required`.
  **`CROMBOLO_BUNDLE_SOURCES`** optionally lists where a signed bundle must come
  from: `org/*`, `org/repo`, or `org/repo@<tag pattern>` (`acme/crm@v*`).
  Both apply to Marketplace installs, `bundle install`, `bundle apply`, remote
  applies and installs, and `start --bundle`.
- **The commit is the truth; the tag is a name.** Tags can move, so a signature
  records the commit it was made at and the ref's name at that moment; nothing
  checks later where the tag points. A tag pattern in `CROMBOLO_BUNDLE_SOURCES`
  matches that recorded name.
- **Signed and unsigned are shown** in the install view (the Marketplace's
  Install panel, before anything is installed), in Settings → Bundles →
  Installed for each dependency, and in `bundle list`, `bundle install
  --dry-run` and `bundle apply --dry-run`. A `workspace:` or linked dependency
  is shown as local, not as unsigned.
- **A private repository is refused unless opted in.** Sigstore's public log
  records a GitHub certificate's repository, workflow, ref and commit for good,
  so `bundle sign` refuses for a private or internal repository (from the
  job's event; unknown counts as private) unless `--public-log` is passed. The
  signed statement carries the digest alone, not the package name. Signing with
  a producer's own key, logging nothing publicly, can follow as its own story.
- **GitHub only, for now.** The format records the issuer, so GitLab's Sigstore
  identities can follow without a format change.

## Signing our own bundles

Once the feature works, every bundle this repository releases is signed in the
Release workflow (`.github/workflows/release.yml`, which already has
`id-token: write` for npm), from the release tag:

- **The npm bundles:** `@crombolo/simple-redirects` and `@crombolo/entra` are
  signed after they are packed and before `npm publish` (`scripts/publish-packages.ts`),
  so the tarball on npm carries `provenance.json`.
- **The demo sites as bundles.** The sites marked `"distribute": true`
  (`demo/harbourstone`, `demo/harbourstone-next`, `demo/plain-signal`,
  `starter`) ship today as content files that `crombolo init` copies, so a
  scaffolded site builds its own bundle, which nobody else has signed. The
  release also builds each one with `bundle build --template <id>`, signs it,
  and attaches it to the GitHub release as `<id>-<version>.tgz` (the workflow
  gains `contents: write` for that). A site can then take the signed demo with
  `crombolo bundle apply <url-or-file>` or `start --bundle`.
- **The product site:** `sites/crombolo`'s `demo-crombolo` bundle is signed
  before `brochureware:publish` sends it to the platform.
- **Checked after publishing.** The release fetches each published tarball
  and asset back and verifies it (`crombolo bundle verify`), so a signature that
  failed to land fails the release rather than shipping unsigned.
- **The documented source** for sites that want only our bundles:
  `CROMBOLO_BUNDLE_SOURCES=kineco-au/crombolo-cms@v*`.

## Acceptance criteria

- [x] **Signing.** `crombolo bundle sign <dir>` in GitHub Actions (with
      `id-token: write`) writes `provenance.json`; outside Actions it is
      refused, naming the permission and the provider it needs. Signing again
      after a change replaces it; `bundle build --sign` does both in one step.
- [x] **The digest.** One function computes the package digest for signing and
      checking, and `crombolo bundle digest <dir|tgz>` prints it.
- [x] **`crombolo bundle verify <dir|tgz|url>`** checks a bundle without
      installing it and prints what the install view would say; it exits
      non-zero for an invalid signature, and for an unsigned one with
      `--require`.
- [x] **Verification** (`sigstore` in `@crombolo/server`): the digest matches;
      the Sigstore bundle verifies against the public trust root; the
      certificate's issuer is GitHub Actions; its repository, ref, commit and
      workflow are the ones `provenance.json` claims. The result is
      `{ state: 'signed' | 'unsigned' | 'invalid' | 'local', repository, ref,
      commit, workflow, links, reason? }`.
- [x] **Where it is checked.** Before anything is written by: a Marketplace
      install (the exact tarball is fetched, verified, then installed from that
      file, so the checked bytes and the installed bytes cannot differ),
      `bundle install`, `bundle apply`, remote applies and installs, and
      `start --bundle`.
- [x] **The policy.** `required` refuses an unsigned bundle, saying the site
      requires signed bundles and what the producer runs. `CROMBOLO_BUNDLE_SOURCES`
      refuses a signed bundle from elsewhere, naming the repository it came from
      and the sources allowed. Both are documented in `docs/configuration.md`.
- [x] **Shown.** The Install panel says *Signed: built from github.com/org/repo
      at v1.2.0 (abc1234)* with links to the commit and tag, or *Not signed*,
      and what the site's policy would do. The Installed view, `bundle list` and
      the dry runs show the same per bundle. The wording is *built from*, never
      *verified* or *safe*: a signature ties bytes to a build, not to a review.
- [x] **Audited.** Each install and apply records the signature state and source
      beside the entry it already writes.
- [x] **Tests** need no network: the verifier against a recorded Sigstore bundle
      and a pinned trust root; a changed file, a swapped `provenance.json`, a
      claim that disagrees with its certificate, and an expired or untrusted
      certificate each refused with their reason; the policy's refusals; an
      unsigned bundle installing under `optional`.
- [x] **Our own bundles are signed** (above): the two npm bundles, each
      distributed demo site as a release asset, and `demo-crombolo`; the release
      verifies each after publishing and fails if one is not signed by
      `kineco-au/crombolo-cms` at the release tag. `docs/release-notes.md` and
      the product site say where the signed demo bundles are.
- [x] **Scaffolding keeps a signature.** Anything that copies a signed bundle
      (`crombolo init`, staging templates) copies it byte for byte, and a test
      holds that a copied signed bundle still verifies.
- [x] **Docs.** `docs/bundles.md` gains "Signing a bundle": the digest, the
      workflow a producer adds, what is and is not claimed. The product site's
      bundles guide shows the GitHub Actions job.

## Technical notes

- `sigstore` (sigstore-js) is pure JavaScript; it lands in `@crombolo/server`
  and the CLI. **Confirmed:** it verifies under Bun, and a recorded trusted
  root (`tests/fixtures/sigstore/trusted-root.json`) checks a recorded real
  signature offline.
- The trust root refreshes over the network at verification; an unreachable TUF
  mirror falls back to the cached root, and with none, a signed bundle cannot be
  checked and is refused with that reason rather than treated as unsigned.

## Out of scope

- npm's registry provenance (decided above).
- Who the publisher is and whether anyone has reviewed them: that is 061.
- A signing scheme with keys of our own: Sigstore's is used instead.
- GitLab and other CI providers' identities (the format leaves room).

## Implementation (2026-11-02)

- **Core** (`server/src/provenance.ts`): `packageDigest` (code-unit path order,
  `node_modules`, `.git` and `provenance.json` left out), `signPackage`/`signPath`
  (sigstore `attest` over an in-toto statement with predicate
  `https://crombolo.dev/bundle-provenance/v1` and the digest alone; a `.tgz` is
  rewritten with `provenance.json` inside), `verifyProvenance`/`verifyPackage`
  (`@sigstore/verify` against the public trusted root through `@sigstore/tuf`,
  cached hourly, falling back to its cache; GitHub Actions' issuer; the
  statement's predicate and subject; the claims against the certificate's
  Fulcio extensions), `provenanceProblem`, `sourceAllowed`, `describeProvenance`,
  `repositoryVisibility`. Settings `CROMBOLO_BUNDLE_SIGNATURES`,
  `CROMBOLO_BUNDLE_SOURCES` (`config.bundlePolicy`).
- **CLI:** `bundle sign [--public-log]`, `bundle digest`, `bundle verify
  [--require] [--source …]` (a directory, `.tgz`, URL or `name@version`),
  `bundle build --sign`, `bundle deploy --sign`; `bundle list`, `install` and
  `apply` print the signature line.
- **Checked** before anything is written: `checkBundleContent` and
  `installBundleContent` (input `provenance: 'local'` for a site's own content
  files), `start --bundle`, the remote apply (403 `signature-refused`), the
  Marketplace (tarball fetched, sha512 against `dist.integrity`, verified, then
  `bun add` of that exact version), `installFile`. Audit details carry the
  signature line.
- **Shown:** `bundles-signature-words.js` and `bundles-signature.js`; the
  Install panel checks on click through `GET <plugin>/api/bundles/signature`,
  and hides Install when the site would refuse; the Installed view's label and
  Signature row.
- **Ours:** `scripts/publish-packages.ts` signs the two npm bundles in Actions;
  `scripts/release-demo-bundles.ts` builds and signs each distributed demo site;
  the Release workflow attaches them to the GitHub release (`contents: write`)
  and runs `scripts/release-verify-signatures.ts`, which fetches every published
  bundle back and requires a signature from the repository at the tag;
  `publish-brochureware.ts` signs a copy of `demo-crombolo`.
- **Tests:** `tests/provenance.test.ts` (the real chain against the recorded
  root; the checks after it behind the verifier's seam; the policy; the
  commands, including the private-repository refusal),
  `tests/bundle-signatures.test.ts`, `tests/provenance-copy.test.ts`.
- **Docs:** `docs/bundles.md` "Signing a bundle", `docs/configuration.md`, the
  product site's "Signing bundles" guide, release notes.
