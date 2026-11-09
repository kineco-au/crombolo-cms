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

## The design

- **An extension writes none of the site's code:**
  - Its `components/` are never copied into the site's. They stay in its package.
  - Its schema names them under its id, `<id>/brochure`. Schema validation and the
    template picker find them in the package, read-only.
  - Its `schema/migrations/*.ts` are refused: value migrations are code (story
    300), and an extension's code runs only in its own process.
  - Its styles, scripts and public files are copied as now. They run in the
    browser, not on the server. Its content, dictionary and other schema are data,
    checked as now.
  - Components earlier installs copied are left in place, as they are the site's own
    files now. `bundle list` names them, from the runs that wrote them, so they can
    be reviewed.

- **Embedding:** a site component renders `<Extension use="<id>/<component>" … />`
  with props that are plain data, such as the page's content model or values. The
  CMS asks the extension's process to render it, and puts the HTML in place.
- **On Deno (story 311):** the extension's components render with the CMS's JSX
  runtime, which ships in the extension SDK and has to run on Deno as well as Bun.
  Whatever a component imports from `@crombolo/render` is checked to run there.
- **Needs `templates`:** an extension renders nothing without that permission.
- **In the back office:** the extension's components are listed in the template
  picker under the extension's name, read-only.
- **Caching:** an extension's render is cached with the page, and cleared on the
  same changes.
- **Failure:** a render that fails or times out leaves the place empty and logs why;
  the page still renders.

## Acceptance criteria

- [ ] An extension's components are not written to the site's `components/`; its
      content types resolve them as `<id>/<alias>`, and its pages render with them.
- [ ] An extension carrying `schema/migrations/*.ts` is refused, and nothing is
      written.
- [ ] Its styles, scripts, public files, schema and content install as now.
- [ ] Components an earlier install copied are listed by `bundle list`.
- [ ] `bundles.md` no longer says content is never code; it says where each section
      lands.

- [ ] A page embedding an extension's component renders its HTML, and the
      extension's code ran in its own process.
- [ ] Without `templates`, the embed renders nothing and logs why.
- [ ] A failing extension render leaves the page rendering.
- [ ] `writing-components.md` describes using an extension's components.
