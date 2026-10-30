# 188 — File storage for server bundles

**Epic:** G — Trusting and extending bundles · **Priority:** should · **Size:** M
**Depends on:** 063

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

## Decisions before implementation

- **Where they live.** A prefix per bundle in the same store as media (for example
  `bundles/<id>/…`), so backups and environment copies take them with no change;
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
