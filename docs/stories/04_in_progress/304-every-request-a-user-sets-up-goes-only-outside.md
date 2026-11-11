# 304 — Every request a user sets up goes only outside

**Epic:** I — Hardening · **Priority:** should · **Size:** M
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
  - a header is either written in the form or **secret**: sealed in the database,
    never shown back, and sent only to the address it was set for;
  - a refused address fails the entry's workflow without retrying, saying why.
- **The provider test** answers only reachable, not reachable or not a discovery
  document, with the issuer. It never says the status or what the body held.

## Acceptance criteria

- [x] A send-to-URL workflow pointing at `127.0.0.1`, `10.0.0.1` or `169.254.169.254`,
      or at a host resolving to one, sends nothing, and the entry's workflow log says why.
- [x] A workflow's 302 is not followed.
- [x] A `file:`, `ftp:` or `data:` URL is refused on save.
- [x] A workflow header `env:NAME` is sent as written, never as the server's variable.
- [x] A secret header's value is never returned by the back office's API, and is not in
      the form's file, a site export or a transfer.
- [x] A secret header set for one URL is not sent once the workflow's URL changes; the
      entry's workflow log says to set it again.
- [x] `CROMBOLO_ALLOW_PRIVATE_ADDRESSES=true` lets all three reach a private address;
      `webhooks.allowPrivateAddresses` is gone.
- [x] The provider test refuses the same addresses, and its message never includes
      a status code or body text.
- [x] `forms.md` documents the rule.

## Decisions (2026-11-11)

- **One setting for all three, in the environment.** `CROMBOLO_ALLOW_PRIVATE_ADDRESSES`
  (config `allowPrivateAddresses`) lets webhooks, the forms workflow and the provider test
  reach loopback, private and link-local addresses. The protection is on by default: unset,
  they are refused. A development site (`config.development`) allows them, as webhooks do
  today, so a local receiver still works.
- **`webhooks.allowPrivateAddresses` is replaced**, not kept as an alias. A config that
  still sets it fails the config check naming the new setting, and the release notes say
  to switch. `webhooks.headerVariables` stays, as webhooks' alone.
- **A form's headers name no server variable.** Forms get no `env:`: a header written
  in the form is sent exactly as written, so there is nothing for `301`'s `env:` rule to
  hold.
- **A credential is a secret header, sealed like a provider's client secret.** Whoever
  manages forms types it once in the workflow's settings. It is sealed with
  `CROMBOLO_SECRET_KEY` and kept in the database, never in the form's file, so a form in
  git or a schema store carries only that the header is secret. The back office shows
  "Set" with a Replace, never the value. The secret is bound to the URL it was set for:
  change the URL, by the back office or by a deploy, and it is not sent until set again,
  so nobody can point someone else's token at their own address. Each site sets its own,
  as it does its client secrets.

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
3. **Secret headers** (new `form-workflow-secrets.ts`, a migration, the forms API and
   designer):
   - In the form's file a secret header is `headers = { Authorization = { secret = true } }`;
     `validate-forms.ts` takes a string or `{ secret: true }`, and nothing else.
   - A table `form_workflow_secret` (`form_key`, `workflow_key`, `header`, `sealed`, `url`,
     `set_by`, `set_at`), migration released in the next version. A secret needs the
     workflow to have a `key`; the designer gives every new workflow one, and saving a
     secret on a workflow without one gives it one.
   - The forms API: `PUT …/forms/<key>/workflows/<workflow>/secrets/<header>` with
     `{ value }` seals and stores it with the workflow's URL; `DELETE` removes it. Reading a
     form answers each secret header as `{ secret: true, set: boolean }`. Without a usable
     `CROMBOLO_SECRET_KEY` the PUT is refused, saying so, as a provider's client secret is.
   - `sendToUrl` opens each secret header. One that is unset, was set for another URL, or
     will not open with the key fails the entry's workflow unretried, naming the header and
     what to do, and sends nothing.
   - Deleting a form or a workflow deletes its secrets. Setting or replacing one is an
     audit entry naming the form, workflow and header, never the value.
   - The designer: beside each header, a "Secret" switch; a secret shows "Set" or "Not set"
     with Replace and Remove.
4. **The provider test** (`identity-provider-overrides.ts`): the discovery fetch goes
   through `pinnedFetch` with the same setting, and answers one of three messages, each
   naming the issuer only:
   - "<name> answered at <issuer>.";
   - "<issuer> could not be reached." (a refused address says why, the refusal being
     the CMS's own words, not the far end's);
   - "<issuer> did not answer with an OpenID Connect discovery document." (any non-2xx,
     unparseable body, or a document without `authorization_endpoint`).
   Sign-in itself is not changed: it shows nothing of what the issuer answers.
5. **Docs:** `forms.md` gains "Where a form may send": http/https only, no redirects,
   private addresses refused unless the setting allows them, written and secret
   headers, and a secret's binding to its URL.
   `webhooks.md` and `delivery-api.md` name the new setting; `configuration.md` lists it.
   Release notes: the forms rule and the provider test's messages under Changes, and the
   setting's rename as an upgrade note.

## Tests

- **Forms** (`tests/forms-workflows.test.ts`): a send-to-URL to `127.0.0.1`, `10.0.0.1`,
  `169.254.169.254`, and to a host whose injected lookup gives `10.0.0.5`, sends nothing
  (`fetch` never called) and fails unretried with the reason; with the setting on it is
  sent. A 302 is not followed and fails unretried. A header `env:DATABASE_PASSWORD` arrives
  as that literal text.
- **Secret headers** (new `tests/forms-secret-headers.test.ts`): set through the API, the
  value is sent, absent from the form's GET and from the TOML written; after the URL
  changes it is not sent and the log names the header; a value sealed with another key
  fails without sending; a writer without forms access is refused; deleting the workflow
  removes the row; the audit entry has no value.
- **Schema**: `{ secret = true }` accepted, `{ secret = "x" }` and other shapes refused.
- **Schema** (`tests/forms-schema.test.ts`): `file:`, `ftp:` and `data:` URLs refused.
- **Provider test** (new `tests/identity-provider-test.test.ts`, against `support/fake-oidc.ts`): an issuer at `127.0.0.1` is
  refused with the setting off; an issuer answering 500 with a body, and one answering
  HTML, give messages containing neither the status nor the body text.
- **Config**: `webhooks.allowPrivateAddresses` is refused naming the new setting;
  `CROMBOLO_ALLOW_PRIVATE_ADDRESSES=true` and `development` both allow.
- **Existing tests** that set `webhooks.allowPrivateAddresses` move to the new setting.
- The migration is undone in each of the test rewinds.


## Implemented (unreleased, for 0.62.0)

- **The setting:** `allowPrivateAddresses` on the resolved config, from
  `CROMBOLO_ALLOW_PRIVATE_ADDRESSES`, defaulting to `development` (`config.ts`,
  `settings.ts`, `docs/configuration.md` regenerated). `webhooks` keeps only
  `headerVariables`; a config with `webhooks.allowPrivateAddresses` throws naming the new
  setting. `checkedAddress`'s refusal names it.
- **The forms workflow** (`form-workflows.ts`): `sendToUrl` goes through `pinnedFetch` with
  `WorkflowDeps.outbound` and `secretKey`; `OutboundRefused` and a 3xx fail unretried; the
  log keeps up to 300 characters of a text, JSON or XML answer and nothing else.
  `refusedSendAddresses` checks a form's addresses on save in the back office (a host that
  does not resolve passes). `validate-forms.ts` takes only an absolute http(s) URL and a
  header as text or `{ secret = true }`.
- **Secret headers:** migration 073 `AddFormWorkflowSecrets` (`form_workflow_secret`,
  release 0.62.0), `FormWorkflowSecretRepository` in `@crombolo/data`; the forms API's
  `PUT`/`DELETE …/forms/<key>/workflows/<workflow>/secrets/<header>` (Manage forms; works
  on a site whose schema is read-only), and `secrets: [{ workflow, header, set }]` on a
  form's `GET`. Saving a form forgets the secrets of workflows it no longer has; deleting
  it forgets all of them. Set and cleared are audited under Settings with
  "<workflow>: <header>", never the value.
- **The designer:** the designer had no headers editor at all, so rather than a "Secret"
  switch beside each header, a send-to-URL workflow gains a Secret headers panel: add a
  header by name (written to the form as `{ secret = true }`), then set, replace or clear
  its value once the form is saved, with Set or Not set beside it. Headers written as text
  stay a matter for the form's file or `crombolo forms workflow add --set`.
- **A fix found on the way:** the form writer wrote any table-valued setting (headers, a
  `map`) as a JSON string; it now writes an inline table (`write-forms.ts`).
- **The provider test** (`identity-provider-overrides.ts`): through `pinnedFetch` with the
  setting; answers "<name> answered at <issuer>.", "<issuer> could not be reached." (with
  the CMS's own refusal when there is one), or "<issuer> did not answer with an OpenID
  Connect discovery document."
- **Tests:** `forms-workflows` (refused addresses, the setting, a 302, a literal `env:`,
  what the log keeps, pinning), `forms-schema` (schemes and header shapes), new
  `forms-secret-headers` and `identity-provider-test`; the webhook tests moved to the new
  setting; migration 073 in every rewind.
