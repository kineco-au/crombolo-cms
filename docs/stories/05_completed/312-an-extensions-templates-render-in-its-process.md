# 312 — An extension's templates render in its own process

**Epic:** I — Hardening · **Priority:** must · **Size:** L
**Depends on:** 311

## Story

As a site builder using an extension's components, I want to place them in my pages
as I would my own, while they render in the extension's process, so that using an
extension's templates never runs its code in the CMS.

## Context

An extension installed from the Marketplace applies its content, and its
`components/` are copied into the site's `components/`. Every render then
imports them into the CMS process, and nobody was asked
(`extension-threat-model.md`, T5, T6). Decision D2: they render in the
extension's process, and the site embeds the HTML.

Story 307 was merged into this one (2026-11-09). Its other half, that an extension
never carries `code/`, shipped with 306.

An extension's content types name the components it carries
(`components = ["brochure"]`). Schema validation refuses a type whose component is
not in the site's `components/` (`schema/src/validate.ts`). Not copying them
therefore needs somewhere else for those names to resolve to.

## Decisions (2026-11-09)

- **Only the extension's own components render in its process.** The page, the
  site's layouts and the site's components render in the CMS as now. When the
  render reaches a component the extension owns (a page template, a block, an
  embed), that one component is a `render` call to the extension's process
  (story 311), and its HTML goes in that place. Children a site component passes
  in are rendered in the CMS first and sent as HTML.
- **Components are part of the server half.** They live in the package beside
  it, are built into the same Deno bundle, and are declared by the factory, as its
  routes are. They are no longer a payload section.
- **The live model, over the channel.** A component reads the page as a site
  component does (`model`, `nav`, `media()`, `menu()`, `dictionary()`). Each read
  is a call back to the CMS, so an extension's components `await` what they read.
  Reads are batched, and a page renders its extension parts concurrently.
- **No browser code in this story:** an extension's component renders HTML
  only. One using islands, `'use client'` or deferred parts is refused.

## Decisions (2026-11-10)

- **The page's values go with each render.** The CMS sends a page's converted
  values with it, so an extension's component reads `model.value()`, `text()`,
  `html()` and `hasValue()` synchronously, as a site component does. `nav`,
  `media()` and other lookups stay calls back to the site. A value that is itself
  a page or an element carries its own values the same way, up to a limit per
  render.
- **The Bundle Editor makes two kinds of bundle,** chosen when one is created:
  - **An extension for other sites:** schema, content, dictionary, styles and
    scripts as its payload. The templates and partial views it picks go to
    `src/components/`, declared by a generated factory, and it asks for
    `templates`. It downloads as an installable extension, and its components
    render in its own process.
  - **A site bundle, to move this site:** everything, components and code
    included, as a site package (`bundleType: "site"`), applied with
    `site apply` or `push` and never installed: what `site export` makes, from the
    back office.
  - The editor shows only what fits the kind. Existing definitions are
    extensions, as 306 made them.

## The bundle structure

Code and data are apart: code stays in the package and runs in the extension's
process, and the payload is data applied into the site.

```
@acme/brochures/
├── package.json          npm's: name, version, peerDependencies, and the crombolo field
├── bundle.json           the payload's manifest and integrity hash (format 8)
│
├── src/                  CODE: never applied to the site; built into one file and
│   │                     run in the extension's Deno process (311)
│   ├── index.ts          the factory crombolo.server names
│   ├── components/
│   │   ├── brochure.tsx  a page template
│   │   └── card.tsx      a block component, also embeddable
│   └── …                 whatever it imports; its dependencies come from package.json
│
├── plugin/               SCREENS: the back-office manifests' files, run in the
│   └── brochures.js      browser under the back office's policy (313)
│
│                         DATA: the payload, listed and hashed by bundle.json,
│                         applied into the site by the import
├── schema/
│   ├── content-types/brochure.toml   components = ["brochures/brochure"]
│   └── element-types/card.toml       component = "brochures/card"
├── nodes/<uuid>.json, values/<uuid>.json   its starting pages
├── media.json, media/
├── styles/, scripts/     browser files, copied as now
└── dictionary/
```

The factory declares its components as it declares its routes:

```ts
import { route } from '@crombolo/extension'
import Brochure from './components/brochure.tsx'
import Card from './components/card.tsx'

export function brochures(settings) {
  return {
    id: 'brochures',
    section: 'content',
    capabilities: ['api', 'log'],
    components: { brochure: Brochure, card: Card },
    routes: [route('index', { GET: … }, { audience: 'backoffice' })],
  }
}
```

| Part | Lands | Runs |
|---|---|---|
| `src/`: server half and components | stays in the package | in its Deno process: routes, events and jobs as calls, components as `render` calls |
| `plugin/` | stays in the package, served to the browser | in the back office, as the signed-in user |
| `schema/`, `nodes/`, `values/`, media, dictionary | applied into the site, then the site's own | nothing; it is data |
| `styles/`, `scripts/` | copied into the site, as now | in the visitor's browser |

## The design

- **An extension writes none of the site's code:**
  - `components/` is no longer a section an extension's `bundle.json` may list.
    It is refused, as `code/` is (306).
  - Its schema names its components by its id, `brochures/brochure`. Schema
    validation and the template picker find them in the package, read-only,
    under the extension's name.
  - Its `schema/migrations/*.ts` are refused: value migrations are code (story
    300).
  - Its styles, scripts and public files are copied as now; its content,
    dictionary and other schema are data, checked as now.
  - Components earlier installs copied are left in place, as the site's own files
    now. `bundle list` names them, from the runs that wrote them, so they can be
    reviewed.
- **Verifying the code:** `bundle.json`'s hash covers the data, as now. The code
  is covered by npm's tarball integrity and `bun.lock`, as the server half is,
  and signing (story 060) covers both.
- **A content-only bundle** (the Bundle Editor's) has no `src/` and no `server`:
  installing content never installs code.
- **Embedding:** a site component renders `<Extension use="brochures/card" … />`,
  with props that are data.
- **On Deno:** the extension's components render with the CMS's JSX runtime,
  which ships in the extension SDK. What they use from `@crombolo/render` runs
  there, or is a call back to the CMS (images and crops, rich text, forms), or is
  refused.
- **Needs `templates`:** an extension renders nothing without that permission.
- **Caching:** an extension's render is cached with the page, and cleared on the
  same changes.
- **Failure:** a render that fails or times out leaves the place empty and logs
  why; the page still renders.

## The layout around its page templates (decided 2026-11-09)

The CMS walks the layout chain with the site's own layouts; only the template's
body comes from the extension. As in Umbraco, where a package's template names
its master by alias, the extension's component suggests one, and the
administrator decides:

- **The suggestion:** a page template exports `layout = 'layout'`, as a site's
  does. It is a guess at the site's layout alias.
- **A picker at install:** the Marketplace's install panel, and `bundle install`'s
  `--layout`, list the site's layouts and preselect the suggestion when the site
  has a layout of that alias. With none matching, nothing is preselected.
- **Kept as a setting:** the choice is the extension's `layout` setting (story
  310), a new setting type whose values are the site's layouts. It is edited in
  the extension's settings view in Installed, set with `crombolo bundle settings`,
  and locked by the config's `extensions.<id>.settings.layout`.
- **Without one:** its page templates render in a bare HTML page, and Installed
  says it has no layout chosen.
- **A layout that goes away:** a page falls back to the bare page, and the health
  check names the setting.

## Acceptance criteria

- [x] An extension's components are not written to the site's `components/`; they
      live in its package, declared by its factory, and its content types resolve
      them as `<id>/<alias>`; its pages render with them.
- [x] An extension whose `bundle.json` lists `components/` is refused, and nothing
      is written.
- [x] An extension carrying `schema/migrations/*.ts` is refused, and nothing is
      written.
- [x] Its styles, scripts, public files, schema and content install as now.
- [x] Components an earlier install copied are listed by `bundle list`.
- [x] `bundles.md` no longer says content is never code; it says where each section
      lands.

- [x] A page embedding an extension's component renders its HTML, and the
      extension's code ran in its own process; the page's layouts and the site's
      components rendered in the CMS.
- [x] Without `templates`, the embed renders nothing and logs why.
- [x] A failing extension render leaves the page rendering.
- [x] The install panel and `bundle install --layout` offer the site's layouts for
      an extension with page templates, preselecting the one its component names
      when the site has it; the choice is its `layout` setting, editable in
      Installed and lockable in the config.
- [x] Its page templates render inside the chosen site layout, or a bare page
      without one.
- [x] `writing-components.md` describes using an extension's components.

## Implemented (0.57.0)

- **Rendering** (`packages/server/src/extension-components.ts`): the renderer
  asks `extensionComponents` for a component the site has none of
  (`Renderer`'s `#load`), so a page template, a block (`blocks/<alias>`) and
  `<Extension use>` (`packages/render/src/extension.ts`, through the render
  scope) all become one `render` call. The layout chain is the renderer's own:
  the stand-in module's `layout` is the extension's `layout` setting, else the
  one its component exports.
- **The page over the channel:** the codec lends objects by reference (`$ref`),
  sends getters as values, awaits promises, and carries `RawHtml` as `$html`.
  Each lent function is bound to the render's async context
  (`AsyncResource.bind`), so personal marking still works. `searchParams` is
  asked for only when read; a render with a signed-in member marks the page
  personal.
- **Values up front:** each page and element a render lends carries its values,
  text and HTML (`$values`, up to 200 per render), and the runner answers
  `value()`, `text()`, `html()` and `hasValue()` from them.
- **The SDK:** the runner describes `components` and answers `render` with the
  CMS's JSX runtime (`@crombolo/render/jsx-runtime`), which the build maps
  `@crombolo/crombolo/jsx-runtime` to. The build refuses `'use client'` and
  `'use deferred'` modules, and any import of the CMS's packages but the SDK's.
- **The payload:** `loadBundle` refuses an extension listing `components/` or
  `schema/migrations/*.ts`.
- **Schema and picker:** `componentAliasesIn(componentsDir, siteDir)` accepts
  any `<id>/<name>` for an installed extension with a server half, since its
  components are known only once it starts. The template picker lists them under
  the extension's name; the template file store already refuses an alias with a
  `/`.
- **The layout setting:** a `layout` setting type, offered with the site's
  components (`siteLayouts`) in Installed and in the Marketplace's grant panel
  (`InstallOutcome.layout`, preselecting the suggestion the site has), set with
  `bundle install --layout`, and saved after install (`InstallRequest.settings`).
  The health check names one whose layout is gone.
- **Copied components:** `componentsWritten` reads a run's file record;
  `bundle list` and Installed name what an extension's last applied run wrote
  under `components/`.
- **The Bundle Editor:** migration 068 adds `bundle.kind`. An extension build
  moves its components to `src/components/` with a generated factory and the
  `templates` permission (`created-extension.ts`, `BundlePackageInfo.code`); a
  site build is a private site package.
- **Differences from the plan:**
  - Schema validation accepts any name under an installed extension's id; a name
    it does not offer renders nothing, and the log says so.
  - The Bundle Editor's kind is set beside the package name in Created, not
    chosen in a separate creation step.
- **Tests:** `tests/extension-components.test.ts`, with the payload refusals in
  `tests/site-packages.test.ts`, the layout offer in `tests/marketplace.test.ts`,
  and both kinds of download in `tests/bundles.test.ts`.
