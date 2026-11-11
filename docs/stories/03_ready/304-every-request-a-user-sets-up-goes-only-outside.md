# 304 — Every request a user sets up goes only outside

**Epic:** I — Hardening · **Priority:** should · **Size:** S
**Depends on:** 301

## Story

As someone running a site, I want every request my users can point somewhere to
follow webhooks' rules, so that a form or a settings screen can't be used to reach
the server's own network.

## Context

`301` gives webhook deliveries an address rule (no loopback, private or link-local
address, checked at the address actually connected to), the `env:` rule for headers,
and a short delivery log. Other requests a user can point somewhere have none of
this:
- **A form's send-to-URL workflow** (`sendToUrl`, `form-workflows.ts:439`). Anyone
  who manages forms (Editors, by default) sets its URL and headers; any visitor
  sets it off by submitting. It takes any scheme, POST or PUT, and follows redirects.
- **An identity provider's test** (`identity-provider-overrides.ts:274`). It GETs
  `<issuer>/.well-known/openid-configuration` and says what came back, its status and
  parse error included. A Settings user sets it off, against an issuer an
  administrator may have changed.

## The design

- **One outbound rule**, the one `301` makes, used by all three: webhooks, the forms
  workflow, and the provider test. It covers addresses resolved and connected to as
  checked, and one setting, `CROMBOLO_ALLOW_PRIVATE_ADDRESSES`, for development and
  intranets.
- **The forms workflow:**
  - `https://` and `http://` only;
  - redirects not followed: a 3xx is the receiver's answer;
  - headers sent as written: a form names no server variable;
  - a refused address fails the entry's workflow without retrying, saying why.
- **The provider test** answers only reachable, not reachable or not a discovery
  document, with the issuer. It never says the status or what the body held.

## Acceptance criteria

- [ ] A send-to-URL workflow pointing at `127.0.0.1`, `10.0.0.1` or `169.254.169.254`,
      or at a host resolving to one, sends nothing, and the entry's workflow log says why.
- [ ] A workflow's 302 is not followed.
- [ ] A `file:`, `ftp:` or `data:` URL is refused on save.
- [ ] A workflow header `env:NAME` is sent as written, never as the server's variable.
- [ ] `CROMBOLO_ALLOW_PRIVATE_ADDRESSES=true` lets all three reach a private address;
      `webhooks.allowPrivateAddresses` is gone.
- [ ] The provider test refuses the same addresses, and its message never includes
      a status code or body text.
- [ ] `forms.md` documents the rule.

## Decisions (2026-11-11)

- **One setting for all three, in the environment.** `CROMBOLO_ALLOW_PRIVATE_ADDRESSES`
  (config `allowPrivateAddresses`) lets webhooks, the forms workflow and the provider test
  reach loopback, private and link-local addresses. The protection is on by default: unset,
  they are refused. A development site (`config.development`) allows them, as webhooks do
  today, so a local receiver still works.
- **`webhooks.allowPrivateAddresses` is replaced**, not kept as an alias. A config that
  still sets it fails the config check naming the new setting, and the release notes say
  to switch. `webhooks.headerVariables` stays, as webhooks' alone.
- **A form's headers stay literal.** Forms get no `env:`: a header is sent exactly as
  written, so a form cannot send a server variable at all, and there is nothing for
  `301`'s `env:` rule to hold.

## Implementation plan

1. **The setting** (`config.ts`, `settings.ts`, `core.ts`, `outbound-address.ts`):
   - `allowPrivateAddresses: boolean` on the resolved config, from
     `CROMBOLO_ALLOW_PRIVATE_ADDRESSES` (`true`/`false`), defaulting to `config.development`.
     Listed in `settings.ts` beside the other `CROMBOLO_` settings.
   - `webhooks?: { headerVariables? }` only; a config with `webhooks.allowPrivateAddresses`
     is a config problem: "webhooks.allowPrivateAddresses is now
     CROMBOLO_ALLOW_PRIVATE_ADDRESSES, which covers forms and identity providers too."
   - `core.ts` passes the one value to webhooks, bundle event `fetch`, the forms workflow
     deps and the identity provider test.
   - `checkedAddress`'s refusal names `CROMBOLO_ALLOW_PRIVATE_ADDRESSES`.
2. **The forms workflow** (`form-workflows.ts`, `validate-forms.ts`, the forms save path):
   - `sendToUrl` goes through `pinnedFetch` with `WorkflowDeps.outbound`
     (`{ allowPrivateAddresses, lookup?, fetch? }`), so redirects are not followed and a
     3xx is the receiver's answer, failed and not retried.
   - `OutboundRefused` fails the entry's workflow with `retry: false` and its words.
   - The URL check moves from a regex to `new URL()` with `http:`/`https:` only, so a
     `file:`, `ftp:` or `data:` URL fails the schema check, in the back office's save and
     in `crombolo check`.
   - Saving in the back office also checks the address where the host resolves, as a
     webhook's save does; one that does not resolve yet is accepted and checked at send.
   - What the log keeps of a failed answer follows webhooks: the status, and up to 300
     characters of a text body; nothing of a binary one.
3. **The provider test** (`identity-provider-overrides.ts`): the discovery fetch goes
   through `pinnedFetch` with the same setting, and answers one of three messages, each
   naming the issuer only:
   - "<name> answered at <issuer>.";
   - "<issuer> could not be reached." (a refused address says why, the refusal being
     the CMS's own words, not the far end's);
   - "<issuer> did not answer with an OpenID Connect discovery document." (any non-2xx,
     unparseable body, or a document without `authorization_endpoint`).
   Sign-in itself is not changed: it shows nothing of what the issuer answers.
4. **Docs:** `forms.md` gains "Where a form may send": http/https only, no redirects,
   private addresses refused unless the setting allows them, headers literal.
   `webhooks.md` and `delivery-api.md` name the new setting; `configuration.md` lists it.
   Release notes: the forms rule and the provider test's messages under Changes, and the
   setting's rename as an upgrade note.

## Tests

- **Forms** (`tests/forms-workflows.test.ts`): a send-to-URL to `127.0.0.1`, `10.0.0.1`,
  `169.254.169.254`, and to a host whose injected lookup gives `10.0.0.5`, sends nothing
  (`fetch` never called) and fails unretried with the reason; with the setting on it is
  sent. A 302 is not followed and fails unretried. A header `env:DATABASE_PASSWORD` arrives
  as that literal text.
- **Schema** (`tests/forms-schema.test.ts`): `file:`, `ftp:` and `data:` URLs refused.
- **Provider test** (new `tests/identity-provider-test.test.ts`, against `support/fake-oidc.ts`): an issuer at `127.0.0.1` is
  refused with the setting off; an issuer answering 500 with a body, and one answering
  HTML, give messages containing neither the status nor the body text.
- **Config**: `webhooks.allowPrivateAddresses` is refused naming the new setting;
  `CROMBOLO_ALLOW_PRIVATE_ADDRESSES=true` and `development` both allow.
- **Existing tests** that set `webhooks.allowPrivateAddresses` move to the new setting.

