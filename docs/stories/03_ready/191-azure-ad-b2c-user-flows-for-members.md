# 191 — Azure AD B2C user flows for members

**Epic:** D — Members and identity · **Priority:** should · **Size:** M
**Depends on:** 031

## Story

As a site whose members sign in with Azure AD B2C, I want member sign-in to speak
B2C's user flows, so that members keep the accounts and passwords they have.

## Context

`031` signs members in through OpenID Connect presets, one issuer each, linking a
local member through `external_login`. B2C differs:

- Each **user flow** (sign up or sign in, sign up, edit profile, reset password) is
  its own metadata document (`…/<policy>/v2.0/.well-known/openid-configuration`),
  and the site starts a flow by naming the policy.
- "Forgot password" on the sign-in page returns as an error (`AADB2C90118`) that
  the site turns into the reset flow; cancelling returns `access_denied`.
- Custom attributes arrive as `extension_*` claims the site wants on the member.
- B2C loads page layouts from URLs the site serves.

Raised by a site with hundreds of thousands of members in B2C, with title,
adult, referral source, communication preferences and supporter number as
custom attributes. Microsoft stopped selling B2C to new
customers in May 2025 and supports existing tenants until at least 2030; Entra
External ID succeeds it, so the preset should leave that move to configuration.

## Decided (2026-10-28)

- **A `b2c()` preset on generic flows.** Named flows, and a map from claims to
  member properties, become features of every identity provider.
  `b2c({ tenant, domain?, clientId, clientSecret, flows, properties })` is a
  thin preset that builds the per-policy issuers and adds B2C's
  forgot-password handling. Entra External ID can later be another thin
  preset.
- **A mapped property the member type lacks refuses the boot,** naming the
  provider, the claim and the property. A claim absent from a token leaves its
  property as it is.
- **Sign-out remembers the provider.** The member's session cookie records
  which provider signed them in. Logout clears the site session, then
  redirects to that flow's `end_session_endpoint` and back. A session cookie
  without the field is still valid.

## Plan (2026-10-28)

Built on 031: `OidcClient` (`auth/src/oidc.ts`), `createExternalSignIn`
(`server/src/external-sign-in.ts`), member creation in `member-auth.ts`, and
the fake issuer in `tests/support/fake-oidc.ts`.

1. **Flows.**
   - `IdentityProvider` gains `flows: Record<string, OidcProviderOptions>`.
     `signIn` is the default, and the others are `signUp`, `resetPassword`
     and `editProfile`. Each flow has its own issuer, discovery and keys, and
     one cached client per flow.
   - The flow's name rides in the signed flow state, so the callback finishes
     against the flow it started.
   - `GET {base}/{id}?flow=<name>&returnUrl=…`, and
     `externalSignInUrl(id, returnUrl, { flow })` for views. An unknown flow is
     a 404.
2. **Errors.**
   - An `error_description` beginning `AADB2C90118` starts `resetPassword`,
     keeping the return URL.
   - `access_denied` goes to `cancelUrl`, and any other failure to
     `failedUrl`, both provider options. Without them, today's behaviour stays:
     the return URL with `memberLoginFailed` and the reason.
3. **Claims.**
   - An array claim reads as its first value: B2C sends `emails`.
   - `subjectClaim` sets which claim is the subject: `sub` by default, `oid`
     when a tenant needs it. The link is always by the subject.
   - `b2c()` defaults its scopes to `openid`, its domain to
     `<tenant>.b2clogin.com` (a custom domain is allowed), and its issuer to
     `https://<domain>/<tenant>/<policy>/v2.0`.
   - `linkByEmail` stays off unless the site sets it.
4. **Properties.**
   - `properties: { <member property alias>: <claim> }` on any member
     provider. It writes those values when a member is created, and on every
     sign-in, profile edit and reset after it.
   - A value is written only when it changed, through `MemberRepository.update`
     with the member's identity unchanged.
   - It is checked at boot against the member type in `schema/`.
5. **Sign-out.**
   - `MemberTicket` gains an optional `via` (the provider id).
   - `POST /umbraco/members/logout` clears the cookie, then redirects to the
     provider's `end_session_endpoint` with `post_logout_redirect_uri` and
     `p=<sign-in policy>`.
   - A JSON caller gets the URL as `signOutUrl`, to follow itself.
   - The redirect is skipped when the provider publishes no endpoint.
6. **Tests.**
   - The fake issuer serves per-policy metadata and keys, error callbacks and
     an end-session endpoint.
   - The cases:
     - sign-in;
     - forgot password, then reset, then signed in;
     - cancel to `cancelUrl`;
     - a profile edit updating properties;
     - properties mapped on every sign-in;
     - an unknown property refusing the boot;
     - linking by object id even when the e-mail matches another member;
     - sign-out through the end-session endpoint;
     - a ticket without `via` still valid.
7. **Docs.** `docs/operations.md` gets a B2C section: the app registration,
   the redirect and sign-out URLs, the flows, the claim mapping, and the move
   to Entra External ID.

**Out of scope:**
- B2C page layouts: the site serves them.
- Back-office overrides of a provider's policies. The client id and secret
  overrides from 033 still apply.

## Acceptance criteria

- [ ] One B2C sign-in for members with several flows, each started by name from a
      link or a template helper.
- [ ] The forgot-password error starts the reset flow; cancel and failure return
      to a page the site names.
- [ ] Mapped claims update member properties on every sign-in.
- [ ] A member is linked by the B2C object id, never matched by e-mail unless the
      provider is configured to trust it (as `031`'s link-by-verified-email).
- [ ] Sign-out ends the site session and B2C's.
- [ ] Tested against a fake B2C issuer serving per-policy metadata.
