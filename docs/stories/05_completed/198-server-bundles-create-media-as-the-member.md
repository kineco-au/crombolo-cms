# 198 — Server bundles create media as the member

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 186, 196

## Story

As a site whose members upload files through a server bundle, such as
observation photos, I want the bundle to create and edit media items as the
signed-in member, under the media permissions, so that members' files live in
the media library with the right visibility from the moment they arrive.

## Context

Nothing lets a member create media today.
- **No member routes.** Member sign-in offers sign-in, registration and the
  like.
- **No capability.** A server bundle has no media capability (`BundleHost`
  holds redirects, documents, log, identityProviders and tables).
- **No member actor.** Content operations know three actors (`user`,
  `operator` and `system`, in `content/src/actor.ts`), and none of them is a
  member.
- **No image processing on upload.** Nothing applies EXIF orientation or
  strips metadata, so a phone photo's GPS location would be stored and served
  as it arrived.
- **Uploads go through a temporary file.** Media is created from a temporary
  file (`MediaFileStore.saveTemporary`), then placed under a random folder
  (`media-files.ts`).

What the dependencies provide:
- **196:** member-group read and write permissions on media folders and items,
  the defaults a folder stamps on files created in it, and a creator recorded
  on each item.
- **186:** routes a member, or the public, can call. A bundle needs them before
  a member can upload anything through it.

Raised by a site whose members attach a photo to a record from a recording
wizard.

## Decided (2026-10-28)

- **A bundle declares its folders by path,** as
  `media: { folders: ['/Observations/Photos'] }` on the `ServerBundle`. The
  capability writes only into those folders and the subfolders it creates
  below them, such as one per year. A path is fragile when a folder is renamed,
  so:
  - boot refuses a declared path that does not exist, naming the bundle and
    the path;
  - the back office warns before renaming, moving or deleting a folder a wired
    bundle declares, naming the bundle.
- **Creating needs write permission on the folder.** The member must be in one
  of the folder's write groups (196). The route's audience (186) decides who
  may call the bundle, and the folder's permissions decide whether the create
  is allowed. Editing and deleting a file follow its own write permission.
  Reading follows read permission.
- **Image metadata is stripped and handed to the bundle.** For an image
  uploaded through the capability:
  - the EXIF orientation is applied to the pixels;
  - every metadata block is then stripped from the stored file, so nothing
    private is ever served;
  - before stripping, the capability returns what it read: location, time
    taken and original size. The bundle may keep it in its own tables, for
    example on the observation.

  Back-office uploads are not changed by this story.
- **Types are an allow-list set by an administrator.** Each media folder gets
  "file types members may upload here" (for example JPEG, PNG and WebP), set
  in 196's Permissions panel. Nothing is accepted from a member unless it is
  on that list. A bundle's declaration can narrow the list further, never widen
  it. A file is checked by its content (its first bytes must match an allowed
  type) and by its extension, which must agree. The site's disallowed
  extensions still apply on top.
- **Size limits** come from the bundle's declaration and the folder's own
  limit, if it has one, whichever is smaller. Size is counted while the upload
  is read, so an oversized upload is stopped early.

## Plan (2026-10-28)

1. **A member actor** (`content/src/actor.ts`). The new kind is
   `{ kind: 'member', member: { key, name, groups }, origin }`.
   - Media operations accept it. Permission comes from 196's
     `memberMay('write', …)` on the parent folder for a create, and on the
     item for a save or a delete. The item records the member as its creator
     (`creator_member_key`), and its policies are stamped from the folder's
     defaults (196).
   - The audit log and change events name the member. A member actor never
     reaches document operations.
2. **The folder allow-list** (196's tables and Permissions panel).
   - `media_access` gains `member_types` (a list of types, such as `jpeg`,
     `png` and `webp`) and `member_max_bytes`.
   - The panel gets "File types members may upload here", as ticks over known
     types, empty meaning none, plus an optional size limit.
   - It is inherited downwards like the rest of the folder's rule. A nearer
     rule replaces it.
3. **Recognising a file** (`core/src/uploads.ts`). A pure `detectFileType(bytes)`
   reads the first bytes (magic numbers) for the types the panel offers: JPEG,
   PNG, GIF, WebP, AVIF, HEIC, PDF and so on. An upload is accepted when the
   detected type, its extension and the folder's allow-list all agree, and the
   site's disallowed extensions do not refuse it.
4. **Images.** A new `prepareMemberImage(bytes)` in `imaging.ts`:
   - read the metadata (`Bun.Image(…).metadata()`, plus an EXIF reader for
     GPS and the time taken);
   - apply the orientation;
   - re-encode the same format without metadata;
   - return the stripped bytes and `{ location?, takenAt?, width, height }`.

   A format that cannot be re-encoded is refused rather than stored with its
   metadata.
5. **The capability** (`server/src/bundles.ts` and a new `bundle-media.ts`).
   - `media` joins `BUNDLE_CAPABILITIES`. A bundle that asks for it must
     declare `media.folders`, which boot resolves to keys, refusing any path
     that does not exist.
   - `host.media` offers:
     - `create({ folder, name, file, mediaType? })` returns
       `{ key, url, metadata }`. `folder` is a declared path or a subfolder
       below one, which is created if it is missing. `file` is a `File`, or the
       request body read as one.
     - `get(key)` returns the item, its URL and its crops, when readable.
     - `update(key, { name?, file? })`.
     - `delete(key)`, which moves the item to the recycle bin.
     - `list(folder, { skip, take })`, listing what the member may read.
     - `crop(key, query)` returns a `Response`, streamed by 196's rules.
   - Each call runs as the member the route was given (186). From a back-office
     route it runs as that user. From a public route it is refused.
   - Every check comes before the store is touched: the declared folder, write
     permission, type and size. The file then goes through the temporary-file
     path, and a media item is created with its file value.
6. **The back office.** Media folders a wired bundle declares show "Used by
   <bundle name>". Renaming, moving or deleting one asks for confirmation,
   naming the bundle.
7. **Tests, on both dialects:**
   - a member creates media and is recorded as its creator, with the folder's
     defaults stamped;
   - a member without write permission is refused, for create, update and
     delete;
   - reading through the capability honours read permission;
   - a folder outside the declaration, and a subfolder below a declared one;
   - type checks: a renamed HTML file sent as `.jpg` is refused, a type off
     the allow-list is refused, and an empty allow-list refuses everything;
   - size limits: the bundle's, the folder's, and an upload stopped early;
   - images: the orientation applied, no EXIF left in the stored bytes, and
     the location returned;
   - boot refuses a declared path that is missing;
   - the back office warns on renaming a declared folder;
   - a public route is refused.
8. **Docs.**
   - `docs/bundles.md`, Part 3: the `media` capability, declared folders,
     and the metadata returned.
   - The media docs: the folder allow-list and the size limit.
   - The release notes.

## Acceptance criteria

- [x] A `media` capability for server bundles, writing only into the folders
      the bundle declares by path and their subfolders. A declared path that
      does not exist refuses the boot.
- [x] A signed-in member with write permission on the folder (196) can create
      a media item from an upload. The member is recorded as its creator, and
      the folder's defaults are stamped on it.
- [x] Editing and deleting need write permission on the item, and reading needs
      read permission.
- [x] An upload is accepted only when its content and extension match a type
      on the folder's allow-list, narrowed by the bundle's declaration, and it
      is within the size limit. Everything is checked before anything is
      stored.
- [x] An image is stored with its orientation applied and every metadata block
      stripped. The location, time taken and size it carried are returned to
      the bundle.
- [x] The back office shows which bundle uses a media folder, and warns before
      renaming, moving or deleting it.
- [x] Tests:
      - create as a member;
      - the defaults stamped;
      - write refused without permission;
      - type and size limits;
      - metadata stripped and returned;
      - a folder outside the declaration;
      - a missing path refusing the boot;
      - both dialects.
- [x] `docs/bundles.md` describes the capability. The media docs describe the
      folder allow-list.

## As built (2026-10-28)

- **The member actor** (`content/src/actor.ts`). `MemberActor` is `{ kind:
  'member', member: { key, name, groups }, via?, origin }`, built by
  `memberActor(member, { via })`; `MediaActor = Actor | MemberActor`. Media
  operations and `MediaEventSink` take a `MediaActor`; document operations
  keep `Actor`, so a member cannot be passed to them, and their `permits`
  refuses one at run time too. `actorName` gives the member's name,
  `actorUserKey` null, `actorMemberKey` the key. `mediaAuditEntryFor` writes
  `detail: "A member, through <bundle> (<key>)"`; `outboxActor` adds
  `memberKey`.
- **Media operations** (`content/src/media-operations.ts`). A member is checked
  by `memberMay('write', …)` on the item's own access and the nearest rule
  (`ruleFor`, its own included): the folder for a create, the item for a save
  or trash; never the root or the bin, so moving, sorting, restoring and
  emptying the bin are refused. A member's create records them as creator.
  `MediaInput.stamp: false` records the creator but leaves the item
  following the rule above, for the subfolders the capability makes.
- **Migration 052 `AddMediaMemberUploads`** (expand, 0.35.0, both dialects):
  `media_access.member_types` (text, comma-separated type names, null is
  none) and `member_max_bytes` (bigint). Undone by `undoMediaMemberUploads` in
  `tests/support/db.ts` (called first by `undoMediaAccess`) and in
  `integration/first-boot.integration.ts`; the expected lists in
  `upgrade-from-release`, `permissions` and `media-access` name it.
  `MediaRule` gains `memberTypes` and `memberMaxBytes`; `MediaAccessInput`
  takes them optionally; transfer carries them on a rule when set.
- **Recognising a file** (`core/src/uploads.ts`). `MEMBER_FILE_TYPES` (jpeg,
  png, gif, webp, avif, heic, pdf, mp3, wav, mp4, mov, with labels,
  extensions and whether each is an image), `detectFileType(bytes)` by magic
  number (an ISO `ftyp` box's brands for AVIF, HEIC, MP4 and QuickTime), and
  `checkMemberUpload(fileName, head, allowed, settings)`: extension present,
  the site's settings, the detected type, the extension agreeing with it, and
  the list.
- **Images** (`server/src/image-metadata.ts`, `prepareMemberImage` in
  `imaging.ts`). A hand-written EXIF reader in the style of the PNG codec:
  it finds the TIFF block in a JPEG's APP1, a PNG's `eXIf` or a WebP's `EXIF`
  chunk and walks IFD0 (orientation), the EXIF IFD (`DateTimeOriginal`,
  `OffsetTimeOriginal`) and the GPS IFD. The image is opened with
  `autoOrient: false` and turned by the orientation (rotate, then flip or
  flop, all eight cases tested by pixel), re-encoded in its own format
  (JPEG and WebP at quality 90, a lossless WebP kept lossless), then passed
  through a stripper as well: JPEG keeps only JFIF, the ICC profile and the
  image segments; PNG keeps only the chunks that draw it; WebP drops `EXIF`
  and `XMP ` and clears their VP8X flags. Bun's encoder already drops EXIF;
  the strippers make that a guarantee rather than a behaviour. Returned:
  `{ width, height, location?, takenAt? }` as stored.
- **The capability** (`server/src/bundle-media.ts`). `ServerBundle.media:
  { folders, types?, maxBytes }`, validated in `validateServerBundles`
  (folders as `/A/B` paths, `maxBytes` a positive whole number, known types,
  and neither without the other). `resolveBundleMediaFolders` resolves the
  paths at boot through `MediaListingRepository.byPath` (any case); a missing
  one refuses the boot with "Bundle "<name>" uses the media folder "<path>",
  which does not exist. Create it in Media, or take the bundle out of
  crombolo.config.ts until it does." `createBundleMedia(deps)` returns the
  `(caller, bundle) => BundleMedia` factory `server.ts` wires as
  `callerHost.media`, built lazily at the first call because the media
  operations are created after the bundles. `CallerCapabilities` factories now
  get the bundle as their second argument. `BundleHost.media` and
  `BUNDLE_CAPABILITIES` include it; the types are exported from
  `@crombolo/crombolo/bundle` (snapshot regenerated).
  - `create`, `get`, `update`, `delete` (to the recycle bin), `list` (20 a
    page, 100 at most, member reads filtered in SQL by 196's listing) and
    `crop` (a `Response`, `private, no-store`, through `streamMemberFile` in
    `server.ts`, which uses the same variant cache as `/media/`).
  - Order in `create`: the declared folder (the longest declared prefix, then
    existing subfolders by name in any case), write permission on the deepest
    existing folder (and, when subfolders are to be made, on a folder following
    its rule), the limits, the upload read through `readWithin` (a declared
    `content-length` or `File.size` over the limit is refused unread), the type
    check, the image preparation, the media type; only then are subfolders
    made and the bytes staged through `MediaFileStore.saveTemporary` for an
    `umbracoFile` value.
  - Refusals are `{ ok: false, status, message }`; a public caller gets 401.
- **The back office.** `GET <backoffice>/crombolo/api/media-access/{key}`
  answers `usedBy` (the bundles whose declared folder is this one or below it)
  and `memberFileTypes`; a rule carries `memberTypes` and `memberMaxBytes`,
  validated by `parseRuleBody`. `GET …/media-access/used` lists every folder a
  declared path runs through with its bundles. The Permissions panel gets
  "File types members may upload here" (ticks) and "Largest file, in MB", and
  shows "Used by <bundle> to store members' files."; the media workspace's
  info app shows it too. `media-access.js` adds a request interceptor
  (`confirmFolderChange`): before a media save that changes a used folder's
  name, a move, a move to the recycle bin or a delete, it asks with
  `umbConfirmModal`, naming the bundle; cancelling aborts the request.
  `bundleWarningFor` is the pure decision.
- **Tests.** `tests/bundle-media.test.ts`: `detectFileType` for every type,
  `checkMemberUpload` (a page named `.jpg`, a mismatched extension, off the
  list, an empty list, the site's disallowed extensions), the EXIF reader, a
  JPEG upright with no EXIF/XMP/comment left, all eight orientations on a PNG,
  WebP and GIF stripping, an image that cannot be re-encoded refused,
  `readWithin` stopping early, the declaration's validation, the warning and
  the dialog's request, the audit entry and outbox actor; then on a real site,
  booted once to make the folders and members and again with the bundle, on
  both dialects: a member creates (creator, defaults stamped, audit, metadata
  returned, stored bytes clean), write refused for create, update and delete,
  reading by read permission (get, list, crop), update and delete by the
  owner, outside the declaration refused, subfolders made and shared, type
  checks, the folder's and the bundle's size limits and a streamed upload
  stopped early, a public route refused, a back-office route acting as its
  user, `usedBy` and `used`, and the boot refusing a missing path.
- **Docs.** `bundles.md` Part 3, "Media as the member"; `rendering.md`,
  "What members may upload"; `data-model.md`; `api.md`; the release notes.

### Deviations

- **A GIF is stripped, not re-encoded.** Bun decodes GIF but cannot encode it,
  so re-encoding would refuse every GIF; instead its comment and application
  blocks (where XMP lives) are dropped and its frames kept. TIFF, BMP and SVG
  are not offered to members.
- **HEIC and AVIF** are re-encoded where the operating system has the codec
  (macOS) and refused elsewhere (Linux, so the Docker image), and refused if
  the re-encoded file still names an EXIF or XMP item. Their metadata is not
  read, so no location is returned for them.
- **The colour profile is kept** in a stripped JPEG, PNG or WebP: it describes
  the colours, not the person or the place.
- **`get`, `list` and `crop` are confined to the declared folders too,** not
  only writes, so a bundle cannot read the rest of the library through it.
- **A back-office user** keeps to the bundle's types and size, not the
  folder's member list, which is about members.
- **The bundle's `maxBytes` is required,** so there is always a limit.
- **A rename while the site runs** does not stop the bundle until the next
  boot, since the folders are held by key once resolved; that boot is the one
  that refuses, which is what the warning says.

## Out of scope

- The permissions themselves: story 196, which this extends with the allow-list.
- Processing back-office uploads.
- Bulk-setting creators during a migration, such as a migrated site's existing
  photos: the importer's job, using 196's repository.
