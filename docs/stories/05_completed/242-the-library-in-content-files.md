# 242 — The Library in content files

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As a developer declaring a site's content as files, I want Library elements in
folders and a page's Form picker to name a Library form by its path, so that a
site's Library is written the way it appears in the back office.

## Context

Found 2026-11-02, reviewing the CLI's gaps. Two gaps in `content/library`
(docs/bundles.md, "Content files"):
- **Folders:** elements must sit at the top of `content/library`; a folder under
  it is reported (`library-folder`) and not read.
- **Library forms** (story 239): a Library form is declared as an element of
  its form's type, but a page's Form picker (`Crombolo.FormPicker`) takes only
  a raw key. The element picker already resolves Library paths
  (`Umbraco.ElementPicker` in `server/src/seed/compile.ts`).

`bundle export --source` writes both back the same way, so an exported site
applies again unchanged.

## Acceptance criteria

- [x] Folders under `content/library` become Library folders, nested, with
      their elements; `bundle export --source` writes them back as folders
- [x] A Form picker value in a content file takes a Library path
      (`"/contact/main-enquiry"`), resolved as the element picker resolves one,
      or a form's alias for a page that names a form itself
- [x] `bundle build --check` names a path that is not a Library form, by file
      and line
- [x] Export and apply round-trip with no changes; tests on SQLite and Postgres

## What was built (2026-11-08)

- **`content/library/` reads folders** as Library folders, nested, as `element-folder` nodes
  (story 283's kind), and an element's parent is its folder. `.folder.toml` keeps a folder's
  key or name when the directory can't say it.
- **A Form picker value** takes a Library form's path, checked to be one, or a form's alias, or a
  key as before. `bundle build --check` names a wrong one by file and line (`bad-value`).
- **`bundle export --source`** writes folders as directories, and a Form picker as its Library
  path. An exported element is named after its name, as every exported file is.
- **`crombolo content set`** takes a Library form's path too.
