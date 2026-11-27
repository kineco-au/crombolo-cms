# 449 — A site's public files edited in the back office

**Epic:** O — Building a site · **Priority:** could · **Size:** M
**Depends on:** 284, 377, 381

## Story

As someone looking after a site, I want to add, replace and remove the files in its
public folder from the back office, so that a file served at the root of the site, such
as `llms.txt`, a verification file or a document at `/docs/agents.md`, can be changed
without a developer and a deploy.

## Context

`284` gave a site a `public/` folder (`CROMBOLO_PUBLIC_DIR`), served at the root at the
same paths (`docs/rendering.md`, "Public files"). It decided the folder **is for the
developer, not editors**: the back office doesn't edit it, and it travels with the site
in a bundle, a push and a pull (`docs/bundles.md`, "Public files").

That leaves an editor with two ways to put a file on the site, and neither fits:

- **the Media library,** which serves a file under `/media/…`, never at an address they
  choose such as `/llms.txt`;
- **a page or a site route** that outputs the file's text, which needs a developer to
  write it.

Components, stylesheets and scripts are already edited in the back office as files. A
workspace holds its own copies of them (`377`). A direct write to Shared's is recorded as
its author's change (`381`). And a locked site (`388`) refuses those writes. So a public
file can follow the same path.

## To decide

The design isn't settled. These are the questions, not answers:

1. **Whether this reverses `284`'s "for the developer" rule,** or narrows it: for
   example, the back office edits only text files, or only a folder within `public/`.
2. **Which files:**
   - text only, edited in place (`.md`, `.txt`, `.json`, `.xml`, `.csv`);
   - or any file, uploaded and replaced;
   - and a size limit.

   Files `435` serves sandboxed (HTML, SVG, XML) need a rule of their own.
3. **Who may:** a Settings permission like the one for stylesheets and scripts, or a new
   one.
4. **In a workspace:** whether a workspace holds its own copies of public files, as `377`
   does for components (its site then serves them), or edits go straight to Shared.
5. **Against a push:** a push or a whole-site upload replaces `public/` as it does
   today, which would undo back-office edits. Either the back office's edits are changes
   (`381`) that a push is checked against, or the push wins and says what it overwrote.
6. **Reserved addresses and clashes:** the editor refuses a file at a CMS path (`/umbraco/`,
   `/media/`, …) and warns when a file would hide a page, a route, or the generated
   `robots.txt` or `sitemap.xml`. `crombolo components check` does this today.
7. **Where it lives in the back office:** Settings beside Stylesheets and Scripts, or a
   "Files" area of its own.

## Abandoned (2026-11-27)

Superseded by `450`. The files an editor wants at an address of their own, such as
`llms.txt`, a verification file or a document, are content: they want workspaces, history,
approvals, schedules, permissions and moving between sites, which the content tree already
gives every item and which this story would have rebuilt for one folder. The content tree
couldn't express them because an item's address is reduced to `[a-z0-9-]` and every item
renders HTML through a view. `450` fixes that instead.

`public/` stays the developer's, as `284` made it: a favicon, fonts, images a stylesheet
names, a vendor's built files and `.well-known/` belong to the site's code.

Decided before it was dropped: the whole folder, text edited in place; HTML, SVG and XML
allowed and served sandboxed (`435`), at most 10 MB a file; the Settings section.
`450` starts from the same answers where they still apply.
