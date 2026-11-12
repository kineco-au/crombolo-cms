# 340 — E-mail is set up in Settings, and takes effect at once

**Epic:** E — Cross-cutting · **Priority:** should · **Size:** M
**Depends on:** 045

## Story

As an administrator of a site with no e-mail set up, I want to choose a provider and
its key in Settings, so that invitations, password resets, notifications and form
e-mails work without anyone editing the server's environment and restarting it.

## Context

E-mail is configured only by `CROMBOLO_EMAIL_*` or `email` in `crombolo.config.ts`
(story 045), resolved once at boot. Every feature that needs it asks that boot-time
answer, so nothing changes without a restart, and the Settings page carries a banner
saying e-mail is not set up, with a hint naming environment variables.

## The design

- **Settings → Site → E-mail.** A card that shows the provider in use and sets
  one: Resend, Postmark, Amazon SES or a custom endpoint, the sender address and name,
  and the provider's key. The card carries a warning mark while e-mail is not set up;
  the page-level banner goes.
- **The config wins.** When `email` in the config or `CROMBOLO_EMAIL_PROVIDER` sets
  e-mail (`none` included, as "off"), the card shows it read-only, says the server
  sets it, and saving is refused. Whoever controls e-mail controls where password-reset
  links go, so a host's choice can't be redirected from the back office.
- **Kept in `key_value`** (`crombolo:email`), no migration. The key is sealed with
  `CROMBOLO_SECRET_KEY`; without one the card can't keep a key. A kept key is bound to
  the provider and address it was entered for (as story 305 binds a client secret):
  changing either needs the key entered again.
- **At once, everywhere.** The features ask whether e-mail is set up each time, not
  at boot: the node that saved it at once, other nodes within 30 seconds.
- **Send a test** to the signed-in administrator's address.
- **Audited**: saved and cleared, never with the key.

## Acceptance criteria

- [x] An administrator sets e-mail on the card; invitations, password reset,
      notifications and form e-mails work at once, with no restart.
- [x] With e-mail in the config, the card is read-only and a save is refused.
- [x] The key is sealed, never returned, and only used with the provider and address
      it was entered for.
- [x] The card is marked while e-mail is not set up; the page banner is gone.
- [x] Saving and clearing are audited without the key.
- [x] `configuration.md` documents the card and the precedence.

## Built (2026-11-12)

- `packages/server/src/email-settings.ts`: `configuredEmail` (the config wins), `siteEmail`
  (the live port: re-reads `key_value` when older than 30 seconds, `refresh` on save) and
  `createEmailSettings` (view, save, clear, test). Stored settings go through
  `emailFromEnvironment`, so they're checked as the environment's are.
- `EmailProvider` gains `none`, and `emailReady` replaces truthiness: notifications, the
  document port, form workflows, approvals, user links and password reset ask at the time.
- `/crombolo/api/email/settings` (GET, PUT, DELETE) and `/crombolo/api/email/test` (POST),
  administrators only. `/crombolo/api/email` answers per request.
- Plugin: `email-settings.js` and `email-settings-words.js`; the card's warning mark in
  `settings-card.js`; the Settings banner removed.
- Tests: `tests/email-settings.test.ts`, `tests/email-settings-words.test.ts`.
