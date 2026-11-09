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

## Acceptance criteria

- [ ] A screen's `fetch` to an undeclared origin is blocked by the browser.
- [ ] An origin declared by a granted extension is allowed, and removed when the
      extension is.
- [ ] The back office works under the policy with no violations logged. A browser
      test checks this.
