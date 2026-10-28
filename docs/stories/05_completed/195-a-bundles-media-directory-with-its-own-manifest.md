# 195 — A bundle's media directory, with its own manifest

**Epic:** B — Packaging and upgrades · **Priority:** should · **Size:** M
**Depends on:** 193

## Story

As someone producing or installing a bundle, I want its media files in a
`media/` directory whose manifest lists every file by a full URI, and a plain
choice of whether to include the files, so that a bundle says where each file
is, whether it carries it or not.

## Context

Today a bundle lists the media files its content refers to under `blobs` in
`bundle.json`. Each entry has its store key, etag, size, owning node and
`included` flag. The bytes of an included file sit at `blobs/<key>`.
- **How each command opts in:** `content export --with-blobs` includes the
  files, `export --no-media` leaves them out, and `media: 'referenced'` names
  them without carrying any, for the remote protocol (107).
- **What a key gives:** a file is identified by its store key, so a reader can
  only find it inside the package, or ask a remote for it by key.

## Decided (2026-10-28)

- **A media manifest at the package root.** `media.json` sits beside
  `bundle.json` and lists every media file the content refers to: its key,
  size, etag, owning node and, when the file is carried, its URI.
  - `media.json` is one of the files the integrity hash covers. `bundle.json`
    cannot be, because it holds the hash, so the list has a file of its own.
  - `bundle.json` declares that the bundle has a media manifest, and keeps the
    media mode (`omitted` or `referenced`) it has today.
- **The bytes live under `media/`.** This replaces `blobs/`. A carried file's
  bytes sit at `media/<key>`.
- **A carried file's URI is `bundle://<id>/media/<key>`.** It is absolute and
  names the bundle by its `bundle.json` id, so it means the same wherever the
  package is copied. The loader checks the id against `bundle.json`. Key
  segments are percent-encoded. Later schemes, such as https or the remote,
  can sit beside it.
- **A referenced file has no URI.** The remote protocol's referenced mode
  (`pull --media-info-only`, `--lazy-media`, `push`) lists files with key,
  size and etag and carries none of them. The CLI fetches each one from the
  remote by key, as it does today. A URI pointing at the remote waits for the
  later story about URIs outside the package.
- **No media by default; `--with-media` includes the files.** This applies to
  every command that produces a bundle:
  - `bundle build`;
  - `content export`, where `--with-media` still needs `--include-content`,
    because media files are content;
  - `export`, the whole-site file. This is a change: it used to include media
    unless given `--no-media`;
  - a created package's download in the back office, which gets the same
    choice, off by default.

  `--with-blobs` and `--no-media` stay as deprecated aliases for one minor
  (`docs/api.md`'s promise covers the CLI's documented flags). `pull` and
  `push` keep their own media modes: they ask the remote for a file explicitly
  and are not changed here.
- **No older layout is read.** The format version goes to 5. A `blobs/` bundle
  is refused with a message saying to rebuild it, as 0.33.1 refuses its own
  predecessors.

## Plan (2026-10-28)

1. **The format** (`packages/transfer`).
   - **Model:**
     - A `BundleMediaEntry` holds `key`, `size`, `etag`, `node` and an
       optional `uri`.
     - `manifest.blobs` gives way to `media.json`.
     - `bundle.json` gains `media: { manifest: 'media.json' }` beside its
       existing mode.
     - `BUNDLE_FORMAT_VERSION` and `OLDEST_BUNDLE_FORMAT_VERSION` go to 5, and
       `OLD_LAYOUT` names the release.
   - **Writing** (`write.ts`, `planBundle`): `media.json` is written with the
     entries, and each carried file goes to `media/<key>`, both inside the
     hash. `mediaPath(key)` and `mediaUri(id, key)` replace `blobPath`.
   - **Reading** (`load.ts`):
     - Read `media.json`, and resolve each URI. A scheme other than `bundle:`,
       another bundle's id, or a path that climbs out is refused by name.
     - Every carried file must be present and covered by the hash. A file
       under `media/` that the manifest does not list is refused too, so adding
       one is caught as well as editing or removing one.
     - `LoadedBundle.blobs` (key to path on disk) keeps its shape, so the
       callers that place files change little.
   - **Sealing:** a sealed media file's associated data is its `media/` path,
     where it was its `blobs/` path.
2. **Whole-site files** (`server/src/site-file.ts`). They stream carried files
   to `media/<key>`, and write `media.json` into the hash as they go.
   Referenced files are entries without a URI.
3. **Callers:**
   - `bundle-install.ts`: summarising, placing files, and the
     referenced-media check;
   - `check.ts`: the blob findings;
   - `adapters/bundles.ts`: created packages;
   - `remote.ts` and `cli/src/remote/transfer.ts`: the referenced listing and
     `referencedBlobs`.
4. **The option.**
   - `--with-media` on `bundle build`, `content export` and `export`, with
     `--with-blobs` and `--no-media` as deprecated aliases that warn.
   - `export`'s default flips to no media, and its output says when files were
     left out and how to include them. `start --from` and the release notes
     say that a site file made without `--with-media` brings media items
     without their files.
   - Created packages: the download route takes `withMedia`, and the
     back-office download offers the choice, unticked.
5. **Rebuilding.** Run `build:template` for the committed bundles, and refresh
   the fixtures that carry blobs.
6. **Tests:**
   - **Format:**
     - a round trip with and without media;
     - the URI and its percent-encoding (a key with `/` and non-ASCII);
     - refusal of an `https:` URI, of another bundle's id, and of `..`;
     - integrity when a carried file or `media.json` is edited, removed or
       added to;
     - sealed media;
     - a format 4 bundle refused by name.
   - **Producing:** each command's default (no media) and `--with-media`; the
     deprecated aliases warn and still work; a created-package download with
     and without media; a whole-site file both ways; `start --from` on a site
     file without media.
   - **The remote:** referenced pull and push unchanged end to end, through the
     existing integration test.
7. **Docs.**
   - `docs/content-transfer.md`: the layout, `media.json` and URIs.
   - `docs/bundles.md`: created packages.
   - `docs/remote-protocol.md`: referenced entries.
   - The CLI reference, regenerated.
   - The release notes, including `export`'s new default.

## Acceptance criteria

- [x] Every bundle written lists its media files in `media.json` at the
      package root, and carries their bytes under `media/` when asked. Each
      carried file has a `bundle://<id>/media/<key>` URI.
- [x] Every command that produces a bundle leaves media out by default and
      includes it with `--with-media`. The back office's download offers the
      same choice, unticked.
- [x] The importer reads files through the manifest's URIs. A file listed
      without a URI imports as it does today when the files were left out.
- [x] The integrity hash covers `media.json` and every carried file. Editing,
      removing or adding a file under `media/`, or editing `media.json`, fails
      it.
- [x] The remote protocol's referenced mode lists its files in `media.json`
      without URIs, and pull and push behave as they do today.
- [x] A bundle in the older `blobs/` layout is refused by name.
- [x] The docs (`docs/content-transfer.md`, `docs/bundles.md`) and the
      committed bundles show the new layout.

## Out of scope

- URIs that point outside the package, and fetching from them.
- Files a running server bundle stores for its members (188).

## As built (2026-10-28)

- **The format** (`packages/transfer`).
  - The in-memory `manifest.blobs` list callers use is unchanged.
  - **Writing:** `writeManifest` no longer writes it and records
    `mediaManifest: "media.json"` instead. `planBundle` emits `media.json`
    (`writeMediaManifest`) as an ordinary file the hash covers.
  - **Reading:** `loadBundle` reads `media.json` (`readMediaManifest`) back into
    `blobs`, with `included` meaning "has a URI".
  - **The new names:** `mediaPath(key)` replaced `blobPath`. `MEDIA_DIR`,
    `MEDIA_MANIFEST` and `mediaUri(id, key)` are exported.
- **Refused by the loader:**
  - a URI other than the bundle's own `bundle://<id>/media/<key>`;
  - a key with an empty or `..` segment;
  - a `media.json` that `bundle.json` does not declare, or one declared and
    missing;
  - any file under `media/` that is not a listed, carried entry.
- **The format version** is 5 (`OLDEST_BUNDLE_FORMAT_VERSION` is 5).
  `OLD_LAYOUT` no longer names a release.
- **The option.**
  - `bundle export` takes `--with-media`, with `--with-blobs` as a hidden,
    deprecated alias. `export` takes `--with-media`, with `--no-media` hidden
    and deprecated, and media off by default.
  - `bundle build --with-media`. The library's `buildBundleFromDirectory` keeps
    `media` on unless passed `false`, so seeding a site still brings its media.
    Only the command defaults it off.
- **Created packages.**
  - `PackagePort.build(id, { withMedia })`, which reads no files unless asked.
  - The contract's download route takes `?withMedia=true`, and Umbraco's own
    button never sends it.
  - A plugin route, `<backoffice>/crombolo/api/bundles/created/<id>/download`,
    works on the session cookie, which the plugin's other endpoints use.
  - The Created view's **Download** opens a panel with "Include media files",
    unticked.
- **Whole-site files** stream carried files to `media/<key>`. `media.json`
  travels in `planned.files`, inside the hash. A referenced file is an entry
  with no URI.
- **Tests.**
  - `content-bundle.test.ts`:
    - the URI and its encoding;
    - listed without a URI when not carried;
    - an edited file, an edited `media.json` and an unlisted file;
    - a foreign URI;
    - formats 1–4 refused.
  - `bundles.test.ts`: the created-package download with and without media,
    through both routes.
  - `content-transfer.integration.ts`: `--with-media` end to end.
