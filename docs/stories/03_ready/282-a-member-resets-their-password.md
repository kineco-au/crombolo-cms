# 282 — A member resets their password

**Epic:** D — Members and identity · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a member of a site, I want to ask for a link that sets a new password, so that a
forgotten password, or an account that never had one, does not lock me out.

## Context

`member-auth.ts` answers login, logout, register and the second factor. A back-office
user can reset a password; a member cannot, and a site has to build it. An account
with no password, invited or brought from elsewhere, has no way in at all.

## Acceptance criteria

- [ ] `POST /umbraco/members/forgot-password` takes an email, answers the same whether
      or not the address is known, and sends a link through the site's email provider.
- [ ] `POST /umbraco/members/reset-password` takes the token and a new password, and
      works for a member with no password yet; the token is single-use and expires.
- [ ] Both are rate limited as sign-in is; a site with no email provider answers that
      reset is unavailable, and `render` offers helpers as for sign-in.
- [ ] Documented in `docs/operations.md`, with covering tests on both dialects.
