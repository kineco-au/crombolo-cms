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

Raised by Nature's Calendar (`wt-natures-calendar` story 017): over 400,000
members in B2C, with title, adult, referral source, communication preferences and
supporter number as custom attributes. Microsoft stopped selling B2C to new
customers in May 2025 and supports existing tenants until at least 2030; Entra
External ID succeeds it, so the preset should leave that move to configuration.

## Decisions before implementation

- **A `b2c()` preset, or options on `oidc()`.** A preset reads better and carries
  the error handling; `oidc()` options would serve other multi-flow providers.
- **Claims to member properties.** A mapping in config, applied on every sign-in,
  and what happens when a mapped property does not exist on the member type.
- **Edit profile.** A flow the member starts from the site, whose returned claims
  update the member, so no outbound sync to B2C is needed.

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
