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

- [x] A provider declared `locked: true` refuses every override, shows read-only, and
      signs in by the config alone, even with an override stored before.
- [x] An override changing `issuer` or `clientId` without a new secret is refused. With
      one, the old secret is gone.
- [x] The config's `clientSecret` is never sent to an issuer the config didn't name.
- [x] Overrides saved and reset appear in the audit log, without secrets.
- [x] `configuration.md` documents `locked`.

## Decisions (2026-11-11)

- **Locked from the config or from the server's environment.** `locked: true` on
  `oidc({...})` or `entra({...})` (on `IdentityProviderOptions`, so every preset takes it),
  and `CROMBOLO_LOCKED_IDENTITY_PROVIDERS`: provider ids separated by commas, or `all`. A
  host locks a provider without touching the site's code, as `CROMBOLO_UNRESTRICTED_EXTENSIONS`
  lets it decide about extensions. Either one locks; neither can unlock what the other
  locked. An id locks that provider for members and for the back office alike.
- **Reset still works on a locked provider.** It only puts the provider back to the
  config, and it is how an administrator clears overrides the lock now ignores.
- **A kept secret is bound to the issuer and client id it was set for**, as story 304
  binds a secret header to its URL. It is used only while the provider still has those;
  the config's secret only while the provider has the config's own. A provider left with
  neither, when the config gave it a secret, does not offer sign-in, and the log says why,
  rather than sending a sign-in to its token endpoint without one.
- **An override from before the upgrade:**
  - a kept secret without a binding is taken as bound to the issuer and client id in force
    when the upgraded CMS first reads it, which is the one it was set with;
  - an issuer or client id changed here without a kept secret no longer gets the config's
    secret, so that provider stops offering sign-in until an administrator sets one. The
    boot logs each such provider, and the upgrade notes say what to do.

## Implementation plan

1. **The lock** (`identity-providers.ts`, `config.ts`, `settings.ts`):
   - `locked?: boolean` on `IdentityProviderOptions`, carried on `IdentityProvider`.
   - `lockedIdentityProviders: readonly string[] | 'all'` from
     `CROMBOLO_LOCKED_IDENTITY_PROVIDERS`, listed in `settings.ts`; an id that names no
     declared provider is a config warning, not an error.
   - A pure `lockOf(provider, setting)` → `'config' | 'environment' | undefined`.
2. **Overrides** (`identity-provider-overrides.ts`):
   - `apply`: a locked provider is the config's, whatever is stored.
   - `Stored` gains `secretFor?: { issuer: string; clientId: string }`, written with every
     sealed secret. `effectiveProvider` takes the secret by the binding, as above, and
     answers `missingSecret: true` when the config had one and the provider is left
     without; sign-in (`member-auth.ts`, `server.ts`) leaves such a provider off its
     buttons and logs it once per boot.
   - `update` on a locked provider is refused: "<name> is locked by the site's
     configuration" or "…by the server's CROMBOLO_LOCKED_IDENTITY_PROVIDERS". On an
     unlocked one, a change that moves the issuer (`issuer`, or `tenantId` for Entra) or
     the `clientId` away from what the kept secret is bound to, without a new
     `clientSecret` in the same save, is refused: "A new issuer needs its own secret."
     A change back to the config's own values drops the kept secret, and the config's
     applies again.
3. **What a bundle sees** (`BundleIdentityProvider`): `locked: 'config' | 'environment' |
   null`, `ignored: string[]` (overrides stored but not applied), and `missingSecret`.
4. **Audit:** `update` and `reset` record "Identity provider" entries naming the provider
   and audience, the fields changed, and "client secret set" or "cleared", never a value,
   attributed to the person and the extension as story 325's entries are.
5. **Entra's screen** (`packages/entra/src/server/index.ts`): a locked provider shows every
   field read-only, with a hint saying who locked it ("Locked by the site's configuration"
   or "Locked by the server's settings"), no Save, and a Reset only when overrides are
   ignored, listing them. A provider missing its secret says so at the top.
6. **Docs:** `configuration.md` documents `locked` and the env var; the identity provider
   docs gain "Locking a provider" and "Where a kept secret goes". Release notes: the
   feature, and the upgrade note for issuer overrides without their own secret.

## Tests

- **Unit** (`tests/identity-provider-overrides.test.ts`, new): `lockOf` for config, env
  list, `all` and neither; `effectiveProvider` with a bound secret for the issuer in
  force, for another issuer, an unbound legacy secret, and the config's secret with a
  changed issuer (none sent, `missingSecret`).
- **Server** (`tests/external-sign-in.test.ts`): a locked provider with an override stored
  before signs in by the config against the fake OIDC server; with the env var set the
  same. A changed issuer without a kept secret is not offered, and the fake issuer
  receives no secret.
- **Bundle** (`tests/entra-bundle.test.ts`): `update` on a locked provider is refused;
  changing the issuer without a secret is refused, with one succeeds and the old secret
  is gone; reset on a locked provider clears the ignored overrides; the screen is
  read-only when locked; update and reset leave audit entries without secrets.

## Implemented (unreleased, for 0.62.0)

- **The lock:** `locked?: boolean` on `IdentityProviderOptions`, carried as `locked` on
  `IdentityProvider`; `CROMBOLO_LOCKED_IDENTITY_PROVIDERS` → `config.lockedIdentityProviders`
  (`readonly string[] | 'all'`); `lockOf(provider, setting)` in `identity-providers.ts`.
  `IdentityProviderOverrides` takes the setting: `apply` answers the config's provider for a
  locked one, `update` refuses it, naming the config or the server's setting. The boot warns
  of a locked id the config does not declare.
- **The secret's binding:** a kept secret is stored with `secretFor: { issuer, clientId }`.
  `effectiveProvider` sends it only there, and the config's secret only to the config's own
  issuer and client id; left with neither when the config had one, the provider carries
  `unavailable` with the reason. `update` now takes the declared provider, refuses a change
  of issuer, Entra tenant or client id without a new secret ("A new issuer needs its own
  secret…"), drops the kept secret when they go back to the config's, and answers the
  fields changed. A secret from before 305 is taken as bound to where the provider sends now.
- **Sign-in** (`external-sign-in.ts`): an unavailable provider's start and callback redirect
  to the audience's failure with "<name> sign-in is not available right now. Ask an
  administrator.", and log the reason; the boot logs each such provider too. The buttons
  stay listed, since listing them is synchronous; pressing one says why it does not work.
- **What an extension sees:** `BundleIdentityProvider` gains `locked`, `ignored` and
  `missingSecret`; `overridden` is empty while locked, the stored fields listed under
  `ignored`. Reset works on a locked provider.
- **Audit:** the `identityProviders` capability is built per caller (`callerHost` in
  `core.ts`), so `update` and `reset` record "identity provider changed" (the fields, and
  "client secret set" or "cleared") and "identity provider reset" under Settings, as the
  person, with "<Extension>, for <person>" (story 325's attribution).
- **Entra's screen:** a locked provider is read-only, every field hinting who locked it,
  with no Save and a "Clear the changes it ignores" while it ignores some; a provider
  missing its secret shows a problem at the top of its tab and says so on the secret field.
- **Docs:** `operations.md` ("Locking a provider", "Where a secret goes"),
  `configuration.md` (the setting, `locked`), release notes with the upgrade note.
- **Tests:** new `identity-provider-overrides.test.ts` (`lockOf`, the binding, the
  capability's refusals, ignored changes, reset and audit); `external-sign-in.test.ts`
  (locked by config, by id and `all` sign in by the config; an unnamed issuer with no
  secret is not available; a changed client id needs its secret); `entra-bundle.test.ts`
  moved to the new signature, and a new tenant now comes with its secret.

