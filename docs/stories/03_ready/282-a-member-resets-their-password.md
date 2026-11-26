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

## Findings (2026-11-26)

- Member sign-in has no limit per address or per IP, only the account lockout after
  `maxFailedPasswordAttempts` wrong passwords (`member-auth.ts`, `recordFailedLogin`).
- A back-office reset sends a link to the back office's login page (`sendLink` in
  `adapters/users.ts`, tokens in `user_token`). Members have no token table.
- A member with no password today is often one who signs in only through a provider
  (stories 035, 191); a password set here would be a second way in.
- `crombolo members reset-password` (354) sets a password, printed or from `--stdin`.

## Decisions (2026-11-26, the maintainer's)

1. **The link opens a page of the site's own,** named in the config,
   `members.resetPasswordPage: '/account/reset-password'`, drawn with a `render` helper
   (`<ResetPasswordForm />`) as sign-in is. Without it, reset answers that it is unavailable.
2. **The e-mail is in crombolo's words,** naming the site, the link and how long it lasts;
   `members.resetPasswordEmail(member, link)` returns the site's own subject, text and HTML.
3. **A member linked to an identity provider gets no password:** their e-mail says they sign
   in with that provider instead. The page answers as for anyone, never saying whether an
   address is known.
4. **Rate limited per address and per IP, sign-in too,** counted in the database so every node
   shares them, answered 429. Per IP high enough for an office behind one address:
   - asking for a link: 3 an hour per address, 100 an hour per IP;
   - resetting and signing in: 60 a minute per IP;
   - each set in `members.rateLimits`.
5. **A reset also unlocks the account, ends every other session and spends every other link.**
   Two-factor stays on, and the member signs in afterwards with the new password. Audited.
6. **`members reset-password` sends the link** where the site sends mail, or prints it, and
   refuses a provider-only member; `--password` (with `--stdin`) still sets one directly.

Needs a migration: the members' reset tokens and the rate-limit counts. It names the
release it ships in.

## Acceptance criteria

- [ ] `POST /umbraco/members/forgot-password` takes an email, answers the same whether
      or not the address is known, and sends a link to the site's reset page through the
      site's email provider, in crombolo's words or the site's.
- [ ] A member linked to an identity provider is sent no link, and told how they sign in.
- [ ] `POST /umbraco/members/reset-password` takes the token and a new password, and
      works for a member with no password yet; the token is single-use and expires.
      It unlocks the account, ends the member's other sessions and spends their other links.
- [ ] Asking, resetting and signing in are rate limited per address and per IP, across
      nodes, with the limits configurable; a site with no email provider or no reset page
      answers that reset is unavailable; `render` offers `<ResetPasswordForm />` and a
      forgot-password form, as for sign-in.
- [ ] `crombolo members reset-password <member>` sends or prints the link; `--password`
      sets one directly.
- [ ] Documented in `docs/operations.md` and `docs/rendering.md`, with the release notes;
      covering tests on both dialects.
