# 364 — A person signed in through a provider reaches the remote

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 160

> **Security critical.** It decides who a token from outside the site may act as. The
> threat model below was reviewed in planning; read it again before merging.

## Story

As a host that signs people in to a site's back office through its own OpenID Connect
provider, I want to exchange that provider's identity token for a remote token that acts
as the same person, so that the remote's person-only routes (`content-history`,
`members`, `users`, `background-jobs`, `media-library` and the rest) work for someone the
host has signed in, with the site verifying who they are itself.

## Context

Two pieces already exist and are not yet joined:

- **Back-office sign-in through a provider (031).** A site's `backofficeIdentityProviders`
  sign people in by OIDC. The ID token is verified against the provider's published keys,
  the person is found by their `external_login` row (provider and subject), and the
  provider's `groups` map is made to match on every sign-in.
- **Token exchange (160).** The remote's `/token` takes a CI job's identity token by
  RFC 8693, checks its signature, issuer, audience, lifetime and `jti`, and issues a
  15-minute bearer token. That token acts as a trust rule, never a person, which is why
  every route added by 353–362 refuses it.

A host that signs people in can sign them in to the back office already, but its own
tooling cannot reach those routes as them. The device grant needs the person at the
site's back office, and a host's own console may be where they actually are. Trusting
an assertion from the host over a private channel would give the site a second way to
decide who someone is. This story reuses the first: the same provider, keys and lookup.

## The design

Decisions taken in planning (2026-11-16) are marked D1–D5.

- **Opt in per provider:** `remoteExchange: true`, or `remoteExchange: { audience }`, on a
  back-office provider (any preset) lets it be exchanged. Off by default.
  `CROMBOLO_REMOTE_EXCHANGE_PROVIDERS` names providers by id from the server. The opt-in
  comes from the config and the server alone, never from settings the back office
  stores, and the boot says which providers exchange.
- **D1 — the audience tells the tokens apart.** A token is exchanged only when its `aud`
  is the audience the provider names: the site's origin by default, or another value such
  as an Entra API app's client id. The site refuses to start when that audience is the
  client id of any of its back-office providers, so a sign-in ID token can never be
  exchanged. Entra issues v2 tokens with the API's client id as `aud`, so a host using
  Entra registers a separate API app and names its client id as the audience.
- **D2 — who the person is.** Each preset names the claim that identifies a person: `oid`
  for Entra (whose `sub` differs per app registration), `sub` for the others. Sign-in
  records that value, with the issuer it came from, on the person's `external_login` row
  beside the `sub` it keys on. The exchange finds the person by provider, issuer and that
  value. A link made before this story has no value until its next back-office sign-in;
  until then its exchanges are refused, and the audit says why. `linkByEmail` and
  `groups` apply as at sign-in.
- **D5 — no account is made by an exchange.** `autoCreate` does not apply: someone with no
  account signs in to the back office once first, so a host's tool never creates a user.
- **D3 — the provider as sign-in has it.** The exchange uses the effective provider, with
  an administrator's overrides (033) on top, exactly as sign-in does: issuer, tenant,
  group map, `autoCreate`, `linkByEmail`. An administrator gains nothing new, since one who
  re-points the issuer can already sign in as anyone linked to it. A host that needs the
  provider fixed locks it (305).
- **The exchange** is the same endpoint and grant as 160. A token whose `iss` is an
  opted-in provider's issuer is checked as 160 checks a CI token, except that:
  - its one-time id is `jti`, or Entra's `uti`, and is required;
  - it may be valid for at most 90 minutes (Entra's tokens last at least 10, by default
    60–90), and its one-time id is kept until it expires;
  - it is refused if it carries a `nonce`, which only a sign-in ID token has;
  - the person is refused if disabled, locked out, or without back-office access.
- **D4 — the token is a device sign-in.** The exchange records a signed-in device for the
  person, named for the provider ("Signed in through Microsoft"), with a session and a
  15-minute access token and no refresh token. It works wherever a device-grant token
  works, the back-office API included. It is listed under the person's signed-in
  devices, and signing it out there, or disabling or locking the person, ends it at once.
- **What it may not do,** as a machine-held credential (the principal carries
  `viaExchange: { provider }`):
  - decide an approval, in the back office or the remote;
  - make anything that outlives it: a command-line token, an API key, or approve another
    device's sign-in;
  - change how the person signs in: password, two-factor, external logins;
  - start viewing as another group.
- **The audit** records each exchange, accepted or refused, with the provider and reason.
  Everything the token does is audited as the person, noting it came by exchange through
  that provider.

## Threat model (reviewed 2026-11-16, with D1–D4)

| Threat | Mitigation |
| --- | --- |
| A forged token | Signature checked against the effective issuer's published keys, asymmetric algorithms only; `iss` an opted-in provider's; `exp`, `nbf`, `iat` current; at most 90 minutes' lifetime. |
| A sign-in ID token exchanged | `aud` must be the exchange audience, which the boot refuses to let equal any back-office provider's client id; a token with a `nonce` is refused. |
| An ID token for the API app itself exchanged | Its `aud` is the API app's id, so the audience check alone would pass. Refused by its `nonce`; the docs say the API app must not be used for sign-in. |
| An exchange token used to sign in | Sign-in requires its own client id as `aud` and its own `nonce`; this token has neither. |
| A token replayed | `jti` or `uti` required and accepted once, kept until the token expires. |
| A token stolen before the host uses it | **Residual, wider than the story's:** valid up to 90 minutes rather than 5. Single use means a token the host has exchanged is spent; one taken before that can be exchanged once. Hosts are told to exchange at once and never log it. |
| The wrong person found | By the provider's identifying claim (`oid` for Entra), with the issuer it was recorded from; never by email unless `linkByEmail` and a verified email allow it, as at sign-in. A link with no recorded value is refused, never guessed. |
| A host's tool creating back-office users (D5) | An exchange never creates an account; it only finds one already linked, or by email where `linkByEmail` allows. |
| A provider that should not grant remote access | Off unless the config or the server opts it in. |
| An administrator turning off a host's exchange | The opt-in isn't a stored setting. |
| An administrator re-pointing the provider (D3) | Possible on an unlocked provider, as it is for sign-in; no new power. Locking (305) prevents it; `docs/operations.md` says a host that relies on the exchange should lock. |
| Someone removed upstream | The provider stops minting their tokens; what was issued ends within 15 minutes. Disabling or locking them on the site ends it at once. |
| A token reaching the whole back-office API (D4) | Accepted: it is the person with their own permissions, for 15 minutes, as a device sign-in is. The refusals below stop it outliving itself or taking over the account. |
| A 15-minute token turned into a lasting one | Refused: making command-line tokens or API keys, approving another device. |
| The account taken over | Refused: changing the password, two-factor or external logins. |
| A machine approving | Refused in the back office and the remote, as for CI and command-line tokens. |
| Groups lost to an Entra overage claim | As at sign-in: a token whose groups claim is missing makes the mapped groups match nothing. Hosts with large tenants map app roles instead, as `docs/operations.md` already advises for sign-in. |
| Brute force | Rate-limited per address and per issuer, as 160's exchange is. |
| Secrets in logs | Neither token is printed, logged or put in an error, as in 160. |
| Discovery naming the providers | It lists provider ids and issuers, as `auth.ci` lists CI issuers; an Entra issuer names the tenant, which is not a secret. |

## Data

One migration: `external_login` gains the identifying value and the issuer it came from;
a table of spent one-time ids (issuer, id, expiry), swept once they expire. An exchanged
sign-in is a `device_authorization` row whose client id is `crombolo-exchange:<provider>`,
which names the provider with no column of its own. Undone in every test rewind helper.

## Acceptance criteria

- [x] A provider exchanges only when it opts in; discovery lists it under `auth.people`
      with its audience.
- [x] The opt-in is read from the config and the server only; nothing the back office
      stores turns it on or off.
- [x] The boot refuses an exchange audience equal to a back-office provider's client id.
- [x] A token with the wrong `aud`, a `nonce`, no `jti` or `uti`, one seen before, or a
      lifetime over 90 minutes, is refused with `invalid_grant` and nothing more.
- [x] Sign-in records the provider's identifying claim; an exchanged token acts as the
      person it finds, with their groups matched to the claim, and is refused for a
      disabled or locked-out person, or a link with no recorded value; an exchange for
      someone with no account is refused, whatever `autoCreate` says.
- [x] An administrator's override to the provider applies to the exchange as to sign-in.
- [x] Every person-only remote route and the back-office API accept it; approvals,
      command-line tokens, API keys, device approval, password, two-factor, external
      logins and viewing as refuse it.
- [x] Exchanges and what the token does are audited as the person, naming the provider.
- [x] It appears under the person's signed-in devices, and signing it out there ends it.
- [x] `@crombolo/remote-conformance` checks the exchange where discovery offers
      `auth.people`, given a token the test can mint.
- [x] `docs/remote-protocol.md` and `docs/operations.md` describe it, with Entra's setup.

## Out of scope

- An issuer that is not one of the site's own back-office providers.
- Exchanging for a member rather than a back-office user.

## Built

Built 2026-11-16:
- the options are `remoteExchange` on `IdentityProviderOptions` and `claims.identity` on
  `OidcClaims` (`packages/server/src/identity-providers.ts`, `packages/auth/src/oidc.ts`);
  `entra()` sets `identity: 'oid'`. `exchangingProviders` and `exchangeAudienceClashes`
  are there too, and `loadConfig` throws a clash. `CROMBOLO_REMOTE_EXCHANGE_PROVIDERS` is
  `remoteExchangeProviders` on `CromboloConfig`, in the settings registry;
- migration 079 is `packages/data/src/schema/remote-exchange.ts` (release 0.67.0). The
  link's identity is read and written by `ExternalLoginRepository` (`findByIdentity`,
  `recordIdentity`, and `link`'s fourth argument), and the spent ids by
  `RemoteExchangeIds` (`packages/data/src/repositories/remote-exchange-ids.ts`). A
  provider sign-in records the identity in `createExternalSignIn`, on a link, a new
  account, or a sign-in whose recorded value differs;
- the exchange is `createPeopleExchange` in `packages/server/src/remote-people.ts`. The
  remote's `/token` sends a token there when its unverified `iss` is an exchanging
  provider's effective issuer, and to CI's exchange otherwise. `issuerKeys` and
  `unverifiedIssuer` in `remote-ci.ts` are shared by both. `server.ts` builds it with the
  back-office audience's account lookups, the overrides of story 033, and the audit
  actions `RemoteExchangeSignIn` and `RemoteExchangeSignInRefused`;
- the sign-in is `AuthService.signInByExchange` and `DeviceStore.signedInByExchange`
  (`packages/auth`): a `device_authorization` row already issued, a session, and an access
  token for the client `crombolo-exchange:<provider>` with no refresh token.
  `resolveAccessToken` sets `exchangedThrough` from that client id, and `principalOf`
  turns it into `Principal.viaExchange`;
- the refusals: `refuseUnattended` in `approvals.ts` and the remote's `decide`
  (`exchange-cannot-approve`); `EXCHANGE_REFUSED_OPERATIONS` in
  `packages/api-management/src/authorization.ts` (passwords, password resets, two-factor,
  API keys); making a command-line token in `cli-tokens-api.ts`; and view-as in
  `server.ts`. Approving another device needs the back office's session cookie, which an
  exchanged token does not carry;
- the audit note is `AuditContext.exchange` in `packages/data/src/audit.ts`, "signed in
  through <provider>";
- the conformance suite checks `auth.people` and the refusal of an unsigned token, and,
  given `personToken`, a sign-in and its replay;
- tests: `tests/remote-people.test.ts`, a sign-in recording its identity in
  `tests/external-sign-in.test.ts`, and the exchange's checks in
  `tests/remote-conformance.test.ts`.
