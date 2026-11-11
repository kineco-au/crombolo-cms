# 330 — An extension's templates carry no script

**Epic:** I — Hardening · **Priority:** must · **Size:** S
**Depends on:** 312

## Story

As someone running a site whose back office shares the site's origin, I want an extension's
rendered components to carry no script, event handler or `javascript:` link, so that a
visitor who is also a signed-in administrator cannot be made to act in the back office by
a page they looked at.

## Context

Story 312 renders an extension's components in its own process and puts the HTML in the
page. The build refuses `'use client'` and `'use deferred'`, but nothing checks the HTML
that comes back: a `<script>` tag, an `onclick`, or an `href="javascript:…"` in that output
runs in the visitor's browser, in the site's origin. The back office is served from the same
origin, so a same-origin fetch from such a script carries the signed-in administrator's
cookie. The threat model's T6 covers server code in templates; this is the client half.

## Decisions (2026-11-11)

- **The renderer strips from an extension component's output:** `<script>` elements,
  `on*` attributes, `javascript:` and `data:` URLs on `href`, `src`, `action` and
  `formaction`, `<iframe>`, `<object>`, `<embed>` and `<base>`. Inline `style` stays.
- **Stripping is logged** per component, once per boot per component, naming the extension,
  so an honest author finds out.
- **Site components are untouched.** They are the site's own code.
- **A test per removal**, in the style of `extension-isolation.test.ts`, with a component
  that tries each.

## Acceptance criteria

- [ ] Each listed construct is removed from an extension component's rendered HTML, and the
      page renders the rest.
- [ ] A removal is logged with the extension and component, once per boot.
- [ ] Site components render as before.
- [ ] Covering tests; the threat model's T6 row and `extensions.md` "Components" say so.
