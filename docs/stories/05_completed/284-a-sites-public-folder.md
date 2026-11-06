# 284 — A site's public folder

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a site developer, I want files I put in a `public/` folder served at the root of my
site, at the same paths, so that a logo, a font, a favicon or a verification file has a
home without being a media item or a route of my own.

## Context

A site serves its stylesheets from `css/` at `/css/…`, its scripts from `scripts/` at
`/scripts/…`, and what editors upload at `/media/…`. Nothing else has an address. A logo
in a template, a font a stylesheet names with `url(/fonts/site.woff2)`, a `favicon.ico`, a
vendor's `dist/` folder or a `google1234.html` either go in the media library, where
editors can change them and they do not belong, or need a route written by hand.

Next.js has `public/`, as ASP.NET has `wwwroot/`. A site brought here from either keeps
its links only if those files stay at their paths.

## Decisions before implementation

- **`public/` beside `css/` and `scripts/`,** set by `CROMBOLO_PUBLIC_DIR`, defaulting to
  `public`. `public/images/logo.png` is `/images/logo.png`. Nothing is required: a site
  with no folder behaves as it does today.
- **It is for the developer, not editors.** The back office does not edit it, and it
  travels with the site's code. The Settings section keeps `css/` and `scripts/`.
- **Who wins at one address.** Reserved paths first: the back office, `/crombolo/`,
  `/media/`, `/css/`, `/scripts/`, `/health`. Then `public/`, then the site's declared
  routes and its pages. So a `public/robots.txt` replaces the generated one, and a file
  can shadow a page, which the server logs by name as it starts.
- **Looked up in an index, not on disk.** The folder is listed at boot, and watched in
  development, so a page request makes no file system call and an unknown path costs
  nothing.
- **Only regular files inside the folder.** No dotfiles except under `.well-known/`, no
  symlinks out, no path traversal: only a path in the index answers. Nothing is executed:
  `.js`, `.html` and `.svg` are bytes with a content type and `nosniff`.
- **Caching as `css/` and `scripts/`:** `no-cache` with an ETag at the plain address, and
  `asset('/images/logo.png')` writes a hashed address that lasts a year, `immutable`.
- **It works behind a proxy.** Public files go to a node that serves the site, `web` or
  `all`, as `/css/` does, and `api` answers 404. `docs/rendering.md`'s table says so.

## Acceptance criteria

- [x] A file in `public/` answers at its path, with its content type and an ETag, and a
      conditional request answers 304.
- [x] A site with no `public/` folder is unchanged, and a page request does no file
      system call for it.
- [x] A reserved path cannot be shadowed; a `public/` file wins over a page or a
      generated `robots.txt`. `crombolo components check` names a clash with a reserved
      path or a route, and the server's log names a file hiding a page.
- [x] A dotfile, a symlink out of the folder and `..` in a path answer 404, and a file
      under `public/.well-known/` answers at its path.
- [x] `asset()` writes a hashed address for a public file, served `immutable`.
- [x] A file added in development is served without a restart, including the first one
      in a folder that did not exist at boot.
- [x] A site's middleware runs on a public file.
- [x] `public/` travels in a bundle, byte for byte, and a whole-site pull and push carry
      it. A bundle that carries it is refused by an older site, not silently emptied.
- [x] `bundle build` warns above 100 MB of `public/`, naming the largest files, and
      `push --dry-run` says how much it adds.
- [x] Covering tests for all of the above on an `all` node and a `web` node.
- [x] `docs/rendering.md`, `docs/configuration.md` and `docs/writing-components.md`
      describe it, and the release notes say what changed.

## Findings (2026-11-06)

- **An older site would drop `public/` silently.** `parseCarries` in
  `packages/transfer/src/load.ts` discards a section name it does not know, so format 6
  readers need a format bump to refuse instead.
- **Bundle sections are text.** `read()` and `actionFor()` in `bundle-sections.ts` and the
  loader in `load.ts` use `utf8`, which would corrupt an image without any error. Only
  `code` is read as bytes.
- **`bundleIntegrity` hashes every file in memory.** Media avoids that with per-file
  hashes in `media.json`, which the bundle hash covers. `public/` can do the same.
- **The generated `robots.txt` and `sitemap.xml` answer in `route()`,** before the
  middleware chain, so a public file can only replace them if those lines step aside.
- **`SiteAssets` does not fit as it stands.** It hashes every file at boot by reading it
  whole, skips a folder missing at boot, and is filtered by one extension.
- **A folder made after boot goes unwatched by `SiteAssets`,** which needs the folder to
  exist when it starts. The index watches the parent directory for that.
- **Correction to the plan as first written:** it said a bundle install renames the
  folder, leaving a watcher behind, and that `asset()` might go stale the same way.
  `moveContents` moves the folder's entries, not the folder, so a recursive watcher sees
  them. No rescan after a swap was needed, and the suspected `asset()` bug does not exist
  in that form.
- **`/css/` is not reserved from routes, or kept off `api` nodes, as the Decisions above
  imply.** `siteFiles` lets a declared route win at `/css/`, and `serveSiteFile` has no
  role check. This story leaves both as they are, and only `public/` answers 404 on `api`.
- **`/.well-known/crombolo-remote`** is the remote protocol's discovery address, so it
  stays reserved when `.well-known/` opens up.
- **`components check` reads no database,** and a page's address lives there. A declared
  route or a reserved path can be checked from files, but a page cannot.
- **A site's `code` globs can match `public/`,** which would carry those files twice.
- **`bun` serves an empty file as 204,** which `siteFileResponse` already works around.

## Decisions (2026-11-06)

- **`.well-known/` is the one exception to no dotfiles** (the maintainer's choice), minus
  the remote protocol's address. It covers `security.txt`, app links and certificate
  challenges.
- **Bundles warn and never refuse on size** (the maintainer's choice). No new setting:
  `bundle build` warns above 100 MB and names the largest files, `push --dry-run` says what
  `public/` adds, and the 50 GB `CROMBOLO_REMOTE_MAX_UPLOAD_GB` stays the only limit.
- **Middleware runs on public files, as on `/css/`** (the maintainer's choice), so a
  staging password covers them. The lookup therefore goes in `siteFiles`, and
  `/robots.txt` and `/sitemap.xml` step aside in `route()` when the index holds them.
  Their generated versions still skip the chain.
- **Format 7, always.** This follows the choice made for format 6 in story 283. New
  bundles need a site on this release, and `OLDEST_BUNDLE_FORMAT_VERSION` stays 5.
- **The index replaces `safeJoin`.** A request is looked up as an exact decoded key, so
  nothing built from the URL reaches the file system, which is stricter than the story
  asked for. A malformed `%` escape is a miss.
- **A hash is worked out on first use.** The index holds path, size and modified time from
  a listing. `asset()` hashes a file the first time it is asked for it and keeps the
  result until the file changes, so a large folder does not slow boot.
- **The plain address's ETag is size and modified time,** as `serveStaticFile` does, so a
  file is streamed rather than read into memory.
- **A page clash is the server's to report** (the maintainer's choice, replacing the
  first plan). `components check` is read-only and file-only: the CLI's only way to open a
  database also migrates it, and it would open a running container's SQLite from the
  host, which can corrupt it. So the check names reserved paths, routes and generated
  files, and a server that holds the pages logs each public file hiding one.

## Plan

1. **Config.** `publicDir` in `config.ts` beside `scriptsDir` (`CROMBOLO_PUBLIC_DIR`,
   default `public`, resolved against the site), `settings.ts`, and the settings tests.
2. **The index,** new `packages/server/src/site-public.ts`: `PublicFiles` with
   `start`, `has`, `file`, `address`, `paths` and `close`.
   - Lists regular files with `lstat`; a symlink counts only if its real path is inside
     the folder. Segments starting with a dot are skipped, except a first segment of
     `.well-known`.
   - Leaves out what could never answer, from one `isReservedPublicPath` beside
     `isSitePath`: the back office, `/umbraco`, `/crombolo`, `/media`, `/css`, `/scripts`,
     `/health` and the remote discovery address.
   - Watches the folder, and the parent directory for the folder's own name, so a folder
     created after boot or swapped by an install is listed again and watched anew.
3. **Serving.** In `siteFiles`, before `siteRoutes.handle`, for `GET` and `HEAD` on a node
   that is not `api`. An exact key answers `no-cache` with the ETag; a hashed address whose
   plain path is in the index answers `immutable` when the hash is the file's, and `404`
   `no-store` when it is not. An exact key wins, so a vendor's `app.3f9a1c2b.js` stays
   itself. Other methods fall through. Every answer has `nosniff`, and an empty file
   answers 200. `route()`'s `robots.txt` and `sitemap.xml` line checks `has` first.
4. **`asset()`.** `setAssetResolver` in `server.ts` also asks `PublicFiles.address`.
5. **Bundle format 7.** In `packages/transfer`:
   - `public` joins `BUNDLE_SECTIONS` and the version moves to 7.
   - `public.json`, modelled on `media.json`, lists each file's path, size and SHA-256 and
     is declared in the manifest. The bundle hash covers it, and each file is checked as
     a stream. Files outside the list are refused.
   - `carries.public` is filled from it by the loader, so paths are parsed by the same
     rule as other sections.
6. **Applying it, as bytes.** In `bundle-sections.ts`, `public` joins `FILE_SECTIONS` and
   `destinationOf`. Plan, apply, stage and revert copy and compare files rather than going
   through `read()`, and `stagedConfig` gains `publicDir`.
7. **Building and moving it.**
   - `bundle-build.ts` and `site-file.ts` add the folder, streamed rather than held as
     `BundleFile` bytes, with `publicDir` beside `stylesheetsDir`.
   - `remote.ts` and `operations/commands.ts` add `public` to the replace summary's
     folders, so a push names what it removes.
   - `selectCodeFiles` skips the public folder.
   - The size warning goes in `bundle build`, and the size line in `push --dry-run`.
   - A created package from the back office does not carry `public/`.
8. **`components check`.** Names a file at a route's address and a file left out because
   its address is reserved, from `publicClashes`. A file replacing the generated
   `robots.txt` is noted, not warned about. The server logs a file hiding a page.
9. **Scaffold.** `scaffoldFiles` adds `public/.gitkeep`, as git keeps no empty folder.
   The dotfile rule keeps it unserved, and it travels in a bundle so a pull does not
   delete it.
10. **Docs.** `docs/rendering.md` (a section, and the proxy table), `docs/configuration.md`,
    `docs/writing-components.md`, `docs/bundles.md` (format 7), `docs/content-transfer.md`,
    and the release notes, with the upgrade note that destination sites upgrade first.

### Tests

- New `tests/public-folder.test.ts`, covering each answer on `all` and `web`, plus `api`
  answering 404: 200, 304, empty file, percent-encoded names, hashed and stale addresses,
  dotfiles, `.well-known/`, symlinks in and out, `..`, `%2e%2e`, reserved paths, `POST`,
  a replaced `robots.txt`, a route and a page lost to a file, and middleware running.
- The index makes no file system call on a miss, spied rather than timed.
- Watching: a file added, and a folder created or swapped after boot.
- `tests/bundle-install.test.ts`, `tests/site-file.test.ts` and `tests/bundles.test.ts`:
  a binary round trip compared byte for byte, a tampered file refused, a format 6 bundle
  still read, and a revert. `tests/integration/remote-deploy.integration.ts` covers push
  and pull.
- `tests/components.test.ts` and `tests/config-env.test.ts`, and `tests/cli.test.ts` for
  the scaffold and the warning.
- SQLite is enough for most of this. A Postgres run is only needed for the bundle install
  tests, and no migration is expected.

### Risks

- **Two format bumps in a row.** A site on 0.50 cannot read bundles from this release, one
  release after 0.49 sites lost the same ability.
- **A pull or push replaces the folder,** as it does `css/`, so a file only on the
  destination goes. `push --dry-run` lists it, but a `public/` folder is more likely than
  `css/` to hold files someone put on a server by hand.
- **A shared volume may not fire watchers.** A new file on one then stays unseen until a
  restart, where `/css/` would serve it. That follows from not touching the disk on a
  page request, and `docs/rendering.md` will say so.
- **`web` nodes on separate disks** get their files from a deploy, not from a bundle
  applied on another node. `css/` has the same limit today.

## Implementation (2026-11-06)

- `packages/server/src/site-public.ts` holds `PublicFiles`, the index, and `publicClashes`.
  `serve` runs in `siteFiles`, so middleware covers it, and `route()` steps aside for a
  `robots.txt` or `sitemap.xml` in the folder.
- `packages/transfer/src/public.ts` holds `public.json`, and bundle format 7 reads it.
  `bundle-sections.ts` now copies and compares every file section as bytes.
- A `.gitkeep` travels in a bundle so a pull does not delete it, and is never served.
- No rescan after a swap was needed; see the correction under Findings.
- Tests: `tests/public-folder.test.ts`, `tests/public-folder-transfer.test.ts`, on an
  `all` and a `web` node, with `api` answering 404.
- The browser tests were not run for this story.

## Out of scope

- Resizing an image in `public/`: the media pipeline is for media.
- A CDN or object storage behind the folder.
- Range requests, so a large video in `public/` belongs in media.
