# 365 — The remote at `/crombolo`, and a person's exchange with it off

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 364

> **Security relevant.** It changes when the token endpoint answers. The rules of 364's
> exchange are unchanged; read its threat model again before merging.

## Story

As a host that keeps its sites' own remote off, I want the tools I sign people in
with to exchange their token for a sign-in as them anyway, so that they reach the
Management API as that person without the site taking pulls or pushes from anyone.

As anyone reading a site's routes, I want the remote protocol under `/crombolo`, where
the CMS's own features live, rather than among Umbraco's paths.

## Context

- **The exchange (364) is answered only while the remote is on.** `/token` sits behind
  `settings.enabled`, so with `CROMBOLO_REMOTE_ACCESS=off` it answers 404
  `not-enabled`. But a person's exchanged token is a back-office sign-in: it works on the
  Management API as well as on the remote's person routes. A host that turns the remote
  off, because a back-office group could otherwise grant itself pulls or pushes the host
  controls elsewhere, loses the exchange with it.
- **The path doesn't follow the CMS's own rule.**
  - `/umbraco/…` holds what keeps Umbraco's shape: `management`, `delivery`, `members`
    and the hubs.
  - `/crombolo/…` holds what is the CMS's own: `forms`, `islands`, `bundle`, the back
    office's plugin.
  - The remote protocol is the CMS's own, yet it is at `/umbraco/remote/v1`.

## The design

- **The remote moves to `/crombolo/remote/v1`, a hard cut-over.**
  - Nothing answers at `/umbraco/remote/v1` afterwards: not a redirect, not an alias.
  - The path is fixed. It doesn't move with `backOfficePath`, as the remote doesn't
    today (`backoffice-hosting.md`'s table).
  - Discovery (`/.well-known/crombolo-remote`) is unchanged, and advertises the new
    `api` and `tokenExchange`.
  - The CLI reads the address from discovery each time, so a saved profile keeps
    working. Anything that wrote the old path down, such as `remote-approval.js`, is
    changed.
- **The path is exported:** `REMOTE_API_PATH` from `@crombolo/crombolo`, for a host
  whose own discovery stands in front of the site's.
- **A person's exchange works whatever the remote's access.** With access `off`:
  - `POST /crombolo/remote/v1/token` answers a token whose `iss` is an exchanging
    provider's, exactly as 364 does, and nothing else.
  - Any other token, a CI token included, answers 404 `not-enabled`, as it does
    today: what CI is told doesn't depend on whether a provider exchanges (D1).
  - Every other remote route still answers 404 `not-enabled`.
  - Discovery stays off too. A host that offers the exchange says so itself, and the
    site's own discovery would advertise a remote that refuses everything.
- **What the token may do is unchanged.**
  - With the remote off, the token reaches the Management API as the person and
    nothing of the remote's.
  - With it on, the token reaches the person routes as well, as in 364.
  - It still approves nothing and makes nothing that outlasts it.
- **The boot says so:** with the remote off and a provider exchanging, it logs that
  `/token` answers that provider's exchange only.
- **Telemetry** counts the remote under its own route, `/crombolo/remote/v1/*`, not as
  the back office's `/crombolo/*`.
- **A proxy that locks `/crombolo/*` down** to hide the back office now hides the
  remote too, as it already does the Delivery API; `backoffice-hosting.md` says so,
  and that moving `backOfficePath` is the way to lock the editor alone.

## Decisions

- **D1 a:** with the remote off, a token that isn't an exchanging provider's, CI's
  included, answers 404 `not-enabled` as it does today, rather than `invalid_grant`.
  CI's answer then never depends on the exchange setting, and says why it failed.

## Threat model (what changes)

| Threat | Mitigation |
| --- | --- |
| The endpoint answering with the remote off | Only for an opted-in provider's token, checked as in 364: signature, issuer, the provider's own audience, `jti` once, at most 90 minutes, a person the site already knows. Nothing at all without an opted-in provider. |
| CI reaching a site whose remote is off | 404 `not-enabled`, as now, whether or not a provider exchanges (D1). |
| A pull or push through an exchanged token with the remote off | Every remote route but `/token` answers 404 `not-enabled`; the token is a back-office sign-in only. |
| Guessing or load at `/token` | Rate-limited per address and per issuer, as 364's. |
| A client still calling `/umbraco/remote/v1` | Answers as any unknown Umbraco path does. The CLI and the conformance suite follow discovery, so only hand-written callers notice. |

## Acceptance criteria

- [x] The remote protocol answers at `/crombolo/remote/v1` and nothing answers at
      `/umbraco/remote/v1`. Discovery, `remote-approval.js`, the CLI, the conformance
      suite and the docs use the new path.
- [x] `REMOTE_API_PATH` is exported from `@crombolo/crombolo`.
- [x] With `CROMBOLO_REMOTE_ACCESS=off` and a provider exchanging:
  - `/token` exchanges that provider's token for a sign-in that works on the
    Management API;
  - a CI token answers 404 `not-enabled`;
  - every other remote route answers 404 `not-enabled`;
  - discovery answers nothing.
- [x] With `off` and no provider exchanging, `/token` answers 404 `not-enabled`, as now.
- [x] `@crombolo/remote-conformance` checks the exchange where discovery offers
      `auth.people`, at the new path.
- [x] `docs/remote-protocol.md`, `docs/operations.md`, `docs/backoffice-hosting.md`'s
      table and the release notes say what moved and that the old path is gone.

## Out of scope

- Turning discovery on for a site whose remote is off.
- Moving the Management API or any other Umbraco path.

## Built

- **The path:** `REMOTE_API_PATH` is `/crombolo/remote/v1` (`packages/server/src/remote.ts`),
  re-exported from `@crombolo/crombolo` with `REMOTE_DISCOVERY_PATH`.
  `remote-approval.js` calls the new path; the CLI and the conformance suite already
  read `api` and `tokenExchange` from discovery and needed no change.
- **The gate:** `handle` answers `…/token` with the remote off only when people
  exchange (`options.people`) and the token's unverified issuer is an exchanging
  provider's; anything else there, and every other route, answers 404
  `not-enabled`. Discovery stays off.
- **Boot:** `server.ts` logs that the token endpoint answers only the named providers'
  exchange when the remote is off.
- **Telemetry:** `routeOf` counts `/crombolo/remote/v1/*` as its own route.
- **Tests:** `tests/remote-people.test.ts` covers the exchange with the remote off (the
  Management API works, `me`, `environments` and discovery 404, a CI-issuer token gets
  `not-enabled`), `/token` with no provider exchanging, and the old path answering
  nothing; `tests/telemetry.test.ts` the route; the remote CI, CLI and credentials
  tests use the new path.
- **Docs:** `remote-protocol.md` ("Where it is", "With the remote off", the access
  table), `operations.md`, `backoffice-hosting.md` (the table, and the proxy note) and
  the release notes.

