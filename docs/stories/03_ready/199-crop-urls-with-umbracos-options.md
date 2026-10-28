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

## Decisions before implementation

- **The shape of the options.** Either one options object that takes `crop`
  (a name) beside the rest, keeping a bare string as the shorthand for
  `{ crop }`; or Umbraco's positional argument list. The object reads better
  in TSX and keeps today's calls working.
- **A cache buster by default?** Umbraco adds `rnd` when it has the update
  date. A media item has one, and an Image Cropper value on a page has its
  page's. Decide whether `cropUrl()` adds it unless told not to.
- **AVIF.** Only if Bun's `Image` can encode it. Check this before offering it,
  and refuse quietly (fall back to the source type) where it cannot.

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
   - add AVIF output if Bun can encode it.
3. **The Delivery API.** Nothing changes: it returns crops and the focal point,
   and the caller builds its own URL.
4. **Tests:**
   - every option's query string;
   - a named crop at another width keeps the crop's area;
   - `preferFocalPoint` drops `cc`;
   - the anchor crops from the right edge;
   - the cache buster changes when the update date does and serves the same
     cached variant;
   - an unknown format falls back.
5. **Docs:** the `cropUrl()` options in `docs/rendering.md`, beside the image
   query table, and a release-notes bullet.

## Acceptance criteria

- [ ] `cropUrl()` takes a crop name together with a size, plus `quality`,
      `anchor`, `preferFocalPoint`, `useCropDimensions`, `ratio`, `cacheBuster`
      and `furtherOptions`. A bare crop name still works as before.
- [ ] The image route honours `ranchor`, and serves one cached variant
      whatever the cache-buster value.
- [ ] AVIF output, or a note in the docs that it is not offered and why.
- [ ] Unit tests cover each option and the route's handling of anchor and
      cache buster.
- [ ] `docs/rendering.md` lists the options with their Umbraco equivalents.

## Out of scope

- `urlMode` (absolute URLs): views build those from the request's origin today.
- Faster crop and pad. Today they go through a PNG round trip written in plain
  TypeScript. That's a separate change if large photos prove slow.
