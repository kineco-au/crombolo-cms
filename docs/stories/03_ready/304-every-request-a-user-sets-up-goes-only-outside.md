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
  checked, and `allowPrivateAddresses` for development and intranets.
- **The forms workflow:**
  - `https://` and `http://` only;
  - redirects not followed: a 3xx is the receiver's answer;
  - headers held to `301`'s `env:` rule;
  - a refused address fails the entry's workflow without retrying, saying why.
- **The provider test** answers only reachable, not reachable or not a discovery
  document, with the issuer. It never says the status or what the body held.

## Acceptance criteria

- [ ] A send-to-URL workflow pointing at `127.0.0.1`, `10.0.0.1` or `169.254.169.254`,
      or at a host resolving to one, sends nothing, and the entry's workflow log says why.
- [ ] A workflow's 302 is not followed.
- [ ] A `file:`, `ftp:` or `data:` URL is refused on save.
- [ ] A workflow header naming a variable outside `301`'s rule is refused.
- [ ] The provider test refuses the same addresses, and its message never includes
      a status code or body text.
- [ ] `forms.md` documents the rule.
