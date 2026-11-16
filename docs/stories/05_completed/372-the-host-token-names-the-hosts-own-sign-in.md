# 372 — The host token names the host's own sign-in

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** S
**Depends on:** 178, 305, 364

> **Security sensitive.** A host acts on this claim as the person it names. Read the
> threat model below again before merging.

## Story

As a host that signs people in to a site's back office through its own provider, I want
the host token to say who the person is at that provider, so that my service can act for
the person it already knows, rather than only for a user key that exists on one site.

## Context

- **The host token (178)** names the back-office user by their key, with their name,
  groups and sections. The key is the site's own: a host running many sites can't tell
  from it which of its own people is asking.
- **The host already knows the person.** A host that signs people in to the back office
  through its provider (031) holds the same subject the site linked them by
  (`external_login`, recorded per 364's D2).
- **Back-office tools can't be tied to a person.** A host tool that does work for that
  person on the host's side (runs tasks as them, keeps their settings, charges their
  usage) has no way to connect the two today, short of asking them to sign in to the host
  again from inside the back office.

## The design

- **Configured:** `defineConfig({ host: { origin, signingKey, keyId, provider } })`.
  `provider` is the id of a back-office identity provider the config declares.
- **The site refuses to start when `provider`:**
  - names no declared provider;
  - names a provider that isn't locked (305). An administrator able to re-point it could
    otherwise link people to another issuer's subjects.
- **The claim:** `host_sub`, the identifying value recorded on the user's
  `external_login` row for that provider (`sub`, or `oid` for Entra, per 364's D2).
  - It is issued only when the row's recorded issuer is the provider's issuer.
  - It is left out when the user has no link to the provider, or the link has no
    recorded value yet. The rest of the token is unchanged.
- **D1 a: and `host_iss`,** the provider's issuer, beside `host_sub`: Entra's `oid` is
  unique only within a tenant, so a host serving several tenants or providers needs the
  issuer to know whose subject it is.
- **Without `provider`:** nothing changes.
- **Docs:** `docs/bundles.md` (host tokens), and `docs/operations.md` (configuring a
  host).

## Threat model

| Threat | Answer |
| --- | --- |
| A back-office administrator links a user to someone else's subject | A link is made only by signing in through the provider (031), from a verified ID token, or by `linkByEmail` at that sign-in. Nothing in the back office or the Management API sets another user's provider key. |
| An administrator re-points the provider at an issuer they control | Refused: `provider` must be locked (305), and the claim needs the recorded issuer to match. |
| A token for one site is replayed to the host as another | Unchanged from 178: the `kid` names the installation, and the audience is the host's origin. |
| A link recorded before 364 | It has no value, so no claim, until the person next signs in through the provider. |
| A site's deployer, or code running in the site, signs a token naming someone from another site | The installation's key is in its config, so whoever holds it can sign any `host_sub`. The host accepts `host_sub` only from an installation (`kid`) that person is allowed into: the claim says who, the host decides whether this installation may speak for them. The docs say so first. |

## Acceptance criteria

- [x] **A user linked to the host's provider** gets `host_sub` in their host token, with
      the value the link recorded, and `host_iss`, the provider's issuer.
- [x] **No claim** for an unlinked user, a link with no recorded value, or one whose
      issuer differs.
- [x] **The site refuses to start** when `host.provider` is unknown or not locked.
- [x] **Docs** say how a host uses the claim, that it trusts it only from an installation
      the person may use, and why the provider must be locked.
- [x] **Tests.**

## Built

- **Config and boot:** `HostConfig.provider` (`host-token.ts`); `checkHost` refuses a
  provider the config doesn't declare, or one neither the config nor
  `CROMBOLO_LOCKED_IDENTITY_PROVIDERS` locks (`lockOf`).
- **The claims:** `hostIdentityOf` in `server.ts` reads the person's link to that
  provider (`ExternalLoginRepository.forOwner`) and passes `host_sub` and `host_iss`
  to `issueHostToken` only when the link holds a value recorded from the provider's
  issuer.
- **Tests:** `tests/host-token.test.ts`, "the person at the host's own provider (372)".
- **Docs:** `bundles.md` ("Tools a host provides"), `operations.md` and the release notes.

