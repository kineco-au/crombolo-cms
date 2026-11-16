# 366 — The actor an exchanged token names is in the history

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 364

## Story

As a host whose tools act for a person, I want the site's own history to say which of
my tools it was, so that "who changed this?" reads "Ada, through Acme's console, by
Claude Code on Ada's laptop" rather than just "Ada".

## Context

A person's exchanged token (364) is audited as the person, "signed in through
<provider>". When a host's tool acts for them, an agent for example, the site can't tell
that tool from the person. RFC 8693 §4.1 has a claim for it: `act`, the actor acting for
the token's subject, as `{ sub, ... }`.

## The design

- **The claim:** an exchanged identity token may carry `act: { sub, name? }`. It is
  taken from the provider's own signed token only, after every 364 check passes.
  - `sub` is up to 200 characters; `name` up to 100, with control characters removed.
  - Anything else in `act`, such as a nested `act`, is ignored.
- **The audit:** everything the token does is recorded as the person, through the
  provider, by the actor (`AuditContext.actor`). The back office's history says it
  in those words, and the audit's export gains `actor`.
- **Signed-in devices:** the sign-in reads "Signed in through <provider>, by <name>".
- **Refused:** an `act` that isn't an object, or has no string `sub`, is `invalid_grant`,
  as a malformed token is. A token with no `act` is unchanged.

## Decisions

- **Entra v1 tokens are refused, and say why.** The API app Entra issues tokens for
  issues v1 tokens unless its manifest sets `requestedAccessTokenVersion: 2`; a v1
  token's issuer is `https://sts.windows.net/<tenant>/` and its audience the App ID
  URI, so 364 doesn't recognise it as a person's and it is refused as a CI token. The
  exchange recognises Entra's v1 issuer for an exchanging Entra provider's tenant and
  refuses it as `invalid_grant`, its audit reason naming `requestedAccessTokenVersion`;
  `operations.md` gives the setting in Entra's steps.

- **D1 b: the actor is `act` when the token has one, otherwise the app it was issued
  to.** Entra can't put a value of the host's choosing in its tokens, so it never sends
  `act`; every provider signs `azp` (Entra's v1 `appid`), the client the token was
  issued to. `remoteExchange: { actors: { '<client id>': '<name>' } }` names that
  client; without an entry the history shows the client id. `act` names the instance
  (Claude Code on Ada's laptop) where the provider can add it; `azp` names the app.

- **D2 a: the actor is kept on the signed-in device.** `device_authorization` gains
  `actor_id` and `actor_name` (migration 080). `resolveAccessToken` reads them by
  session for an exchanged token only, and the signed-in devices list shows the name.

- **D3 a: the audit has the actor as a note and as fields.** `detail` reads "signed in
  through Microsoft, by Acme console", so the history page needs no change;
  `audit_entry` gains `actor_id` and `actor_name` (migration 080), and `auditRecord`
  gains `actor: { id, name } | null` for `audit list`, `audit stream` and the remote's
  `audit`. No `--actor` filter: that is a story of its own if it's wanted.

## Threat model

| Threat | Mitigation |
| --- | --- |
| A forged actor | It is inside the provider's signed token, checked as in 364. An actor named anywhere else is never read. |
| An actor claiming more than its person | Nothing reads `act` for permissions; it names who acted, and the person's permissions apply. |
| An actor faked by imitating it in `detail` | The export's `actor` is a field of its own, written only from the device the exchange made. |
| A client id passed off as a name | Names for client ids come from the site's config (`actors`), never the token. |
| Text in the name aimed at the history page | Length-limited, control characters removed, and shown as text, as every audit value is. |

## Acceptance criteria

- [x] An exchanged token with `act` is audited as the person, through the provider, by
      the actor, in the back office's history and its export.
- [x] The person's signed-in devices name the actor.
- [x] A malformed `act` is refused with `invalid_grant`; no `act` changes nothing.
- [x] `docs/remote-protocol.md` (`auth.people`) and `docs/operations.md` describe it.

## Out of scope

- Permissions by actor: what a host's tool may do is the host's to limit.

## Data

- Migration 080 `AddExchangeActor` (release 0.68.0): `actor_id` and `actor_name`,
  varchar(255) and nullable, on `device_authorization` and on `audit_entry`.

## Built

- **The actor:** `actorOf` (`packages/server/src/remote-people.ts`) reads `act` after
  every 364 check, else `azp` or `appid`, and names a client id from
  `remoteExchange.actors` (`RemoteExchangeOptions`, `identity-providers.ts`). A
  malformed `act` is refused.
- **Entra v1:** the exchange recognises `https://sts.windows.net/<tenant>` for an
  exchanging Entra provider's tenant and refuses it, naming
  `requestedAccessTokenVersion`.
- **Kept:** `signInByExchange` writes the actor on the device and into its name;
  `resolveAccessToken` reads it back by session (`DeviceStore.exchangeActor`), for
  exchanged tokens only, as `exchangedActor`.
- **Audit:** `AuditContext.exchange.actor` adds ", by <name>" to the note and fills
  `actor_id` and `actor_name` for the person's entries; `AuditEntryInput.actor` sets it
  directly, as the exchange's own sign-in entry does. `auditRecord` and the CLI's
  record schema gain `actor`.
- **Tests:** `tests/remote-people.test.ts`, "the actor a token names (366)"; the five
  migration rewinds undo 080.
- **Docs:** `remote-protocol.md`, `operations.md` (the manifest setting and `actors`),
  `audit-log.md` and the release notes.

