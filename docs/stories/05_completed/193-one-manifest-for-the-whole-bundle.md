# 193 — One manifest for the whole bundle

**Epic:** B — Packaging and upgrades · **Priority:** should · **Size:** M
**Depends on:** 192

## Story

As someone who builds, checks or hosts bundles, I want one `bundle.json` at
the package root that lists everything the package carries, under one hash, so
that a bundle is one thing to verify rather than a payload in a folder with a
second hash beside it for the code.

## Context

Up to 0.32.0, a bundle package kept its payload in `content/`: `bundle.json`,
nodes, media and sections, under the manifest's `integrity`. Story 192 put a
site's code in `code/` beside it, with a second hash in `package.json`'s
`crombolo.code`, because the payload loader reads only `content/` and refuses
paths that climb out.

**Decided (2026-10-28):**
- **The payload is the package.** `bundle.json` sits at the root beside
  `package.json`, and everything it carries sits beside it: `nodes/`,
  `blobs/`, `values/`, `people/`, the sections, and `code/`. One `integrity`
  covers all of it. `package.json` is npm's, so it is not hashed.
- **Code is a section.** `code/` is listed under `carries.code` like
  `schema/` or `components/`, and read as bytes. An import never applies it.
  `crombolo.code` goes.
- **`crombolo.content` is `true`.** It still says, in a packument the
  Marketplace reads, that the package carries content. It no longer names a
  folder.
- **No backwards compatibility.** A bundle laid out in `content/` is not read.
  The committed bundles are rebuilt.

## Acceptance criteria

- [x] Every bundle written (`bundle build`, `content export`, created packages,
      whole-site files, the Umbraco importer) has `bundle.json` at its root,
      and `package.json`'s `files` lists what it carries.
- [x] One hash covers nodes, media, sealed values, people, sections and code;
      editing any carried file fails it.
- [x] `crombolo.code` and its second hash are gone. `bundle check` and
      `install-code` read the code through the bundle's own loader.
- [x] `crombolo.content` is `true`, and validation says so.
- [x] The committed bundles are rebuilt, and the docs show the new layout.

## As built (2026-10-28)

- **The payload is the package root.** `PAYLOAD_DIR` is gone. `contentDir` is
  the package's own directory when `crombolo.content` is `true`.
  `writeBundlePackage` adds only `package.json`. Its `files` list, from
  `packageFilesFor`, is `bundle.json` plus each top-level entry the payload
  carries.
- **Code is the `code` entry of `BUNDLE_SECTIONS`.** The loader reads it as
  bytes. It is not one of the sections an import applies, so an import never
  writes it. `loadBundleCode` is `loadBundle` plus `carries.code`, so a code
  file that has been edited fails the bundle's one `integrity`.
- **Whole-site files** (`site-file.ts`) write the payload at the archive root,
  and the remote transfer reads it there.
- **`build-template.ts`** deletes and rewrites the whole committed bundle
  directory.
- **Found on the way:** the release load test's harness read a page's
  revision before saving it. When a concurrent writer had deleted the page
  for good in between, the read came back 404, and the save went out with no
  `If-Match` and was refused with 428 instead of 404. The harness now sends
  `If-Match: *` when the read is 404 (`tests/support/harness.ts`). Seed 492669
  replays it.
