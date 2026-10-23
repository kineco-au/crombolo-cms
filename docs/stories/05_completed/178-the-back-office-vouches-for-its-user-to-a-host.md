# 178 — The back office vouches for its user to a host

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** S
**Depends on:** 063, 177

## Story

As someone who runs crombolo for other people's sites, I want the back office
to tell my own service, in a way it can check, who is signed in, so that a tool
I provide in the back office can be served from my side without the CMS
running any of my code on the server.

## Context

A host can provide back-office extensions (177): browser code, loaded like any
bundle's, that never leaves with a site. That code already calls the
Management API as the person signed in, as every back-office extension can
([`../../bundles.md`](../../bundles.md)). So a host tool can read and change a
site through the API, rules and permissions that person already has.

What it cannot do is tell the host's own service who that person is:
- the back office's session is cookies on the site's own address, which a
  service elsewhere neither receives nor can check;
- the API user's client credentials (`client_credentials`) are the
  installation's, not the person's.

A tool split this way runs its logic and anything it pays for on the host's
side, and its actions in the browser, as the person. It needs a short-lived,
signed statement from the CMS of who is asking.

This replaces an earlier draft of 178, which would have given bundles'
**server** code a way to call the Management API as the person. That power
is not needed once the work happens in the browser, and it is not offered.

## Decision

**A host token**, issued by the back office to a signed-in person on
request:

```
POST <backoffice>/crombolo/api/host-token   → { token, expiresIn }
```

- **Signed** with a key the host configures and holds.
- **Audience:** the one host origin configured.
- **Short-lived:** five minutes at most.
- **Claims:**
  - the user's key and name;
  - their groups and sections;
  - the site's name and node id;
  - the time issued.

Configured by `defineConfig({ host: { origin, signingKey, keyId } })`. The
`keyId` goes in the token's header, so a host that runs many installations
knows which key to check it with. With no `host`, the route answers `404`
and nothing changes.

**Considered and not taken:** server-side Management API dispatch for
bundles (the earlier 178), which opens a standing capability to every bundle;
and the API user's credentials, which act as the installation and not as the
person.

## Findings (2026-10-23)

- **Same-origin is already enforced.** `authenticate` (`server/src/server.ts`)
  refuses a cookie-authenticated request with an unsafe method unless it is
  same-origin (`isSameOrigin`, `auth/src/origin.ts`). A `POST` route behind it
  inherits the check. The route still calls `isSameOrigin` itself, so it does
  not depend on that.
- **The person, now, comes for free.** `auth.resolveAccessToken` checks the
  token, that its session still exists, and that the user is neither locked
  out nor unapproved (`identityOf`, `auth/src/service.ts`). It rebuilds
  sections and groups from the database on every request. So a principal
  resolved for the request is the person as they stand, and an ended session,
  a lock-out or a disabled account gives no principal, hence `401`.
- **Signing is already available.** `jose` is a dependency of `@crombolo/auth`,
  which uses it for HS256 short-lived tokens (`short-lived.ts`: `SignJWT`,
  `jwtVerify`). The test's "plain JOSE library" can be `jose` used directly,
  with the key alone.
- **Rate limiting:** `AttemptLimiter` (`server/src/setup.ts`) keeps a
  per-caller and an overall sliding window in memory. It counts failures, but
  the same shape serves issues. Per node, like the setup form's.
- **Back-office routes** are matched in `serveBackOffice` under
  `${pluginPath}/api/…` (`/crombolo/crombolo/api/…`). A write there is recorded
  by `auditPluginWrite` unless excluded. The story says an issue is a log line,
  not an audit entry, so the path joins the exclusions.
- **Config validation** throws at boot for a bad value (for example the API
  client id prefix in `config.ts`). `host` is checked the same way.
- **What the principal carries:** user key and name, `allowedSections`
  (section aliases), and `groups` (each with its `alias`) as well as
  `groupKeys`. Group aliases are what a host can act on, so the token carries
  aliases. The site's name is `config.siteName`, and the node id
  `schema.nodeId`.

## Plan

1. **Config.** `CromboloConfig.host?: { origin: string; signingKey: string;
   keyId: string }`, from `defineConfig` only and in no settings registry
   entry. At boot:
   - `origin` must parse as an `https:` origin (or `http://localhost` for
     development) with no path;
   - `signingKey` must be at least 32 bytes;
   - `keyId` must be non-empty.

   Otherwise start is refused, naming the field. A host that keeps the key out
   of the file reads its own environment variable inside `defineConfig`. That
   variable is the host's, not one crombolo names.
2. **The token** (`server/src/host-token.ts`, pure apart from the clock):
   - `issueHostToken(host, principal, site)` returns a compact JWS signed
     HS256 with `kid` = `keyId`;
   - `aud` = the host origin, `iss` = the site's application URL when known;
   - `iat` and `exp` = `iat` + 300 seconds;
   - `sub` = the user's key, plus `name`, `groups` (aliases) and `sections`
     (aliases);
   - `site: { name, nodeId }`.
3. **The route.** `POST ${pluginPath}/api/host-token`:
   - `404` with no `host`;
   - `401` without a principal (no session, an ended one, locked out,
     disabled);
   - `403` when not same-origin;
   - `429` past the limit: 10 a minute per user, 300 a minute in all, per
     node.

   It answers `{ token, expiresIn: 300 }` with `Cache-Control: no-store`, and
   logs one line naming the user and the host origin, never the token. It is
   left out of the plugin audit.
4. **Tests** (`tests/host-token.test.ts`):
   - no `host` gives `404`, and a bad `host` refuses to start;
   - a signed-in user gets a token that `jose.jwtVerify` accepts with the key
     alone and the host origin as audience, and refuses with another audience
     or key;
   - `exp - iat <= 300`;
   - the claims match the user;
   - a group change shows in the next token;
   - signing out, then asking, gives `401`; a locked-out or disabled user gets
     `401`;
   - a cross-site request gives `403`;
   - the limit gives `429`;
   - nothing reaches the audit log, and the token is not in the log line.
5. **Docs.**
   - `docs/configuration.md` gains `host` in the code-only settings.
   - `docs/bundles.md` gains "Tools a host provides": browser code (177), the
     Management API as the person, and this token to the host's service, with
     a verification snippet using `jose`. It says the host must check `aud`
     and `exp`, pick the key by `kid`, and keep each installation's key
     separate. Because the key both signs and verifies, only the service that
     checks tokens should hold it: any component that has it can mint tokens
     the others accept. It notes that any back-office CSP added later must name
     the host's origin.
   - **HS256 is kept, as decided.** An asymmetric key would only stop a key
     taken from the verifying side being used to forge tokens. Those tokens
     reach the host's own service and never the CMS, and the host controls
     the installation's config either way. Per-installation keys and the
     five-minute lifetime bound a leak.
   - The release notes.

No migration.

## What was built

- **`server/src/host-token.ts`:**
  - `HostConfig`;
  - `checkHost`, which refuses a non-https origin (localhost excepted), an
    origin with a path, a key under 32 bytes or an empty key id;
  - `issueHostToken`, using `jose` `SignJWT` with HS256, `kid`, `typ: JWT`,
    `sub`, `aud`, `iss` when the application URL is set, `iat` and
    `exp` = `iat` + 300, and the claims `name`, `groups` (aliases),
    `sections` and `site { name, nodeId }`.
- **Config:** `CromboloConfig.host`, from `defineConfig` only, checked in
  `loadConfig`. `jose` became a dependency of `@crombolo/server`.
- **The route.** `POST <backoffice>/crombolo/api/host-token`:
  - `404` without `host`, `405` for other methods;
  - `403` unless same-origin;
  - `401` without a principal, which covers an ended session, a lock-out and a
    disabled account, since `authenticate` resolves the person afresh;
  - `429` with `Retry-After: 60` past 10 a minute per person or 300 in all
    (`AttemptLimiter`, per node).

  It answers `{ token, expiresIn: 300 }` with `Cache-Control: no-store`, and
  logs a line naming the user and host. It is left out of `auditPluginWrite`.
- **Tests** (`tests/host-token.test.ts`):
  - no host gives `404`, and a bad host refuses to start;
  - `jose.jwtVerify` with the key and audience alone accepts the token, and
    another audience or key does not;
  - the `kid`, the lifetime and the claims;
  - a group added shows in the next token;
  - signed out, disabled, cross-site and over the limit are each refused;
  - no audit entry.
- **Docs:** `docs/configuration.md` (`host`), `docs/bundles.md` ("Tools a host
  provides", with the browser and host snippets), the release notes.

## Acceptance criteria

- [x] **`host`** in `defineConfig`: an origin, a signing key and a key id, from the
      config only, never from an environment variable named in the
      settings registry. A malformed origin or a short key refuses to start.
- [x] **The route** issues a token only to a signed-in back-office user, on
      a same-origin request (`isSameOrigin`). It is rate limited, and each
      issue is a log line, not an audit entry.
- [x] **The token:**
  - a compact JWS, using HS256 with the configured key and `kid` its key id;
  - `aud` is the host origin;
  - `exp` is at most five minutes after `iat`;
  - the claims are the ones above.
- [x] A disabled or locked-out user, or one whose session has ended, gets
      `401`; the token reflects the user's groups **now**.
- [x] **Verifiable without the CMS:** a test verifies an issued token with
      a plain JOSE library and the key alone. `docs/bundles.md` says how a
      host checks one, and that the host must hold it to its audience.
- [x] **Docs:** `configuration.md` gains `host`, and `bundles.md` gains
      "Tools a host provides", which describes the pattern:
  - browser code from 177;
  - the Management API as the person;
  - this token to the host's service;
  - any back-office CSP added later names the host's origin.
