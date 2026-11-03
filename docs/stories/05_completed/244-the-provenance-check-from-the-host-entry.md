# 244 — The provenance check from the host entry

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** S
**Depends on:** 060

## Story

As a host that installs bundles for other people's sites, I want to check a
bundle's signature with crombolo's own check, from the supported entry, so
that I hold the bundles I install to the same rule the site would, without
reaching into `@crombolo/server`.

## Context

Story `060` checks a bundle's signature wherever the CMS takes one: the
install panel, `bundle install`, `bundle apply`, a remote, `bundle verify`.
A host that installs bundles itself (story `181`, `bundles.md`, "A host that
installs packages") resolves them with its own tooling and puts them on the
nodes, so none of those paths run, and `CROMBOLO_BUNDLE_SIGNATURES` on a node
guards only what the node installs. The host has to check at its own install,
and the check lives in `server/src/provenance.ts`: `verifyProvenance`,
`verifyPackage`, `provenanceProblem` and `describeProvenance`, with
`ProvenancePolicy` and `ProvenanceResult`. `@crombolo/server` is not a
supported entry (`api.md`): `@crombolo/crombolo/host` is, and it is where a
host already finds `validateBundlePackage`, `peerRangeProblem`,
`checkBundleCode` and `installBundleCode` for the same reason.

## Decided

- **Export, do not move.** The functions stay where they are and are
  re-exported from `@crombolo/crombolo/host`, as `createWorker` was for
  `223`: `verifyProvenance`, `verifyPackage`, `provenanceProblem`,
  `describeProvenance`, and the types `ProvenancePolicy`,
  `ProvenanceResult`, `ProvenanceSource`, `ProvenanceLinks`,
  `SignaturePolicy`, `ProvenanceState` and `VerifyProvenanceOptions`. Nothing
  else: signing is a CI job's, and `sourceAllowed` is `provenanceProblem`'s
  own business.
- **The test seam stays internal.** `VerifyProvenanceOptions` on the host entry
  carries `trustedRoot` only; `verifySignature`, which only a test passes,
  moves to an internal option the host's type does not name.
- **The words travel with it.** `describeProvenance` is the sentence a host
  shows (*Signed: built from github.com/org/repo at v1.2.0 (abc1234)*, *Not
  signed*, *Signature not accepted: …*), and `provenanceProblem` the reason
  it refuses with, so every host says what the back office says.
- **"Could not be checked" is a state of its own** (planning, 2026-11-02).
  `verifyProvenance` fetches Sigstore's public root through TUF at most hourly
  and caches it. When it cannot be fetched and nothing is cached, the answer is
  a fifth `ProvenanceState`, **`unchecked`**, with the reason, rather than
  `invalid` (as 060 shipped it) or a throw. A host can retry it, and tell it
  from both "unsigned" and "tampered with" without reading the sentence.
  `provenanceProblem` refuses it under every policy ("could not be checked
  right now; try again"), so nothing installs unchecked, and no caller has to
  catch anything. `describeProvenance` says *Couldn't be checked right now*,
  and so do the install panel, the Installed view and `bundle verify`, which
  exits non-zero. `VerifyProvenanceOptions.trustedRoot` lets a host supply its
  own root.

## Plan

1. `server/src/provenance.ts`: the `unchecked` state, from the trust-root
   failure only; `provenanceProblem` and `describeProvenance` for it; the
   internal seam split from `VerifyProvenanceOptions`. Its callers' switches
   and the plugin's words (`bundles-signature-words.js`, `bundles-signature.js`)
   for the new state.
2. `packages/crombolo/src/host.ts`: the re-exports, with a comment naming
   the story.
3. `docs/api.md`: the host row names the check; a section "The provenance
   check from the host entry (244)" says what each export is for and the
   trust-root behaviour. `docs/api/surface.json` regenerated.
4. `docs/bundles.md`, "A host that installs packages": a bullet, **Checking a
   signature first**, beside the one for `validateBundlePackage`.
5. Tests: the names on the host entry, in `tests/api-surface.test.ts` (or wherever the surface is held)
   or wherever the surface is held; an unreachable trust root is `unchecked`,
   refused under `optional`, and shown in the plugin's words.
6. The release note, with `unchecked` named for anyone matching on states.

## Acceptance criteria

- [x] `import { verifyProvenance, provenanceProblem, describeProvenance } from
      '@crombolo/crombolo/host'` type-checks and behaves as the
      `@crombolo/server` originals, and `docs/api/surface.json` lists them.
- [x] `docs/api.md` and `docs/bundles.md` say a host checks a bundle's
      signature this way, and what happens when the trust root is unreachable.
- [x] An unreachable trust root with nothing cached answers `unchecked`, never
      `invalid` or `unsigned`, and is refused under every policy; the install
      panel, the Installed view and `bundle verify` say it could not be checked
      right now.
- [x] `VerifyProvenanceOptions` from the host entry has no test seam.
- [x] Tests pass on both dialects.

## Out of scope

Signing from a host, reviewed publishers (`061`), and anything about where a
host puts the bundles it checks (`181`).

## Implementation (2026-11-02)

- `server/src/provenance.ts`: `ProvenanceState` gains `unchecked`, answered
  when the trusted root cannot be had (not `invalid`); `provenanceProblem`
  refuses it under every policy, `describeProvenance` says *Couldn't be checked
  right now*. The test seam left `VerifyProvenanceOptions`:
  `verifyProvenanceWith(dir, options, seams)` takes `verifySignature` and
  `publicRoot`, on `@crombolo/server` only.
- `marketplace.ts`: a registry tarball that cannot be fetched, or a check that
  throws, is `unchecked` too; an installed version's `unchecked` answer is not
  cached. `bundles-signature-words.js` and `bundles-marketplace.js`: the
  warning, and Install withheld.
- `packages/crombolo/src/host.ts`: `verifyPackage`, `verifyProvenance`,
  `provenanceProblem`, `describeProvenance` and the seven types;
  `docs/api/surface.json` regenerated.
- Tests: `tests/api-surface.test.ts` through `tests/fixtures/consumers/host.ts`,
  written against the host entry alone; `unchecked` in `tests/provenance.test.ts`
  and `tests/bundle-signatures.test.ts`.
- Docs: `docs/api.md` (the host row and "The provenance check from the host
  entry"), `docs/bundles.md` ("Checking a signature first", and `unchecked`
  under "What a site takes"), release notes.
