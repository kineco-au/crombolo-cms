# Brand

The mark (the terracotta disc and its cream arcs) and the full logo live in
`packages/backoffice-host/plugin/branding/` as SVG: `favicon.svg` is the mark,
`logo-header.svg` and `logo-surface.svg` the full logo. They are the one source;
`crombolo/branding` exports the same bytes, and `docs/brand/` holds PNG renders
of both. The palette is declared once, as the `--crombolo-*` tokens in
`theme.css`, and taken from the logo: the disc's terracotta is `orange-deep`, the
wordmark's cocoa is `cocoa`, and the lighter roles are tints of the same hue
chosen so text on them clears WCAG AA (`tests/brand-exports.test.ts`).

## Where each file is used

| File | Used for |
| --- | --- |
| `favicon.svg` | The back office tab icon, and `faviconSvg` in `crombolo/branding` |
| `logo-header.svg` | The back office header and sign-in card, and `logoSvg` in `crombolo/branding` |
| `logo-surface.svg` | The same logo where Umbraco shows its alternative logo |
| `icon-mark.js` | The mark in one colour, served in place of the Umbraco icon in the icon registry |
| `backdrop.svg` | The sign-in backdrop, with the mark as a watermark |
| `sites/crombolo/components/shared/logo.tsx` | The product site's mark and favicon |

The marks were traced from the master artwork, so the arcs and the wordmark are
paths: no font is needed to draw them. `tests/branding.test.ts` holds every file
to the same disc and arcs, so a new mark has to land in all of them at once.

## The palette

| Token | Value | Role |
| --- | --- | --- |
| `--crombolo-terracotta` | `#ad4f2c` | The accent: buttons, links, the active tab and section, and the selected tree item's text |
| `--crombolo-terracotta-hover` | `#9b4526` | The accent's hover fill |
| `--crombolo-terracotta-tint` | `#fbeee7` | Behind the selected tree item and the Overview's labels |
| `--crombolo-orange` | `#da987c` | A light tint, behind dark text only: the sign-in backdrop |
| `--crombolo-orange-light` | `#e2ae98` | Hover fill, never text |
| `--crombolo-orange-deep` | `#cb6f48` | The logo's terracotta: focus ring and the disc |
| `--crombolo-orange-text` | `#974b2b` | The accent's darkest step |
| `--crombolo-cocoa` | `#54321f` | Ink: text, icons, the wordmark, the header's text |
| `--crombolo-cream` | `#fff7ea` | The page ground, behind the white sidebar and panels |

The logo's own terracotta can't carry text: white on it is 3.8:1. So the accent
is the same hue deepened until white on it clears AA, at 5.3:1. As text it is
5.0:1 on cream and 5.3:1 on white. The header is white with a hairline under it,
the current section marked in the accent. Crombolo's own cards (the Overview
and the Settings landing page) take a soft shadow, `--crombolo-card-shadow`;
Umbraco's stay flat (story 237). The product site's stylesheet
(`sites/crombolo/css/site.css`) uses the same family, with its own
`--terracotta-*` tokens.

The fork reads three of these where Umbraco hard-codes its own:
`--crombolo-header-line`, `--crombolo-header-current-text` and
`--crombolo-section-sidebar-background`.

### Dark

The back office's dark mode (story 049) is `plugin/branding/theme-dark.css`: the
vendored `dark.css` for every token, then the brand on top of it.

| Token | Value | Role |
| --- | --- | --- |
| `--crombolo-night` | `#1f1813` | The page ground |
| `--crombolo-night-surface` | `#2a211b` | Panels |
| `--crombolo-night-alt` | `#342922` | The alternate surface |
| `--crombolo-night-surface` (header) | `#2a211b` | The header, a panel like the cards, with a hairline |
| `--crombolo-ink` | `#f6ede4` | Text and icons |
| `--crombolo-ink-dimmed` | `#c9b5a5` | Secondary text |
| `--crombolo-orange` | `#da987c` | Accent fill, with dark text, and the focus ring |
| `--crombolo-terracotta-light` | `#e8a688` | Links, the active section and tab, and the selected tree item's text |
| `--crombolo-cocoa-deep` | `#25160e` | Text on the accent |

Cream text clears 13:1 on the panels, and the accent's dark text clears 7.3:1.
`tests/theme.test.ts` checks every pair against WCAG AA. "Match my system"
(`theme-system.css`) is the dark palette behind `prefers-color-scheme: dark`.
High contrast stays Umbraco's own.

## Keeping Umbraco's name out

Nothing a person sees in the backoffice names Umbraco. Three layers do this,
and each one has tests.

- **Rebranded when vendored.** `vendor:backoffice` replaces Umbraco's name in
  every dictionary, in every language, and in the text Umbraco's components
  hard-code (`rebrandModule`, `rebrandDictionary`). It leaves anything that code
  depends on: aliases (`Umb.X.Umbraco`, `Umbraco.RichText`), paths, package
  names, URLs, and `'Umbraco'` used alone as a value, which is the provider name
  the authorize endpoint knows. The fork of Umbraco's client changes the few
  places where that value is also shown on screen
  ([backoffice hosting](backoffice-hosting.md#the-fork-of-umbracos-client)).
- **Our own sign-in dialog.** When a session ends, the client opens
  `Umb.Modal.AppAuth` before any private manifest has loaded. The public
  `plugin/sign-in` package replaces it with `crombolo-sign-in-dialog`.
- **Public overrides.** The language overrides (`plugin/localizations`) are
  public, so the text before sign-in uses the same words as the rest.

`tests/vendor.test.ts` fails if any served dictionary or module still shows the
name. `tests/branding.test.ts` checks the plugin and the server. The browser test
`sign-in-dialog.browser.ts` reads every section and the timed-out dialog.

Some things still carry the name, because changing them would break things:

- Identifiers that come from Umbraco's data model: property editor aliases such
  as `Umbraco.RichText`, and media property aliases such as `umbracoFile`.
  Admins can see these in Settings, but the vendored editor depends on them.
- The product site's copy about migrating from Umbraco
  (`sites/crombolo`).
