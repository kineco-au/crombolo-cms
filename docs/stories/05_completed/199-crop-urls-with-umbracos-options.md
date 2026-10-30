# 199 — Crop URLs with Umbraco's options

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** 197

## Story

As a developer moving views from Umbraco, I want `cropUrl()` to take the
options `GetCropUrl` takes. Then an image URL can ask for a quality, an anchor,
a named crop at another width, or a version that changes when the file does,
without writing the query string by hand.

## Context

What `cropUrl()` does today (`packages/render/src/media.ts`):
- **It's on three objects:** `ImageCropperValue`, `MediaWithCrops` and
  `PublishedMedia.image`.
- **It takes a crop name, or `{ width, height, mode, format }`, not both.**
- **A named crop gives its own size**, and its coordinates as `cc` or the
  focal point as `rxy`.
- **A size uses the focal point as `rxy`**, but only when both width and height
  are given.

The image route (`packages/server/src/imaging.ts`) already reads the query
parameters below and caches each variant:
- `width`, `height`;
- `rmode`, with all six modes;
- `rxy`, the focal point;
- `cc`, the crop coordinates;
- `format`, as `jpg`, `png` or `webp`;
- `quality`.

Gaps against Umbraco's `GetCropUrl` and its ImageSharp URL generator:

| Umbraco | Crombolo today |
|---|---|
| `quality` | Read by the route; not an option on `cropUrl()` |
| `cropAlias` with `width`/`height` (a named crop's area, scaled to another size) | Not possible: a name or a size, not both |
| `useCropDimensions` | Always on for a named crop |
| `preferFocalPoint` (ignore the crop's coordinates, use the focal point) | Not possible |
| `imageCropAnchor` (`ranchor`: top, bottom, left, right and the corners) | Not read by the route, and not an option |
| `cacheBuster` (`rnd=` from the update date, so a replaced file gets a new URL) | None. Variants are keyed on the file's etag, so the server is right, but a browser or CDN caching the old URL is not |
| `furtherOptions` (extra query appended) | Not possible |
| `ratio` (height from width) | Not possible |
| Output formats AVIF and GIF | `jpg`, `png` and `webp` only; anything else falls back to the source's type |

## Decisions (2026-10-30)

1. **One options object, with a bare string as shorthand.**
   `cropUrl({ crop: 'hero', width: 800, quality: 70, anchor: 'top' })`, with
   Umbraco's option names (`preferFocalPoint`, `useCropDimensions`,
   `furtherOptions`, …); `cropUrl('hero')` stays `{ crop: 'hero' }`, so
   today's calls keep working. Not chosen: `GetCropUrl`'s positional
   arguments, unreadable at eight or so and clashing with today's object form.

2. **A cache buster by default, from the update date.** A media item's
   own; an Image Cropper value's page's. `cacheBuster: false` turns it off and
   a string sets it. The route ignores `rnd` when keying a cached variant, so
   it never makes another copy. URLs change on every save, as Umbraco's do.
   Not chosen: off by default, which leaves a replaced image stale in browsers
   and CDNs unless a developer remembers it.

3. **AVIF where the server can encode it, else WebP.** Bun encodes AVIF
   with the operating system's codec: it works on macOS, but Linux builds
   have no AV1 encoder ("format not supported on this machine", checked with
   Bun 1.4.3 in the test container). The route checks once at boot; where it
   cannot, `format=avif` is served as WebP with WebP's content type, since
   every browser that takes AVIF takes WebP. The docs say AVIF depends on the
   server. GIF output is not offered: Bun has no GIF encoder. Not chosen:
   falling back to the source's type (a full-size JPEG where a small modern
   image was asked for); not offering AVIF at all.

## Plan

1. **Options** (`render/src/media.ts`): `CropRequest` gains:
   - `crop`, a crop name, combined with `width`/`height`;
   - `quality`;
   - `anchor`, one of the nine positions;
   - `preferFocalPoint`;
   - `useCropDimensions`;
   - `ratio`;
   - `cacheBuster`, `true` or a string;
   - `furtherOptions`, a string appended as query.

   A bare string stays a named crop at its own size, so existing views keep
   working.
2. **The route** (`server/src/imaging.ts`):
   - read `ranchor`, used when there is no `rxy`;
   - ignore `rnd` and `v` when keying the cached variant, so a cache buster
     does not make a new copy of the same image;
   - accept `format=avif`: encoded as AVIF where a boot-time check finds the
     machine can, otherwise as WebP (decision 3); the cached variant is keyed
     on the format actually written.
3. **The Delivery API.** Nothing changes: it returns crops and the focal point,
   and the caller builds its own URL.
4. **Tests:**
   - every option's query string;
   - a named crop at another width keeps the crop's area;
   - `preferFocalPoint` drops `cc`;
   - the anchor crops from the right edge;
   - the cache buster changes when the update date does and serves the same
     cached variant;
   - an unknown format falls back;
   - AVIF is written where the encoder exists and WebP where it does not,
     with the matching content type.
5. **Docs:** the `cropUrl()` options in `docs/rendering.md`, beside the image
   query table, and a release-notes bullet.

## Acceptance criteria

- [x] `cropUrl()` takes a crop name together with a size, plus `quality`,
      `anchor`, `preferFocalPoint`, `useCropDimensions`, `ratio`, `cacheBuster`
      and `furtherOptions`. A bare crop name still works as before.
- [x] The image route honours `ranchor`, and serves one cached variant
      whatever the cache-buster value.
- [x] `format: 'avif'` gives AVIF where the server can encode it and WebP
      where it cannot, and the docs say so; GIF output is documented as not
      offered.
- [x] Unit tests cover each option and the route's handling of anchor and
      cache buster.
- [x] `docs/rendering.md` lists the options with their Umbraco equivalents,
      the default cache buster and how to turn it off.

## Out of scope

- `urlMode` (absolute URLs): views build those from the request's origin today.
- Faster crop and pad. Today they go through a PNG round trip written in plain
  TypeScript. That's a separate change if large photos prove slow.

## What was built

- **`cropUrl()`** (`packages/render/src/media.ts`): `CropOptions`, with a bare
  string as `{ crop }`. A named crop with a width or a height keeps its shape
  unless both are given; `useCropDimensions` keeps its size; `preferFocalPoint`
  swaps `cc` for `rxy`; `ratio` (width ÷ height) gives the missing side;
  `anchor` writes `ranchor` only when there is no focal point; `furtherOptions`
  is appended as written. The cache buster is `rnd`, the update date in base 36
  (`cacheBusterOf`), left out for an unknown date (the epoch).
- **Update dates:** `PublishedMedia.image` and `MediaWithCrops` use the media
  item's; an Image Cropper on a page gets the page's through the value context
  (`ValueContext.updated`, set by `withValueContext`).
- **The route** (`packages/server/src/imaging.ts`): `ranchor` becomes the focal
  point a crop is cut around when there is no `rxy`; `avif` is a format, and
  `canEncodeAvif()` (checked at boot) decides whether it is written as AVIF or
  WebP; a variant is keyed on the format actually written. `rnd` was never
  part of the parsed request, so it never made a copy.
- **Tests:** `tests/crop-urls.test.ts` (every option's query, a crop at another
  width, the focal point preferred, the cache buster from each kind of value),
  and `tests/imaging.test.ts` (the anchor parsed and cropping from its edge, two
  busters sharing one cached variant, AVIF or WebP by what the machine can do).
- **Not built:** GIF output (Bun has no GIF encoder), and the Delivery API is
  unchanged, as planned.
