# 313 — The back office reaches only the origins extensions declared

**Epic:** I — Hardening · **Priority:** should · **Size:** S
**Depends on:** 308

## Story

As someone signed in to the back office, I want an extension's screens unable to
send what they see anywhere they did not declare, so that a screen cannot carry my
session's data off the site.

## Context

There is no content security policy on the back office (`extension-threat-model.md`,
T8). A screen runs as the signed-in user, and can call the Management API and any
origin. The browser cannot tell one screen from another, so a policy covers them
all at once.

## The design

- **The policy:** the back office's pages send a content security policy whose
  `connect-src` is the site itself, plus every origin a granted extension declares
  in `http.outbound`. `script-src` is the site itself. Images and frames get the same
  treatment where the back office needs them.
- **Changes with grants:** granting or removing an extension changes the policy on
  the next page load.
- **The install says it:** an extension's screens act as the signed-in user; the
  policy limits where they send things, not what they may do on the site.
- **Umbraco's own client:** anything it needs, such as the help and news feeds, is
  named in the policy, or turned off.

## Decisions (2026-11-09)

- **`http.outbound` grants a screen's origins too,** as designed: what an
  extension's server half may reach, its screens may. The install says so beside
  the permission.
- **Enforced from this release, with violations logged:** the browser reports each
  violation to the site, which writes it to the log (rate limited), so an operator
  sees what broke.

## Implementation plan

- **The policy** is built by a pure `backOfficePolicy()` in
  `packages/backoffice-host`, and sent on every back-office document: the app
  shell, the sign-in pages and setup. Its parts:

  | Directive | Value |
  |---|---|
  | `default-src` | `'self'` |
  | `script-src` | `'self' 'nonce-…'`: a nonce per page for the early theme script and the import map (`shell.ts`) |
  | `style-src` | `'self' 'unsafe-inline'`: the client's components set `style` attributes |
  | `connect-src` | `'self'`, plus each origin a granted extension's `http.outbound` names (its grant row, or its config entry) |
  | `img-src`, `media-src` | `'self' data: blob:`, plus the media store's public prefix (S3, Azure) |
  | `font-src` | `'self' data:` |
  | `worker-src` | `'self' blob:` (Monaco) |
  | `frame-src` | `'self'`, the oEmbed providers' players, and the front end's origin for the member preview |
  | `frame-ancestors` | `'self'`, replacing `x-frame-options` on these pages |
  | `object-src`, `base-uri` | `'none'`, `'self'` |
  | `report-uri` | the site's own report endpoint |

- **Built per request:** the origins come from `bundleGrants`, so granting or
  removing an extension changes the policy at the next page load.
- **The report endpoint:** `POST <backoffice>/crombolo/api/csp-report` takes the
  browser's report, unauthenticated, small and rate limited. It logs the directive
  and the blocked origin, never the page's query string.
- **The install says it:** in the Marketplace's install panel and Installed,
  `http.outbound` reads "Send requests from the server, and from its screens in
  your browser, to …". A note says its screens act as the signed-in user.
- **Umbraco's client:** walked under the policy in the browser test. Anything it
  fetches from elsewhere is named in the policy, or turned off in the fork.

## Tests

- **Unit:**
  - the policy's directives;
  - a nonce that matches the shell's inline scripts;
  - origins added by a grant and gone when it is removed;
  - the header on each back-office document and not on site pages;
  - the report endpoint's logging and its limits.
- **Browser** (`tests/browser/content-security.browser.ts`):
  - it signs in and opens every section and the main editors, collecting
    `securitypolicyviolation` events, and expects none;
  - the browser site's test extension screen fetches an undeclared origin and is
    blocked, and fetches one its grant names and is not.

## Acceptance criteria

- [ ] A screen's `fetch` to an undeclared origin is blocked by the browser.
- [ ] An origin declared by a granted extension is allowed, and removed when the
      extension is.
- [ ] The back office works under the policy with no violations logged. A browser
      test checks this.
