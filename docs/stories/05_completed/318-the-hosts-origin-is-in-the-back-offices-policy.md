# 318 — The host's origin is in the back office's content security policy

**Epic:** I — Hardening · **Priority:** must · **Size:** S
**Depends on:** 313

## Story

As a platform that hosts the back office and vouches for its user to a service of its own
(`config.host`, story 178), I want the back office's content security policy to let its
screens reach that service, so that a host's tool keeps working once the policy is on.

## Context

Story 313 gave every back-office page a content security policy:
- `connect-src` is `'self'`, plus the origins granted extensions declare in
  `http.outbound` (`backOfficePolicy`, `packages/backoffice-host/src/content-security.ts`);
- `config.host.origin` is not in it, and nothing can add it.

A host tool's browser `fetch` to its own origin is now blocked. Its token comes from
`/crombolo/api/host-token`, made for exactly that origin. `bundles.md` ("Bundles a host
provides") already says a CSP must name the host's origin.

## The design

- `connect-src` gains `config.host.origin` when a host is configured. It's the one origin
  the back office already vouches its user to.
- Nothing else changes, and there is no general setting for extra origins: an extension
  still declares its own.
- `bundles.md`'s sentence becomes what the policy does, and the release notes say so.

## Acceptance criteria

- [x] With `host: { origin: 'https://console.example.com', … }`, the back office's policy
      has that origin in `connect-src`, and a screen's `fetch` to it is not blocked.
- [x] Without a host, the policy is unchanged.
- [x] A test pins both, beside 313's.

## Implementation (0.58.0)

- `backOfficePage` (`packages/server/src/server.ts`) adds `config.host.origin` to the
  `connect` list it hands `backOfficePolicy`, beside the granted extensions' origins;
  `backOfficePolicy` already reduces each to its origin and drops repeats.
- `tests/content-security.test.ts`: a hosted site's back-office and sign-in pages list
  `'self'`, the extension's origin and the host's, each once; 313's test without a
  host still pins `connect-src 'self'`.
- `backoffice-hosting.md`'s `connect-src` row and `bundles.md`'s "Bundles a host
  provides" say what the policy does.
