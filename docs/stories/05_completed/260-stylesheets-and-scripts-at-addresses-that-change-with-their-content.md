# 260 — Stylesheets and scripts at addresses that change with their content

**Epic:** F — Headless · **Priority:** should · **Size:** M
**Depends on:** 057

## Story

As someone running a site behind a CDN, I want the site's stylesheets and
scripts served at addresses that change when their content does, so that
they can be kept for a year anywhere and a deploy is never a page of new
markup styled by last hour's stylesheet.

## Context

What the server sends today, outside development:

| Files | Address | Cache-Control |
|---|---|---|
| The site's stylesheets and scripts (`stylesheets/`, `scripts/`) | `/css/<name>`, `/scripts/<name>` | `no-cache`, no ETag (`serveSiteFile`) |
| The scripts the server generates: forms, bundles, the island loader | `/crombolo/forms.js`, `/crombolo/bundle.js`, `/crombolo/islands.js` | `public, max-age=3600` (`siteScript`) |
| Islands' browser code (`209`) | `/crombolo/islands/<hashed name>` | `public, max-age=31536000, immutable` |
| Media | a new folder per replaced file | `immutable` |
| The back office's own assets | hashed | `immutable` |

The site's files are read from `css/` and `scripts/` on every request; they
are not part of a views generation, so once a deploy replaces one, its old
bytes are gone (checked 2026-11-04).

Islands and media already do the right thing. A site's own stylesheet is
revalidated on every request (correct, slow), and the generated scripts can
be an hour stale against markup that expects the new one, which `/crombolo/forms.js`
has already been once.

### Decisions

- **An address whose hash no longer matches. Decided (2026-11-04): `404`**,
  answered `no-store` so a CDN does not keep it. A hashed address only ever
  means those bytes. During a deploy a page still kept, or one reaching a
  server not yet updated, loses its stylesheet until it is fetched again;
  short page lifetimes keep that window small. Serving the current file at
  `no-cache` was turned down as a page styled by the wrong stylesheet, and
  keeping every version in a shared store as more than this needs.
- **The address. Decided (2026-11-04):** `/css/<name>.<hash8>.css` and
  `/scripts/<name>.<hash8>.js`, the hash over the file's bytes, served
  `public, max-age=31536000, immutable`. The plain address stays at
  `no-cache`, and gains an ETag, so hand-written links and external references
  keep working; a plain address is never redirected, since a redirect is
  itself cacheable and a hop. A real file with that exact name is served as
  itself.
- **How a template gets the address. Decided (2026-11-04): `asset()`,
  only.** `import { asset } from '@crombolo/crombolo'`, then
  `<link rel="stylesheet" href={asset('/css/site.css')} />`: the hashed
  address of the file as it is now, or the plain address and a development
  warning when there is no such file. Nothing is rewritten behind a
  template's back, so a site opts in by changing its layout; the layout
  example in [`writing-components.md`](../../writing-components.md) and the
  templates Crombolo ships use it. Rewriting `<link>` and `<script>` in the
  JSX runtime was turned down as changing markup the template wrote. A
  stylesheet's own `url(...)` references are not rewritten: that is a build
  step a site chooses, and the plain addresses still work.
- **Generated scripts. Decided (2026-11-04):** they take a hash of their
  body in the address the markup emits (`/crombolo/forms.<hash8>.js`),
  served `immutable`, with the plain address dropping from an hour to
  `no-cache`. The hash is of the script the running version serves, so an
  upgrade moves it.
- **When the hash is worked out. Decided (2026-11-04): at boot, then a
  watcher.** Each server hashes every file in `css/` and `scripts/` as it
  starts, and a file watcher re-hashes one that changes, so `asset()` answers
  from memory and a render never reads a file. A watcher does not fire on
  every mounted volume or bucket, which is why the views use a timed check:
  there, a changed file keeps its old address until a restart, and that
  address answers `404`. So that a missed change can never be kept for a
  year under the wrong name, a hashed address is answered by hashing the
  bytes it is about to send, not from the remembered hash. A cached hash
  with a timed re-check, as the views have, and hashing only at boot were
  turned down.

## Acceptance criteria

- [x] `/css/<name>.<hash>.css` and `/scripts/<name>.<hash>.js` serve the
      file `immutable` when the hash matches its content, and `404` when it
      does not; the plain addresses stay at `no-cache` and gain an ETag.
- [x] `asset()` from `@crombolo/crombolo` answers the hashed address, and
      the plain one with a development warning when the file is missing.
- [x] The templates `crombolo init` and the site templates write use
      `asset()` for their stylesheets and scripts.
- [x] The markup for forms, bundles and islands references the generated
      scripts by hashed address; the plain addresses stay at `no-cache`.
- [x] A changed stylesheet changes its address, and the previous address
      answers `404`, `no-store`; a hashed address is checked against the
      bytes it sends, so a change the watcher missed is never kept under it.
- [x] `writing-components.md` and `rendering.md` are updated; the layout
      example uses `asset()`.
- [x] Tests, including a deploy that changes a stylesheet while a page
      referencing it is served.

## Out of scope

- Rewriting `url(...)` inside stylesheets, or any bundling of a site's
  stylesheets and scripts.
- A query-string form (`?v=`), which many caches ignore and which `057`'s
  tags cannot name.

## Implementation

- `packages/render/src/assets.ts`: `contentHash` (eight characters of a
  SHA-256), `hashedAddress`, `splitHashedAddress`, and `asset()`, which asks
  the resolver the server sets.
- `packages/server/src/site-assets.ts`: `SiteAssets` hashes every file under
  `css/` and `scripts/` at boot and watches each folder (`fs.watch`,
  recursive), re-hashing a file that changes.
- `packages/server/src/server.ts`: `serveSiteFile` serves the plain address
  `no-cache` with a weak ETag and `304`, and a hashed one `immutable` only
  when the hash is of the bytes about to be sent, otherwise `404`, `no-store`.
  The generated scripts (forms, bundle, island and deferred loaders) are
  served at their hashed addresses `immutable`, and at their plain ones
  `no-cache`; the islands and deferred loaders are linked by hashed address
  (`ISLAND_LOADER_ADDRESS`, `DEFERRED_LOADER_ADDRESS`). Development warns once
  for an `asset()` naming a file the site does not have.
- The layouts of every site Crombolo ships, and `writing-components.md`'s
  example, use `asset()`.
- Tests: `tests/hashed-assets.test.ts`, including a stylesheet changed while
  the site runs, whose old address then answers `404`.
