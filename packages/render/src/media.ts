/**
 * Media as templates see it: a published media item with its file URL, and
 * what the Media Picker and Image Cropper yield — the item with its crops,
 * each crop reachable as a URL the media route resizes and cuts.
 */
import { type MediaItemAccess, OPEN_MEDIA } from '@crombolo/core'
import type { PublishedProperty } from './model.ts'

export interface Crop {
  alias: string
  width: number
  height: number
  /** Fractions trimmed from each edge, as the cropper stores them; null means "around the focal point". */
  coordinates: { x1: number; y1: number; x2: number; y2: number } | null
}

export interface FocalPoint {
  left: number
  top: number
}

/** Where a crop is cut from when there is no focal point (ImageSharp's `ranchor`). */
export type CropAnchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topleft'
  | 'topright'
  | 'bottomleft'
  | 'bottomright'

/** The options of Umbraco's `GetCropUrl` (story 199), as one object. */
export interface CropOptions {
  /** A named crop: its area, at its own size unless a size is given. */
  crop?: string
  width?: number
  height?: number
  /** Width ÷ height: the missing side from the given one. */
  ratio?: number
  /** `crop`, `max`, `stretch`, `pad`, `boxpad` or `min`. */
  mode?: string
  /** `jpg`, `png`, `webp`, or `avif` where the server can encode it (WebP where not). */
  format?: string
  /** 1–100. */
  quality?: number
  /** Where to cut from when there is no focal point. */
  anchor?: CropAnchor
  /** With `crop`: ignore its coordinates and cut around the focal point. */
  preferFocalPoint?: boolean
  /** With `crop`: its own size, whatever size is given. Default: only when none is. */
  useCropDimensions?: boolean
  /**
   * A value that changes when the image does, so browsers and CDNs fetch it
   * afresh: the item's update date by default; `false` for none.
   */
  cacheBuster?: boolean | string
  /** More query, appended as it is: `bgcolor=fff`. */
  furtherOptions?: string
}

/** A crop URL: a named crop (shorthand for `{ crop }`), or the options. */
export type CropRequest = string | CropOptions

/** The cache buster an update date gives. */
export const cacheBusterOf = (updated: Date): string => updated.getTime().toString(36)

/**
 * `url` with the query that yields `request`, given the crops and focal point
 * in force; null for a named crop that is not there. `updated` is when the
 * image last changed, for the cache buster.
 */
export function cropUrl(
  url: string,
  crops: readonly Crop[],
  focalPoint: FocalPoint | null,
  request: CropRequest,
  updated?: Date,
): string | null {
  const options: CropOptions = typeof request === 'string' ? { crop: request } : request
  const params = new URLSearchParams()
  const focal = () => {
    if (focalPoint) params.set('rxy', `${focalPoint.left},${focalPoint.top}`)
  }
  let width = options.width
  let height = options.height
  if (options.crop !== undefined) {
    const crop = crops.find((c) => c.alias === options.crop)
    if (!crop) return null
    if (crop.coordinates && !options.preferFocalPoint)
      params.set(
        'cc',
        [crop.coordinates.x1, crop.coordinates.y1, crop.coordinates.x2, crop.coordinates.y2].join(
          ',',
        ),
      )
    else focal()
    const sized = width !== undefined || height !== undefined
    if (options.useCropDimensions || !sized) {
      width = crop.width
      height = crop.height
    } else if (crop.width > 0 && crop.height > 0 && options.ratio === undefined) {
      // A named crop at another size keeps its shape.
      if (height === undefined && width) height = Math.round((width * crop.height) / crop.width)
      if (width === undefined && height) width = Math.round((height * crop.width) / crop.height)
    }
  } else if (width && height) focal()
  if (options.ratio && options.ratio > 0) {
    if (width && !height) height = Math.round(width / options.ratio)
    else if (height && !width) width = Math.round(height * options.ratio)
    if (options.crop === undefined && width && height && !params.has('rxy')) focal()
  }
  if (width) params.set('width', String(width))
  if (height) params.set('height', String(height))
  if (options.mode) params.set('rmode', options.mode.toLowerCase())
  if (options.anchor && !params.has('rxy')) params.set('ranchor', options.anchor.toLowerCase())
  if (options.format) params.set('format', options.format.toLowerCase())
  if (options.quality) params.set('quality', String(Math.round(options.quality)))
  const buster =
    typeof options.cacheBuster === 'string'
      ? options.cacheBuster
      : options.cacheBuster !== false && updated && updated.getTime() > 0
        ? cacheBusterOf(updated)
        : undefined
  if (buster) params.set('rnd', buster)
  let query = params.toString()
  const further = options.furtherOptions?.replace(/^[?&]+/, '')
  if (further) query = query ? `${query}&${further}` : further
  return query ? `${url}?${query}` : url
}

const numberOr = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Crops as the cropper stores them, tolerating partial data. */
export function readCrops(value: unknown): Crop[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): Crop[] => {
    const crop = raw as Record<string, unknown>
    if (typeof crop.alias !== 'string') return []
    const c = crop.coordinates as Record<string, unknown> | null | undefined
    return [
      {
        alias: crop.alias,
        width: numberOr(crop.width, 0),
        height: numberOr(crop.height, 0),
        coordinates: c
          ? {
              x1: numberOr(c.x1, 0),
              y1: numberOr(c.y1, 0),
              x2: numberOr(c.x2, 0),
              y2: numberOr(c.y2, 0),
            }
          : null,
      },
    ]
  })
}

export function readFocalPoint(value: unknown): FocalPoint | null {
  const f = value as Record<string, unknown> | null | undefined
  if (!f) return null
  return { left: numberOr(f.left, 0.5), top: numberOr(f.top, 0.5) }
}

/** An Image Cropper value: the file, its crops and focal point. `toString()` is its URL. */
export class ImageCropperValue {
  readonly src: string
  readonly crops: Crop[]
  readonly focalPoint: FocalPoint | null
  /** When it last changed: the page's, or the media item's, update date. */
  readonly updated: Date | undefined

  constructor(value: { src?: unknown; crops?: unknown; focalPoint?: unknown }, updated?: Date) {
    this.src = typeof value.src === 'string' ? value.src : ''
    this.crops = readCrops(value.crops)
    this.focalPoint = readFocalPoint(value.focalPoint)
    this.updated = updated
  }

  get url(): string {
    return this.src
  }

  cropUrl(request: CropRequest): string | null {
    return this.src ? cropUrl(this.src, this.crops, this.focalPoint, request, this.updated) : null
  }

  toString(): string {
    return this.src
  }
}

/** One published media item. */
export class PublishedMedia {
  readonly key: string
  readonly id: number
  readonly name: string
  readonly mediaType: { alias: string }
  readonly properties: PublishedProperty[]
  readonly parentId: number
  /** Its ancestors' ids and its own, root first: `-1,1050,1063`. */
  readonly path: string
  readonly sortOrder: number
  readonly createDate: Date
  readonly updateDate: Date
  /** Who it says may read and change it (story 196). */
  readonly access: MediaItemAccess

  constructor(init: {
    key: string
    id: number
    name: string
    mediaTypeAlias: string
    properties: PublishedProperty[]
    parentId?: number
    path?: string
    sortOrder?: number
    createDate?: Date
    updateDate?: Date
    access?: MediaItemAccess
  }) {
    this.key = init.key
    this.id = init.id
    this.name = init.name
    this.mediaType = { alias: init.mediaTypeAlias }
    this.properties = init.properties
    this.parentId = init.parentId ?? -1
    this.path = init.path ?? `${this.parentId},${init.id}`
    this.access = init.access ?? OPEN_MEDIA
    this.sortOrder = init.sortOrder ?? 0
    this.createDate = init.createDate ?? new Date(0)
    this.updateDate = init.updateDate ?? this.createDate
  }

  /** The file's URL: what `umbracoFile` holds. */
  get url(): string {
    const file = this.properties.find((p) => p.alias === 'umbracoFile')?.value
    if (typeof file === 'string') return file
    const src = (file as { src?: unknown } | null | undefined)?.src
    return typeof src === 'string' ? src : ''
  }

  /** The file as an Image Cropper value, for its crops and focal point. */
  get image(): ImageCropperValue {
    const file = this.properties.find((p) => p.alias === 'umbracoFile')?.value
    return new ImageCropperValue(
      typeof file === 'string' ? { src: file } : ((file as object | null | undefined) ?? {}),
      this.updateDate,
    )
  }

  value(alias: string): unknown {
    return this.properties.find((p) => p.alias === alias)?.value ?? null
  }

  text(alias: string): string {
    const value = this.value(alias)
    return value === null || value === undefined ? '' : String(value)
  }
}

/**
 * A Media Picker entry: the media item, with the crops and focal point this
 * pick overrides (Umbraco's `MediaWithCrops`).
 */
export class MediaWithCrops {
  readonly key: string
  readonly media: PublishedMedia
  readonly crops: Crop[]
  readonly focalPoint: FocalPoint | null

  constructor(
    media: PublishedMedia,
    local: { key?: unknown; crops?: unknown; focalPoint?: unknown },
  ) {
    this.media = media
    this.key = typeof local.key === 'string' ? local.key : media.key
    const own = media.image
    const localCrops = readCrops(local.crops)
    // The pick's own crop wins; the media's crops fill in the rest.
    this.crops = [
      ...localCrops,
      ...own.crops.filter((c) => !localCrops.some((l) => l.alias === c.alias)),
    ]
    this.focalPoint = readFocalPoint(local.focalPoint) ?? own.focalPoint
  }

  get name(): string {
    return this.media.name
  }

  get url(): string {
    return this.media.url
  }

  cropUrl(request: CropRequest): string | null {
    return this.url
      ? cropUrl(this.url, this.crops, this.focalPoint, request, this.media.updateDate)
      : null
  }
}
