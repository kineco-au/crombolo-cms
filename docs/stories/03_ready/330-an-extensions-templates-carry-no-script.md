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

- **The renderer keeps only what the HTML Sanitizer API's default configuration allows**
  (planned on 2026-11-11 as a denylist of `<script>`, `on*`, `javascript:` and `data:`
  URLs, `<iframe>`, `<object>`, `<embed>` and `<base>`; changed to the allowlist because a
  denylist misses what nobody listed, such as script inside an SVG or a `meta` refresh). The
  WHATWG HTML standard's `setHTML()` defines a default set of elements and attributes and
  removes the rest: event handler attributes, script-bearing URLs, and the elements that
  load or run code. The server cannot call the browser's method, so its lists are copied
  verbatim into our own code, the spec section cited, with a test that fails when the lists
  in code drift from the ones in the doc. Inline `style` attributes are in the default and
  stay. AMP was considered and rejected: it is a whole-page format with a runtime script of
  its own.
- **Removal is logged** per component, once per boot per component, naming the extension,
  the element or attribute removed and the count, so an honest author finds out.
- **Site components are untouched.** They are the site's own code.
- **A test per class of removal**, in the style of `extension-isolation.test.ts`, with a
  component that tries each.

## The plan (2026-11-11)

What exists and is reused: `createExtensionComponents` in
`packages/server/src/extension-components.ts` is the one place an extension's HTML enters
the page, as a `RawHtml` from the `render` call, with a `warned` set already logging once
per extension; `safeExternalUrl` in `packages/render/src/values.ts` is the scheme check for a
single URL. There is no HTML parser in the server and the root's `dompurify` entry is
unused, so the tokenizer is new.

- `packages/render/src/safe-html.ts`: `sanitiseHtml(markup, report?)`, a single-pass
  tokenizer over tags, attributes, text, comments and CDATA that rewrites the string and
  builds no tree. Rules, from the Sanitizer API's default configuration:
  - an element not in the allowlist is dropped with its contents where the spec says
    (`script`, `style`'s contents, `iframe`, `object`, `embed`, `noscript`, `template`) and
    unwrapped otherwise, keeping its children;
  - an attribute not in the allowlist for its element, and any `on*` attribute, is dropped;
  - a URL attribute (`href`, `src`, `action`, `formaction`, `xlink:href`, `srcset`, `poster`,
    `cite`) is kept only with no scheme or one of `http:`, `https:`, `mailto:`, `tel:`,
    extending `safeExternalUrl`;
  - comments and CDATA are dropped; a tag that never closes is closed at the end;
  - `report(kind, name)` is called once per removal so the caller can count.
  The element and attribute lists live in `safe-html-lists.ts`, one table each, with the
  spec URL and the date they were copied.
- `extension-components.ts`: `render` passes the returned string through `sanitiseHtml`
  before wrapping it in `RawHtml`, with a reporter that, once per boot per component, logs
  "The extension {id}'s component {name} carried {count} thing(s) a page may not: {names}.
  They were removed." and counts the rest silently.
- `tests/safe-html.test.ts`: each class of removal, nesting (`<svg><script>`), malformed
  markup (unclosed tags, attributes without quotes, uppercase, entities in URLs,
  `java&#115;cript:`), an allowed document unchanged byte for byte, and the lists against
  `docs/extension-threat-model.md`'s copy.
- `tests/extension-components.test.ts`: a fixture component tries a script, an `onclick`, a
  `javascript:` link, an `iframe` and an SVG script, and the page renders the rest; the log
  names the component once across two renders; a site component with the same markup is
  untouched.
- Docs: `extensions.md` "Components" gains the rule and the standard; the threat model's T6
  row names the client half; `release-notes.md`.

## Acceptance criteria

- [ ] An extension component's rendered HTML keeps only the elements, attributes and URL
      schemes the HTML Sanitizer API's default configuration allows, and the page renders
      the rest; the lists in code match the spec's and a test says so.
- [ ] Script, event handlers, script-bearing URLs, frames, embeds, `base` and `meta` are
      removed whether written plainly, nested in SVG, uppercased or entity-encoded.
- [ ] A removal is logged with the extension, the component and what was removed, once per
      boot.
- [ ] Site components render as before.
- [ ] Covering tests; the threat model's T6 row and `extensions.md` "Components" say so.
