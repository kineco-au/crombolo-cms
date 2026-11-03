# 188 — File storage for server bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 063, 246

## Story

As a site that stores files its members or administrators upload, I want a
server bundle to keep files in the site's media storage, so that they live with
the site, travel with its backups and are served through the same pipeline as
media.

## Context

Crombolo stores media on the file system, S3 or Azure, and serves crops. A
bundle has no capability to store anything. Raised by a site whose members
attach photos to records (millions exist), and administrators upload import batches and download error
reports. These are not editorial media and must not appear in the Media section
or be served to anyone but their owner.

## Since 246 was written (2026-11-02)

The media library is to scale in place (story 246) rather than be worked round,
so this story builds on it instead of on a store of its own: a bundle's files are
**media items in a folder the bundle owns**, protected, not shown to editors in
the Media section, and deleted with the bundle on `bundle purge`. They then share
media's storage, serving, crops, backups and environment copies, and the
question of a public store (a bucket behind a CDN) does not arise, since
protected media is never sent to a store's public address. To check when
planning: that resized copies of protected images are kept private too, and how
a bundle-owned folder is hidden and removed. The decisions below are from
before this, and are to be revisited then.

## Decisions before implementation

- **Where they live.** A prefix per bundle in the same store as media (for example
  `bundle-files/<id>/…`, not `bundles/`, which is the site folder a bundle
  installed from a file lives in, story 245), so backups and environment copies take them with no change;
  confirm the hosts' backups cover the whole store.
- **Serving.** Private by default, served only through the bundle's own routes;
  images resized and cropped through the media pipeline, with the bundle deciding
  access first.
- **Limits.** Per-file size and content-type rules declared by the bundle, and
  checked by the capability.

## Acceptance criteria

- [ ] A `files` capability: put (streamed), get, delete, list and stat under the
      bundle's prefix only; a key outside it is refused before the store is
      touched.
- [ ] An image stored this way can be returned resized or cropped, through a
      helper the bundle's route calls after its own access check.
- [ ] Files are removed with the bundle's data when a site removes the bundle,
      only on an explicit contract step.
- [ ] Works the same on the file system, S3 and Azure stores, with tests on each
      adapter's fake.
