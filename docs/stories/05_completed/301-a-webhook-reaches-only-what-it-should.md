# 301 — A webhook reaches only what it should

**Epic:** I — Hardening · **Priority:** must · **Size:** M
**Depends on:** —

## Story

As someone running a site, I want a webhook to send only the secrets meant for it, to
addresses outside my own network, and to keep only enough of the answer to see what
went wrong, so that a Settings user cannot use one to read the server's secrets or
reach and read back internal services.

## Context

A webhook's header may be `env:NAME`, which delivery replaces with the server's
variable (`resolveHeaders`, `webhooks.ts:378`). Any name is taken: `env:` can name the
database password, the secret key or a client secret, and send it to an address the
same user chose.

The address is checked only as `^https?://` (`webhookProblems`). So delivery will
POST to loopback, private and link-local addresses, including a cloud's metadata
endpoint. The delivery log then keeps the whole answer, headers and body
(`sendToWebhook`), and the user who made the webhook reads that log. That makes
deliveries a way to reach internal services and read their answers.

## The design

- **What `env:` may name.** A variable named in config
  (`webhooks: { headerVariables: ['PARTNER_TOKEN', …] }`), or one starting
  `CROMBOLO_WEBHOOK_`. Never one starting `CROMBOLO_` otherwise. Saving a webhook that
  names anything else is a 400 naming the rule, and a stored one that does fails its
  delivery with the same words, sending nothing.
- **Where a delivery may go.** The host is resolved before connecting, and the
  connection goes to the address that was checked, so DNS rebinding can't swap it.
  Refused:
  - loopback, private (RFC 1918, ULA), link-local (including 169.254.0.0/16 and
    fe80::/10), CGNAT, multicast, unspecified and broadcast addresses;
  - IPv4 addresses mapped into IPv6.

  `webhooks.allowPrivateAddresses: true` allows them, for development and an intranet.
  A refused address fails the delivery without retrying, saying why. The same check
  applies when saving, where the host already resolves. Redirects are not followed, as
  now.
- **What is kept of the answer.** The status, the `Content-Type`, and the first 1 KB
  of a text body. Nothing of a binary body, and no other headers. That is enough to see
  a receiver's refusal, but not enough to read back a page.
- **Bundle event handlers' `fetch`** gets the same address rule.

## Decisions (2026-11-08)

- **One `env:` rule for both stores.** Webhooks in the site's files follow the same rule
  as those made in Settings: a developer lists names in `webhooks.headerVariables`.
- **Old log rows age out.** Rows already in `webhook_log` are not rewritten. Every log
  row, failed or not, is pruned after `CROMBOLO_EVENT_RETENTION_DAYS` (30 by default),
  so they are gone a month after the upgrade. The upgrade note tells a site with
  retention `0` (kept forever) to clear the log itself.
- **Pinning works in Bun.** Fetching `https://<checked address>/…` with the `Host`
  header and `tls: { serverName }` set to the hostname connects to that address and still
  verifies the certificate against the hostname (a wrong name fails with
  `ERR_TLS_CERT_ALTNAME_INVALID`). No new dependency.
- **A name resolving to several addresses** is refused if any of them is refused, rather
  than picking a public one.

## Implementation plan

1. **The `env:` rule** (`webhook-files.ts`, `webhooks.ts`, `config.ts`):
   - `config.webhooks?: { headerVariables?: readonly string[]; allowPrivateAddresses?: boolean }`.
   - A pure `headerVariableProblem(name, allowed)`: allowed when listed, or starting
     `CROMBOLO_WEBHOOK_`, and otherwise refused: "The header "X" names DATABASE_PASSWORD,
     which a webhook may not send. List it in the config's webhooks.headerVariables, or
     name a variable starting CROMBOLO_WEBHOOK_." A listed `CROMBOLO_*` name is still
     refused unless it starts `CROMBOLO_WEBHOOK_`.
   - `webhookProblems` takes `{ headerVariables }`, so saving in Settings answers 400 and
     a file webhook fails the schema check (`crombolo check`, boot), with those words.
   - `resolveHeaders` applies the rule before reading `Bun.env`, so a stored webhook
     that breaks it logs the refusal, sends nothing, and is not retried.
2. **The address rule**, a new `packages/server/src/outbound-address.ts`, written for
   `304` to reuse in the forms workflow and the provider test, so `headerVariableProblem`
   lives there too:
   - Pure `refusedAddress(ip)`: loopback, RFC 1918, ULA `fc00::/7`, link-local
     `169.254.0.0/16` and `fe80::/10`, CGNAT `100.64.0.0/10`, multicast, unspecified,
     broadcast, `0.0.0.0/8`, and IPv4 mapped into IPv6 (`::ffff:a.b.c.d`, checked as the
     IPv4 address it carries, and refused as mapped). Answers the reason in words, or
     nothing.
   - `checkedTarget(url, { allowPrivate, lookup })`: an IP literal is checked as it is;
     a hostname is resolved with `Bun.dns.lookup` (`lookup` injectable for tests) and
     every address checked. Answers the address to connect to, or why not.
   - `pinnedFetch(url, init, options)`: checks, then fetches the checked address with the
     original `Host` header and `tls.serverName`, `redirect: 'manual'`. A refusal throws
     an `OutboundRefused` error, which delivery treats as not retryable.
   - `sendToWebhook` goes through it, with `options.fetch` still injectable underneath
     for tests.
   - Saving a webhook checks the address too, where the host resolves; one that does not
     resolve yet is accepted, and checked at each delivery.
3. **What the log keeps** (`sendToWebhook`): `responseHeaders` holds only `Content-Type`;
   `responseBody` the first 1 KB of a `text/*`, JSON or XML body, read by streaming no
   further than that, and nothing of any other type ("(a binary answer, not kept)").
4. **A bundle's event `fetch`** (`webhooks.ts:552`) goes through `pinnedFetch` with the
   same `allowPrivateAddresses`.
5. **Docs:** `webhooks.md` gains "What a webhook may reach": the three rules and the two
   settings. Release notes: the `env:` rule as a breaking change, naming
   `webhooks.headerVariables` and the `CROMBOLO_WEBHOOK_` prefix; the address rule,
   naming `allowPrivateAddresses`; the retention note.

## Tests

- **Unit** (`tests/outbound-address.test.ts`): each refused range and its edge (e.g.
  `172.15.255.255` allowed, `172.16.0.0` refused), mapped IPv6, IP literals in brackets,
  a hostname whose lookup returns one private address among public ones.
  `headerVariableProblem` with listed, prefixed and `CROMBOLO_SECRET_KEY` names.
- **Server** (`tests/webhooks.test.ts`): saving with `env:DATABASE_PASSWORD` is a 400; a
  stored one (written to the table directly) logs the refusal and sends nothing; a listed
  name is sent. A delivery to `127.0.0.1` with the address rule on is refused without
  `fetch` being called, and is not retried; with `allowPrivateAddresses` it is sent. The
  pinned request goes to the looked-up address with the original `Host`. The log keeps
  the status, `Content-Type`, 1 KB of a long text body, nothing of a binary one, no
  other headers.
- **Existing tests** that deliver to a local receiver set `allowPrivateAddresses`, or
  inject `lookup`.
- **Bundle event `fetch`** to `169.254.169.254` is refused.

## Implemented (v0.56.0)

- `packages/server/src/outbound-address.ts`: `refusedAddress`, `checkedAddress`,
  `pinnedFetch`, `OutboundRefused` and `headerVariableProblem`, for `304` to reuse.
- **Changes from the plan:**
  - `CROMBOLO_REVALIDATE_SECRET` is allowed by name. It is the Next.js template's webhook
    secret, made to be sent, and renaming it would break every Next site on both sides.
  - `allowPrivateAddresses` defaults to on for a development site (`NODE_ENV` not
    `production`). The Next.js template's webhook posts to `localhost:3000`, so leaving it off
    would break that template in development.
  - The `env:` rule is applied by the server, at save (either store) and at delivery. The
    CLI's `webhooks new` and `webhooks update` write files without the site's config, so a file
    they write naming another variable is refused when it is delivered.
- Tests: `tests/outbound-address.test.ts` (unit), and `tests/webhooks.test.ts`, "what a
  webhook may reach" and a bundle's `fetch`.

## Acceptance criteria

- [x] `env:DATABASE_PASSWORD` and `env:CROMBOLO_SECRET_KEY` are refused on save. A
      stored webhook naming either delivers nothing and logs why.
- [x] A name in `webhooks.headerVariables`, or starting `CROMBOLO_WEBHOOK_`, is sent.
- [x] Deliveries to `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]`, a mapped
      `::ffff:10.0.0.1`, and a hostname resolving to any of them are refused without
      a connection being made. `allowPrivateAddresses` allows them.
- [x] A hostname is connected to at the address that was checked.
- [x] The delivery log keeps the status, content type and at most 1 KB of a text body,
      and no other headers.
- [x] A bundle's event `fetch` refuses the same addresses.
- [x] `webhooks.md` documents all three rules. The release notes call the `env:` rule
      a breaking change, naming the settings that restore a webhook.
