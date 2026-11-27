# 450 — A content item served as a file

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** 284, 377, 381

## Story

As someone looking after a site, I want to keep a file such as `llms.txt`, a verification
file or a guide for agents in the content tree, at the exact address I give it, so that it
is edited, approved, scheduled and moved between sites like any other content, without a
developer and a deploy.

## Context

Supersedes `449` (editing `public/` in the back office) and `371` (pages served as
Markdown). Both wanted an editor's file at an address of its own. What the content tree
couldn't do is why `449` reached for `public/`:

- **The address:** an item's URL segment is reduced to `[a-z0-9-]`
  (`render/src/url-segment.ts`), so an item named `llms.txt` lands at `/llms-txt`. No item
  sits at an exact address with an extension.
- **The response:** every item renders HTML through a view. Site routes (`211`) can answer
  with any text, but only as code a developer writes.

As content, a file gets for nothing what `449` would have rebuilt for one folder:
- workspaces (`377`), and history and revert (`381`);
- approval workflows and schedules;
- permissions;
- moving between sites as a change (`388`);
- preview, and languages.

`public/` stays the developer's, as `284` made it: a favicon, fonts, images a stylesheet
names, a vendor's built files and `.well-known/` belong to the site's code.

**The first use** is `370`'s guide for agents, whose address is the deployer's setting
(`remote.agentsGuide`). Its text could be a file item at `/agents-guide.md`.

## Carried from 449 and 371

Where they still apply, `449`'s decisions are the starting point:
- HTML, SVG and XML are allowed, and served sandboxed as `public/` serves them (`435`), so
  nothing in them runs;
- an uploaded file is at most 10 MB.

`371` asked who may edit text that an agent reads as instructions. Anyone who edits it is
writing instructions for that agent. Page permissions apply and a workflow can gate it;
the story should say so, and decide whether more is needed.

## Decided (2026-11-27)

1. **One built-in File type,** the same in every site and not changed by a site. Its body
   is either text edited in place or an uploaded file. Rejected: marking any content type
   as a file, and text only.
2. **Its name, extension included, is its address exactly,** anywhere in the tree, root
   included. A File may hold child Files. A File with children and no body is a folder:
   nothing answers at its own address, only its children. Rejected: root only, and no
   children.
3. **A known list of extensions,** each with its content type. Any other is refused with
   the list. A text body only for the text types; images and PDFs need an upload.
4. **File items answer after `public/` and before routes:**
   1. the CMS's own paths;
   2. `public/`;
   3. File items;
   4. the generated `robots.txt` and `sitemap.xml`, which a File of that name replaces;
   5. site routes;
   6. pages.

   Saving a File whose address something above it already answers is allowed, and warns,
   naming what wins. Rejected:
   - Files winning over `public/`;
   - refusing a clash;
   - Files after routes.
5. **Cached as pages, previewed raw, and linked like pages.** Rejected: `public/`'s
   caching, and no preview or links.
6. **In the Delivery API, with a route for the raw bytes.** Rejected: metadata only, and
   not there at all.
7. **A guide for agents follows the normal rules,** said plainly. Rejected: requiring
   approval for it, and administrators only.
8. **Where the bytes live:**
   - **A text body** is the item's property value, in the database, so versions,
     workspaces and changes carry it as any text.
   - **An upload** is in the site's file store, the media store's local folder, S3 or
     Azure (the site's bucket on Crombolo Cloud), under a private prefix,
     `files/<item key>/<version>/<name>`.
   - **The only way in** is the File's own address and the Delivery API's file route,
     with their checks: `/media/` never serves that prefix, and a store's public address
     never covers it.

   Rejected:
   - the bytes in the database, up to 10 MB a version in it, its backups and every
     change;
   - under `/media/` as content uploads are today, where a draft or protected File's
     upload could be fetched by its path.

## The design

- **The File type:** a content type the CMS defines, like a folder, with:
  - **its body:** text, edited in a code editor that highlights by the extension, or an
    upload;
  - **settings:** allowed at the root and under any page or File, and never a view or a
    layout.

  It goes into a site's schema as every built-in does, and moves with it.
- **Its name:** kept as typed, never reduced to a slug. It must be a valid path segment:
  no `/`, no `?` or `#`, no leading dot except under `.well-known`. A folder's name has
  no extension, and a File with a body must have one from the list. Two items answering
  at one address are refused when saved, saying which.
- **Extensions and content types:**

  | Extension | Served as | Body |
  |---|---|---|
  | `.txt` | `text/plain; charset=utf-8` | text or upload |
  | `.md` | `text/markdown; charset=utf-8` | text or upload |
  | `.json` | `application/json` | text or upload |
  | `.xml` | `application/xml`, sandboxed | text or upload |
  | `.csv` | `text/csv; charset=utf-8` | text or upload |
  | `.webmanifest` | `application/manifest+json` | text or upload |
  | `.html` | `text/html; charset=utf-8`, sandboxed | text or upload |
  | `.svg` | `image/svg+xml`, sandboxed | text or upload |
  | `.pdf` | `application/pdf` | upload |
  | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico` | their image type | upload |

  Every answer carries `X-Content-Type-Options: nosniff`. HTML, SVG and XML carry
  `Content-Security-Policy: sandbox`, as `public/` serves them (`435`). An upload is at
  most 10 MB.
- **Who answers:** the order in decision 4.
  - **Where it's decided:** `route()`, between public files and the generated files.
  - **The warning on save:** in the File's workspace, naming what wins.
  - **The check:** `crombolo components check` and the server's start-up log report a
    File that is never answered.
- **Storage:** a text body is a property value. An upload goes through the save-time
  intake (`file-intake.ts`) to `files/<item key>/<version>/<name>` in the site's file
  store, never under the media root, and the property value holds that key.
  - **Versions:** each version keeps its own object, so history and revert work, and an
    object goes when its version is cleaned up, as media files do.
  - **Workspaces:** a workspace's upload is its own object until merged.
  - **Moving between sites:** change transfer and site bundles carry the objects as
    blobs, as media, with `missing-blob` as for media.
  - **Public addresses:** the `/media/` route and a store's public address
    (`CROMBOLO_MEDIA_PUBLIC_URL`, S3 or Azure) never reach the prefix. A test holds both.
- **Serving:**
  - A published File comes from the published cache, with an ETag from its bytes and a
    page's `Cache-Control`, cleared on publish.
  - Public Access applies, as to a page.
  - Preview shows the draft's bytes as a browser would.
  - Workspaces, schedules, workflows, history and change transfer apply as to any item.
- **Links:** content pickers and rich-text links can choose a File, and link to its
  address.
- **The Delivery API:**
  - A File is an item of type File, with its address, content type, size and a link to
    its bytes.
  - `GET /umbraco/delivery/api/v2/file?path=<address>` answers the bytes with their
    content type.
  - The API key and Public Access apply as to content.
- **A guide for agents:** the File editor, for the File `remote.agentsGuide` names, and
  the docs, say that its text is read by coding agents as instructions, and that a site
  which cares puts it under a workflow. `370`'s guide can then be a File at
  `/agents-guide.md`.

## Acceptance criteria

- [ ] **A File item** with a text body is created at the root as `llms.txt` and served at
      `/llms.txt` as `text/plain`, its name kept exactly.
- [ ] **A File under a page,** and a File inside a folder File, answer at their full
      paths. A folder answers nothing at its own address.
- [ ] **An upload** (a PDF, an image) is served with its type. A text body for an image
      type is refused, and so is an upload over 10 MB.
- [ ] **An upload is stored under `files/`** in the site's file store, never answered at
      `/media/…` or a store's public address, and reached only through the File's address
      and the Delivery API's file route. Each version keeps its own, and it moves between
      sites as a blob.
- [ ] **An extension off the list** is refused, naming the list, and **two items at one
      address** are refused, naming both.
- [ ] **HTML, SVG and XML Files** are served sandboxed, and every File with `nosniff`.
- [ ] **The order:** `public/` wins over a File, a File named `robots.txt` replaces the
      generated one, and a File wins over a route and a page. Saving a File that
      something above it answers warns, naming what wins, and `components check`
      reports it.
- [ ] **Cached as a page** (ETag, cleared on publish), behind Public Access, previewed
      raw, scheduled, approved, held in a workspace, and moved between sites as a change.
- [ ] **Pickers and links** choose a File and link to its address.
- [ ] **The Delivery API** lists Files with their address, type and size, and answers a
      File's bytes at `file?path=`, under the key and Public Access.
- [ ] **The agents' guide File** says in its editor that agents read it as instructions.
- [ ] **Tests:**
  - serving, the order, names and extensions, uploads, caching, the Delivery API, and
    the workspace;
  - on both dialects, if a migration is needed;
  - a browser journey: make `llms.txt`, preview it, publish it, open it.
- [ ] **Docs:** `docs/rendering.md` (who answers at an address), `docs/delivery-api.md`,
      `docs/changes.md` if relevant, and the release notes.

## Out of scope

- A Markdown copy beside every HTML page (`/about.md` for `/about`), derived from the
  page, raised in `371`: a story of its own if wanted.
- Editing `public/` from the back office (`449`, abandoned).
