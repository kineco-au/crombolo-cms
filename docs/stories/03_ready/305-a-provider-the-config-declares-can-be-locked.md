# 305 — An identity provider the config declares can be locked

**Epic:** D — Members and identity · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As someone who runs back-office sign-in through one identity provider for a reason,
such as a hosting platform that decides who may sign in, I want to declare that
provider locked, so that no administrator can redirect it. And whenever a provider's
issuer does change, I want its secret not to follow it to the new one.

## Context

An administrator may override a declared provider's `issuer`, `clientId`,
`groupMap`, `autoCreate`, `emailsVerified` and more (`OVERRIDABLE`,
`identity-provider-overrides.ts:34`), through a bundle granted identity providers.
The kept client secret, the config's or one stored here, goes with the override:
`apply` puts it on top of whatever issuer is then in force.

So an administrator can point a provider at an issuer they run. Each sign-in then
sends the client secret to that issuer's token endpoint, and the groups claim it
returns decides who is an administrator. A site that relies on one provider to
decide who signs in has no way to prevent this.

## The design

- **`locked: true` on `oidc({...})`.** A locked provider takes no overrides:
  - `update` answers that it is locked, naming the config;
  - any override stored before is ignored, and listed as ignored;
  - the backoffice shows the provider read-only.
- **A changed issuer or client id clears the kept secret,** whether the provider is
  locked or not. Saving an override that changes `issuer` or `clientId` without giving
  a new `clientSecret` is refused: "a new issuer needs its own secret". The config's
  own secret is never sent to an issuer the config didn't name.
- **Audit:** each override saved or reset is audited, with the fields it changed and
  never their secrets.

## Acceptance criteria

- [ ] A provider declared `locked: true` refuses every override, shows read-only, and
      signs in by the config alone, even with an override stored before.
- [ ] An override changing `issuer` or `clientId` without a new secret is refused. With
      one, the old secret is gone.
- [ ] The config's `clientSecret` is never sent to an issuer the config didn't name.
- [ ] Overrides saved and reset appear in the audit log, without secrets.
- [ ] `configuration.md` documents `locked`.
