# 450 — A content item served as a file

**Epic:** O — Building a site · **Priority:** should · **Size:** L
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
  - **its body:** one field, edited in the editor that suits the File's extension (below),
    or an upload;
  - **settings:** allowed at the root and under any page or File, and never a view or a
    layout.

  It goes into a site's schema as every built-in does, and moves with it.
- **An editor for each kind of File:** the body field (`Crombolo.PropertyEditorUi.FileBody`)
  chooses its editor from the File's name, and changes when the extension does. Each is
  one the back office already has:

  | Extension | Editor | Checked on save |
  |---|---|---|
  | `.md` | the Markdown editor, with its preview | — |
  | `.txt` | a plain text area | — |
  | `.json`, `.webmanifest` | the code editor, in JSON | well-formed JSON, refused with the line and column |
  | `.xml` | the code editor, in XML | well-formed XML, refused the same way |
  | `.html` | the code editor, in HTML, saying it is shown with no scripts run | — |
  | `.svg` | the code editor, in XML, with the image shown beside it | well-formed XML |
  | `.csv` | a plain text area, with its first 20 rows shown as a table | — |
  | `.pdf`, images | the upload field, with the image, or the PDF's name and size and a link to open it | the 10 MB limit |

  - **Renaming between kinds:** a File renamed from a text extension to an upload one, or
    the other way, keeps its body until saved. The field then says the body has to be
    replaced, and the save is refused until it is.
  - **The checks:** they run in the editor as you type, and again on the server, so a
    File that isn't well-formed is never published.
- **In the content tree:** the Create menu offers **File** at the root and under every page,
  whatever each content type lists as its allowed children, since a File may sit anywhere
  (decision 2).
  - **How:** the server adds the File type to its answers for the types allowed at the
    root and a type's allowed children (`Get{T}AllowedAtRoot`,
    `Get{T}ByIdAllowedChildren`, documents only). The back office's own Create menu then
    offers it with no change of its own.
  - **Under a File** (a folder), only File is offered.
  - **In the tree,** a File's icon follows its extension: a text, code or image icon, or a
    folder for a File with children and no body.
  - **Who may create one:** whoever may create content under that page. Content
    permissions apply as to any item.
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
- **Links from a view, by path:**
  - **The helper:** `file('/docs/agents.md')`, exported beside `asset()`, answers that
    File's address while a published File answers at that path. Otherwise it keeps the
    path, and development logs that no File is there, as `asset()` does for a missing
    stylesheet.
  - **The Insert menu:** the template editor's Insert menu gains **A link to a file**. It
    picks a File from the content tree, then inserts
    `<a href={file('/docs/agents.md')}>agents.md</a>` at the cursor and the import at the
    top of the view, as "A personalised part" does.
  - **By path, not key:** the link names the path, as the view reads it. A File moved or
    renamed leaves the link at its old path, so the server's start-up log names a `file()`
    path no File answers.
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

- [x] **A File item** with a text body is created at the root as `llms.txt` and served at
      `/llms.txt` as `text/plain`, its name kept exactly.
- [x] **The Create menu** offers File at the root and under any page, whatever its type
      allows, and only File under a File. A File shows the icon for its extension, and a
      folder File the folder icon.
- [x] **A File under a page,** and a File inside a folder File, answer at their full
      paths. A folder answers nothing at its own address.
- [x] **Each extension opens in its editor:** Markdown with preview, plain text, JSON, XML,
      HTML and SVG in the code editor (SVG with its image), CSV with a table, uploads with
      their preview. Renaming a File switches the editor, and asks for a new body when the
      kind changes.
- [x] **JSON, `.webmanifest`, XML and SVG** that aren't well-formed are refused on save,
      naming the line and column, in the editor and on the server.
- [x] **An upload** (a PDF, an image) is served with its type. A text body for an image
      type is refused, and so is an upload over 10 MB.
- [x] **An upload is stored under `files/`** in the site's file store, never answered at
      `/media/…` or a store's public address, and reached only through the File's address
      and the Delivery API's file route. Each version keeps its own, and it moves between
      sites as a blob.
- [x] **An extension off the list** is refused, naming the list, and **two items at one
      address** are refused, naming both.
- [x] **HTML, SVG and XML Files** are served sandboxed, and every File with `nosniff`.
- [x] **The order:** `public/` wins over a File, a File named `robots.txt` replaces the
      generated one, and a File wins over a route and a page. Saving a File that
      something above it answers warns, naming what wins, and `components check`
      reports it.
- [x] **Cached as a page** (ETag, cleared on publish), behind Public Access, previewed
      raw, scheduled, approved, held in a workspace, and moved between sites as a change.
- [x] **Pickers and links** choose a File and link to its address.
- [x] **A view links to a File by path:**
  - `file('/llms.txt')` answers its address;
  - a path no File answers keeps its path and is logged in development;
  - the template editor's **A link to a file** inserts the link and its import for a
    File chosen from the tree.
- [x] **The Delivery API** lists Files with their address, type and size, and answers a
      File's bytes at `file?path=`, under the key and Public Access.
- [x] **The agents' guide File** says in its editor that agents read it as instructions.
- [x] **Tests:**
  - serving, the order, names and extensions, uploads, caching, the Delivery API, and
    the workspace;
  - the allowed-at-root and allowed-children answers, with File added for documents only;
  - `file()` with a File there and without, and the Insert entry's text;
  - the editor each extension chooses, the kind changing on a rename, and the
    well-formedness checks on the server;
  - on both dialects, if a migration is needed;
  - a browser journey: make `llms.txt`, preview it, publish it, open it.
- [x] **Docs:** `docs/rendering.md` (who answers at an address), `docs/delivery-api.md`,
      `docs/changes.md` if relevant, and the release notes.

## Built

- **The type** (`packages/core/src/files.ts`, `packages/data/src/schema/built-in-content-types.ts`):
  `FILE_TYPE`, a system content type with key `SYSTEM_CONTENT_TYPE_KEYS.File`, ensured at every
  boot like the other built-ins, so no migration. Its alias is **`fileItem`**, not `file`: content
  type aliases are unique whatever their case, and the File media type already has `File`. One
  field, `body`, on the seeded "File body" data type (`Crombolo.FileBody`, editor UI
  `Crombolo.PropertyEditorUi.FileBody`, Ntext). A text body is stored as the string; an upload as
  `{ src, name, size, contentType }` with `src` under `files/` (`fileUploadOf`), which
  `toEditorValue` hands the editor parsed. `FILE_KINDS` is the extension table, with content
  type, text or upload, sandbox, editor and tree icon.
- **Names, bodies and checks** (`packages/backoffice-host/plugin/file-kinds.js`, exported as
  `@crombolo/backoffice-host/file-kinds`): `nameProblem`, `bodyProblem`, `wellFormedJson` and
  `wellFormedXml` (small parsers that answer line and column), `editorFor`, `replaceNote`,
  `csvRows`. The editor runs them as you type; the server's save runs the same module, so the
  refusal is the same words. `tests/file-items.test.ts` holds its table to core's.
- **The save** (`packages/content/src/operations.ts`): `checkItem`, a hook every create, save and
  publish-on-save runs before writing, answering a refusal, property errors or warnings; a `Done`
  result carries `warnings`, which the document handlers add as `Warning` notifications. The
  server's (`createFileItemCheck`, `packages/server/src/file-items.ts`) checks the name (the
  parent's for `.well-known`), the body (with a temporary upload's name and size), the siblings
  and any published item at the address, and warns when the CMS or a `public/` file answers
  there. `placementRefusal` lets a File go anywhere and only a File inside one.
- **Uploads** (`file-intake.ts`, `media-files.ts`): the intake now receives the item's key and
  the version being written, and places a File's upload with `MediaFileStore.placeAt` at
  `files/<key>/<version>/<name>`, refusing one over 10 MB (`FileUploadTooLargeError`).
  `MediaFileStore.key()` refuses the prefix, so `/media/` and `publicUrl` never reach it.
  `removeUnnamedFileObjects` runs after the hourly version cleanup.
- **Addresses** (`published-cache.ts`): a File's segment is its name (`fileSegment`); a File is
  never the first root and sorts after the pages at the root; a top-level folder File stays in
  its Files' paths with the top level hidden; `resolve` tries the path as a File's name is escaped
  when the raw one misses. `isVisible` is false for a File, and the sitemap leaves it out (no
  view). `fileAt(path)` reads the snapshot served now; `files()` lists them.
- **Serving** (`server.ts`): `serveFileItem` in `siteFiles`, after `publicFiles.serve` and before
  `siteRoutes.handle`; the generated robots and sitemap give way to a File. Preview answers the
  draft's bytes, `/<key>` or by address; Public Access hands a refused visitor to `renderPage`
  for the login or error page; a public answer goes through `cacheable` with the type's lifetime
  and purge tags. `fileBodyOf` and `fileHeaders` (`nosniff`, sandbox) are shared with the
  Delivery API. At start the log names each File something above it answers
  (`unansweredFiles`) and each `file()` path in a view no File answers (`fileLinksIn`).
- **`file()`** (`packages/render/src/assets.ts`, exported from `@crombolo/crombolo`): a resolver
  the server sets, like `asset()`'s, answering a published File's URL by path, logging a miss once
  in development.
- **The Management API:** `Get{T}AllowedAtRoot` and `Get{T}ByIdAllowedChildren` add the File type
  for documents, and answer only it for the File type. Tree items give a File its kind's icon, a
  folder File `icon-folder`. `GET {pluginPath}/api/file-item/{key}` answers the address, what wins
  there and whether it is the agents' guide; `…/body` the last saved bytes, for the upload's
  preview.
- **The editor** (`plugin/file-body.js`): `UmbFormControlMixin` over the dataset's name; the
  back office's `umb-input-markdown` (preview), `uui-textarea`, `umb-code-editor` (json, xml, html)
  and `umb-input-upload-field`, an SVG drawn beside its code, a CSV's first 20 rows as a table, the
  sandbox note on HTML, the note to replace a body of the other kind, what wins at its address,
  and the agents' guide note. No fork change: the Create menu, the insert menu's
  `extraInserts` and the property editor are all reached through what the back office offers.
- **The Insert menu** (`view-parts.js`, `tsx-editors.js`): "A link to a file" picks a File with
  the document picker (filtered to the File type), reads its URL, and inserts
  `<a href={file('…')}>name</a>`, adding `file` to the view's `@crombolo/crombolo` import or a
  line of its own (`withNamedImport`).
- **The Delivery API** (`api-delivery`): a File's `body` property is `{ path, contentType, size,
  url }`; `GET v2/file?path=&host=` answers the bytes under the key, Public Access and preview,
  through the new `fileBytes` port. Delivery routes treat a File at the root as never the home
  page and keep a top-level folder in its Files' paths.
- **Moving between sites:** a bundle's export lists a document's File upload in `blobKeys` and the
  manifest's blobs, so `missing-blob` applies as for media; a change carries it among its media
  (`carriedFilesIn`), read and written by its store key.
- **`crombolo components check`** reports Files never answered, read from the site's database
  when there is one (`fileClashes`, read-only).
- **Tests:** `tests/file-items.test.ts` (serving, names, extensions, the order, uploads and
  versions, caching, preview, Public Access, the workspace, the allowed-type answers, icons, the
  Delivery API, bundles and changes, `file()`, the Insert entry, the editor's choices and checks,
  the editor's endpoint, never-answered Files); the journey `tests/browser/file-items.browser.ts`.
  No migration, so no dialect-specific test.

### Not built, or built differently

- **A move** is not checked for two items at one address: the check runs on a save, as the
  story says; a File moved onto a taken address is refused at its next save.
- **A store's public address:** the CMS never gives one for `files/`, and `/media/` refuses it. A
  CDN an operator points straight at the store's root is outside the CMS; the release notes say to
  leave `files/` out of it.
- **Addresses match whatever their case**, as page addresses do, while a File's link keeps the
  case it was named with.

## Out of scope

- A Markdown copy beside every HTML page (`/about.md` for `/about`), derived from the
  page, raised in `371`: a story of its own if wanted.
- Editing `public/` from the back office (`449`, abandoned).
