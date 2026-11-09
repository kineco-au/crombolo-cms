# 307 — An extension writes none of the site's code

**Epic:** I — Hardening · **Priority:** must · **Size:** S
**Depends on:** —

**Merged (2026-11-09)** into 306, which refuses `code/` in an extension, and 312,
which keeps an extension's components in its package and renders them in its own
process.

## Story

As someone installing an extension, I want it to add nothing to the site's own code,
so that the code it brings runs only where its grant and its process confine it.

## Context

An extension installed from the Marketplace applies its content. Its `components/`
are copied into the site's `components/`, where every render imports them into the
CMS process, and nobody is asked (`extension-threat-model.md`, T5, T6). A `code/`
section is written over the site's own files when install code is asked for.

## The design

- **No `code/`:** an extension (`bundleType` `"extension"`, story 306) carrying
  `code/` is refused at check and at install, naming the section.
- **Its components stay in its package:**
  - An extension's `components/` are not copied into the site's.
  - Until story 312 renders them in the extension's process, a page cannot use
    them, and the install says so.
  - Components that earlier installs copied are left in place: they are the site's
    own files now. `bundle list` names them, so they can be reviewed.
- **Browser assets unchanged:** an extension's styles, scripts and public files are
  copied as now. They run in the browser, not on the server.
- **Content and schema unchanged:** they are data, checked as they are now.

## Acceptance criteria

- [ ] An extension with `code/` is refused at check and install, and nothing is written.
- [ ] An extension's components are not written to the site's `components/`.
- [ ] Its styles, scripts, public files, schema and content install as now.
- [ ] `bundles.md` no longer says content is never code; it says where each section lands.
