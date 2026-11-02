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

- [ ] Folders under `content/library` become Library folders, nested, with
      their elements; `bundle export --source` writes them back as folders
- [ ] A Form picker value in a content file takes a Library path
      (`"/contact/main-enquiry"`), resolved as the element picker resolves one,
      or a form's alias for a page that names a form itself
- [ ] `bundle build --check` names a path that is not a Library form, by file
      and line
- [ ] Export and apply round-trip with no changes; tests on SQLite and Postgres
