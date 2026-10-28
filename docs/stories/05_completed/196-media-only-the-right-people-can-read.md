# 196 — Media only the right people can read

**Epic:** D — Members and identity · **Priority:** should · **Size:** L
**Depends on:** 030, 031 · **Followed by:** 198 (members create media)

## Story

As a site whose members upload files, such as observation photos, I want
media folders and items to say which member groups may read and edit them,
and what files created in a folder get, so that files can live in the media
library without being public.

## Context

Pages have public access (`PublicAccessRepository`, Umbraco's protect-a-page).
Media has none.
- **`/media/<path>` serves any key** in the media store, whether or not a media
  item owns it (`serveMedia` in `server.ts`). Where the store has a public URL,
  such as a CDN or a public bucket, it redirects there instead.
- **A crop is served the same way**, and cached for a year as `public`.
- **The back office** shows every media item to anyone with the Media section.

Page rules don't fit files as they are:
- `public_access` needs a login page and an error page.
- A per-member rule is a row each.
- The Delivery API reads every rule on every request
  (`PublicAccessRepository.allRules`).

Raised by Nature's Calendar (`wt-natures-calendar` stories 014 and 044):
members attach photos to observations, millions of them, and only the member
who took one, and back-office users, may see it. The decision was to keep them
in the media library rather than give bundles storage of their own (188), so
the library has to protect them. Story 197 makes the library scale to that
many items.

## Decided (2026-10-28)

- **Managed like page access, in the back office.** A media folder or item can
  be given permissions. The common case is a folder, whose permissions apply to
  everything below it. An explicit rule on a child folder or item **replaces**
  what it would inherit: the nearest rule wins, as for protected pages. So a
  subfolder can be made stricter, looser, or public again.
- **Read and write are separate permissions,** each granted to any number of
  member groups.
- **A folder sets what its new files get.** For a file created in it later, the
  folder's administrator chooses:
  - **who may see it:** public (with a warning that anyone with the link can
    open it), members of the folder's read groups, or only the member who
    created it;
  - **who may edit it:** members of the folder's write groups, only the member
    who created it, or no member.

  These are stamped on each new file as it is created, so changing a folder's
  defaults later affects only files created afterwards. A file's own setting
  can always be changed. They are stored as columns on the media item, not one
  rule row per file, so millions of files cost no extra rows.
- **A member is a file's creator, not its owner.** The media item records the
  member who created it (`creator_member_key`). "Only the creating member" in
  a rule refers to that. The creator gains nothing else.
- **Who else may read.** A back-office user with the Media section may read a
  protected file, within their Media start nodes. API clients act with their
  user's rights. A Delivery API member token (030) is treated as the member's
  site cookie.
- **Serving.**
  - A protected file and its crops are checked, then streamed by this server
    with `cache-control: private, no-store`. They are never redirected to the
    store's public URL, on any store.
  - Signed, short-lived URLs are a later story.
  - Unprotected media keeps today's headers and redirects.
- **Without access:** `/media/…` answers 404, so a shared or guessed link does
  not confirm that the file exists. The Delivery API's media endpoints answer
  401 when not signed in and 403 when not allowed, as they already do for pages.
- **Files no media item owns are not served.** 196 adds an indexed file-URL
  column on media items and resolves every `/media/` request through it. A key
  with no item, apart from the reserved prefixes the server uses itself,
  answers 404. Story 197 reuses that column rather than adding its own.
- **Members create media through a bundle capability,** which is story 198,
  not this one. 196 ships the permissions, the creator column, serving and the
  Delivery API. 198 lets a server bundle create and edit media as the signed-in
  member, under these permissions.

## Plan (2026-10-28)

1. **Migration `AddMediaAccess`**, an expand step on both dialects.
   - `media_access` (`node_id`, unique, on a media node), and
     `media_access_rule` (`media_access_id`, `member_group`, `can_read`,
     `can_write`).
   - On a folder's `media_access` row: `new_read`, `new_write` (the defaults
     for files created below it) and `public_read`, for "anyone".
   - On each media item:
     - `creator_member_key uuid NULL`;
     - `read_policy` and `write_policy`: `inherit`, `public`, `groups`,
       `creator` or `none`, stamped at creation;
     - an indexed `file_url`, the file's `/media/…` path, written whenever
       its file value is saved and backfilled by the migration.
   - Undone in every test rewind helper, the integration one included.
2. **The repository and the rule,** in `@crombolo/data` and `core`.
   - `MediaAccessRepository`: the nearest rule by `path`, as `entryFor` finds
     a page's; save and remove; `byUrl(url)` returns the item, its creator,
     its policies and its effective rule in one query; `stampNew(folder)`.
   - A pure `memberMay(action, item, rule, member)` in core, beside
     `memberMayOpen`, with every case tested.
3. **Media writes** (`@crombolo/content`). Creating an item stamps its policies
   from the nearest folder's defaults, and records the creator when the actor
   is a member (from 198). Saving and moving keep both.
4. **The back office and API.**
   - The API: non-contract endpoints under
     `<backoffice>/crombolo/api/media-access/{key}`, to read and set a
     folder's or item's permissions and defaults. They are gated on the Media
     section and the start nodes, and audited.
   - The back office: an entity action, "Permissions", on media folders and
     items. Member groups get read and write ticks, and a folder also sets its
     defaults for new files. "Public" carries the link warning. The inherited
     rule is shown, with "Set its own". A "Protected" badge appears in the
     workspace. The wording is for editors, with no technical terms.
5. **Serving** (`serveMedia` in `server.ts`).
   - Resolve the item through `file_url`. With none, answer 404.
   - Work out who may read it: the item's policy, or the effective rule.
   - For a protected item, identify the member (cookie) or back-office user
     (session) and check them with `memberMay('read', …)`. If they may not,
     answer 404. If they may, stream the file `private, no-store`, crops
     included, and never redirect to `publicUrl`.
6. **The Delivery API.** Protected items are filtered out of the media lists
   for callers who cannot read them. The item endpoints answer 401 or 403. A
   media reference expanded inside content keeps only its key and name for
   such a caller. Folder rules are few, so reading them per request stays
   cheap.
7. **Rendering.** A media picker on a page still renders the URL, and the file
   itself is guarded by step 5. The page's own access is separate, as now.
8. **Transfer and whole-site files.** Media permissions, defaults and the
   per-item policies travel with media nodes, past the documents-only branch
   in `export.ts`. A creator travels as a member key, and resolves where that
   member exists.
9. **Tests, on both dialects:**
   - each permission and default;
   - replacement by a nearer rule;
   - "public" inside a protected folder;
   - the creator, a group member, another member, an anonymous visitor, and a
     back-office user inside and outside their start nodes;
   - crops streamed, with a store that has a public URL;
   - a key with no item;
   - the Delivery API's 401, 403 and filtering;
   - a transfer round trip;
   - the migration's rewind.
10. **Docs.** Protected media, and what a CDN or public bucket must not front.
    The boot warning when a public URL is set says protected files never use
    it. The release notes.

## Acceptance criteria

- [x] A media folder or item can be given read and write permissions for
      member groups, in the back office and through the API. Children inherit
      a folder's permissions, and a nearer explicit rule replaces them.
- [x] A folder sets who may see and edit files created in it later: public
      (with a warning), its groups, or only the creating member. These are
      stamped on each new file.
- [x] A media item records the member who created it, as its creator.
- [x] `/media/<path>` and its crops answer a protected file only to someone
      allowed to read it, and never by redirecting to a public URL. The
      response is not publicly cacheable. Anyone else gets 404.
- [x] A key no media item owns is not served.
- [x] The Delivery API and the media pickers in rendered pages follow the same
      permissions. A protected item does not appear to someone who cannot read
      it, and the Delivery API answers 401 or 403.
- [x] The permissions, defaults and per-item settings travel with content
      transfer and whole-site files, as page access does.
- [x] Tests:
      - each permission and default;
      - inheritance and replacement;
      - crops;
      - a store with a public URL;
      - the 404, 401 and 403 answers;
      - the Delivery API;
      - both dialects.
- [x] `docs/` describes protected media and what a host's CDN must not front.

## Out of scope

- Members creating or editing media: story 198.
- The cache scaling a library of millions of items: story 197.
- Signed, short-lived URLs for protected files.
- Encrypting files at rest.

## As built (2026-10-28)

- **Migration 050 `AddMediaAccess`** (expand, release 0.35.0, both dialects).
  - `media_access(id, node_id unique, public_read, new_read, new_write,
    create_date, update_date)` and `media_access_rule(id, media_access_id,
    member_group, can_read, can_write)`, unique on `(media_access_id,
    member_group)`.
  - On `content`: `file_url` (indexed `ix_content_file_url`),
    `creator_member_key`, `read_policy` and `write_policy`. A null policy is
    `inherit`, so documents carry nulls.
  - `node_file(node_id, url)`, indexed on both: the files a page's, element's
    or member's upload and image cropper values name. **Added beyond the plan:**
    without it, "a key no media item owns is not served" would have stopped
    every page's upload field being served.
  - Both are backfilled in SQL (JSON `src` by `json_extract` on SQLite and a
    regular expression on Postgres), so `crombolo upgrade --plan` still plans
    the step.
  - Undone in `tests/support/db.ts` (`undoMediaAccess`, called from
    `undoMigrationsSinceContentEditing`), `upgrade-from-release.test.ts`
    (now rewinding to 0.34.0), `permissions.test.ts` and
    `integration/first-boot.integration.ts`.
- **The rule** (`packages/core/src/media-access.ts`).
  - `memberMay(action: 'read' | 'write', item: MediaItemAccess, rule:
    MediaRule | undefined, member: MediaMember | undefined): boolean`. The
    item's own policy wins; `inherit` follows the nearest rule, and with no
    rule anyone may read and no member may write. `public` never grants write.
  - `nearestMediaRule(path, rules)`, `isProtectedMedia`, `stampedPolicies`.
  - `MediaRule` carries `nodeId`, `publicRead`, `readGroups`, `writeGroups`,
    `newRead` and `newWrite`, so 198's member types and size limit add fields
    beside them.
- **The repository** (`MediaAccessRepository`, `@crombolo/data`): `allRules`,
  `byNodeKey`, `ruleFor(key, { above })`, `save`, `remove`, `itemAccess`,
  `setItemAccess`, `setCreator`, `stampNew(key, creatorMemberKey)`,
  `byUrl(urls)` (the item, its path, whether trashed, its settings and its
  nearest rule, in two queries through `file_url`), `ownedElsewhere(urls)`
  (`node_file`) and `itemSettings` (for the published cache). `recordFiles` is
  called by `DocumentRepository` on create, save and rollback, so every path
  that writes content keeps `file_url` and `node_file` current; a delete
  removes a node's rule and files.
- **Media writes.** `MediaOperations.create` stamps the item's policies from
  the nearest rule above it and records `creatorMemberKey` when given (198's
  member actor will pass it). Saving and moving leave both alone.
- **Serving** (`serveMedia`, `packages/server/src/media-access.ts`).
  - Resolved through `byUrl`; with no owner and no `node_file` row, 404.
  - A protected file is read by a member (site cookie, or a Delivery API
    member token when member sign-in is on) whom `memberMay` allows, or a
    back-office user with the Media section within their start nodes.
    Otherwise 404. Allowed, it and its crops are streamed `private, no-store`,
    never via `publicUrl`.
  - **Decided here:** a file in the recycle bin is treated as protected and
    read only by a back-office user (with root media access, as Umbraco's path
    rule has it), because the bin's path no longer passes under the folder
    that protected it.
  - Besides media items, `node_file` and a back-office user's avatar
    (`user_account.avatar`) own files, which are served as before. A form
    upload is owned by nothing and so is no longer served by URL (its
    workflows read the store directly); flagged in the release notes.
  - A boot warning names the store's public address and says protected files
    never use it.
- **The API**, `<backoffice>/crombolo/api/media-access/{key}`: `GET` describes
  the folder or item (its own rule, the inherited one and where from, its file
  settings and creator, whether it is protected, and the site's member
  groups); `PUT { rule?, item? }` sets them (`rule: null` takes its own rule
  off); `DELETE` takes it off. Reading needs the Media section and the start
  nodes; writing needs `Crombolo.Media.Update` too. Writes are audited as
  `MediaAccess` in the media category.
- **The back office** (`plugin/media-access*.js`): a **Permissions** entity
  action on media (not in the bin, for users who may change media) opens a
  sidebar with a group table (Can see / Can change), "Anyone with the link
  can see it" with its warning, "Files added here later" for a folder, "This
  file" for an item, "Set its own" / "Follow the folder above instead", and an
  info app with a **Protected** badge in the media workspace.
- **The Delivery API.** `mediaRules` on its ports; `mediaAccessTo` in
  `protection.ts`. Lists and `items` leave out what the caller cannot read,
  `item` answers 401 or 403, and a media picker or tree picker reference keeps
  only `id` and `name`. The published cache's media carry `path` and `access`.
- **Rendering** is unchanged: a picker renders the URL and the file is
  guarded (step 7).
- **Transfer.** `BundleNode.mediaAccess` (`rule`, `readPolicy`,
  `writePolicy`, `creator`), exported for media nodes that set anything,
  written with groups sorted, parsed, and applied after every node exists.
  Whole-site files use the same export.
- **Tests.** `tests/media-access.test.ts` on both dialects: every case of
  `memberMay`; nearest-rule replacement; stamping and the creator; the
  creator, a group member, another member, a visitor, an editor inside and
  outside their start nodes and one without the Media section; the bin;
  crops; a store with a public URL; a key with no owner and a page's upload;
  the API's answers and audit; the Delivery API's lists, 401, 403 and picker
  references; a transfer round trip; the migration's rewind and backfill.
  `imaging.test.ts`'s SVG case now uploads its file as a media item.
- **Docs.** `rendering.md` ("Protected media", and what a CDN must not
  front), `delivery-api.md`, `operations.md`, `content-transfer.md`,
  `data-model.md`, the release notes.
