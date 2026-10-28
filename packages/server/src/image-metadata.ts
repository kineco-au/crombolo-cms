/**
 * What a photo says about itself, and taking it out (story 198). A member's
 * upload carries EXIF from their phone — where it was taken, when, which way
 * up — which is read here before the file is stored without it.
 *
 * The reader walks the TIFF structure EXIF is: IFD0 for the orientation, the
 * EXIF IFD for the time taken, the GPS IFD for the location. The strippers
 * drop every block a format keeps metadata in, leaving the pixels and the
 * colour profile.
 */

export interface ImageLocation {
  latitude: number
  longitude: number
  /** Metres above sea level; negative below it. */
  altitude?: number
}

export interface ExifFacts {
  /** 1–8, as EXIF numbers them; 1 is upright. */
  orientation?: number
  /** `2026-10-28T09:15:00`, with the camera's offset when it wrote one. */
  takenAt?: string
  location?: ImageLocation
}

const TAG_ORIENTATION = 0x0112
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_TAKEN = 0x9003
const TAG_TAKEN_OFFSET = 0x9011
const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

/** The facts a TIFF block of EXIF holds; empty for anything malformed. */
export function readExifTiff(tiff: Uint8Array): ExifFacts {
  if (tiff.length < 8) return {}
  const order = ascii(tiff, 0, 2)
  if (order !== 'II' && order !== 'MM') return {}
  const little = order === 'II'
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const u16 = (at: number) => (at + 2 <= tiff.length ? view.getUint16(at, little) : 0)
  const u32 = (at: number) => (at + 4 <= tiff.length ? view.getUint32(at, little) : 0)

  type Entry = { type: number; count: number; at: number }
  /** An IFD's entries by tag, each pointing at where its value lies. */
  const ifd = (offset: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>()
    if (offset <= 0 || offset + 2 > tiff.length) return entries
    const count = Math.min(u16(offset), 512)
    for (let i = 0; i < count; i++) {
      const o = offset + 2 + i * 12
      if (o + 12 > tiff.length) break
      const type = u16(o + 2)
      const n = u32(o + 4)
      const size = (TYPE_SIZES[type] ?? 0) * n
      entries.set(u16(o), { type, count: n, at: size <= 4 ? o + 8 : u32(o + 8) })
    }
    return entries
  }
  const text = (entry: Entry | undefined) => {
    if (entry?.type !== 2 || entry.at + entry.count > tiff.length) return undefined
    return ascii(tiff, entry.at, entry.count).replace(/\0.*$/s, '').trim() || undefined
  }
  const rational = (at: number) => {
    const denominator = u32(at + 4)
    return denominator === 0 ? Number.NaN : u32(at) / denominator
  }
  const rationals = (entry: Entry | undefined) => {
    if (entry?.type !== 5 || entry.at + entry.count * 8 > tiff.length) return undefined
    return Array.from({ length: entry.count }, (_, i) => rational(entry.at + i * 8))
  }

  const facts: ExifFacts = {}
  const zero = ifd(u32(4))
  const orientation = zero.get(TAG_ORIENTATION)
  if (orientation?.type === 3) {
    const value = u16(orientation.at)
    if (value >= 1 && value <= 8) facts.orientation = value
  }

  const exif = ifd(zero.get(TAG_EXIF_IFD) ? u32((zero.get(TAG_EXIF_IFD) as Entry).at) : 0)
  const taken = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    text(exif.get(TAG_TAKEN)) ?? '',
  )
  if (taken && taken[1] !== '0000') {
    const offset = text(exif.get(TAG_TAKEN_OFFSET))
    facts.takenAt = `${taken[1]}-${taken[2]}-${taken[3]}T${taken[4]}:${taken[5]}:${taken[6]}${
      offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ''
    }`
  }

  const gps = ifd(zero.get(TAG_GPS_IFD) ? u32((zero.get(TAG_GPS_IFD) as Entry).at) : 0)
  const degrees = (entry: Entry | undefined) => {
    const parts = rationals(entry)
    if (parts?.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined
    return (parts[0] as number) + (parts[1] as number) / 60 + (parts[2] as number) / 3600
  }
  const latitude = degrees(gps.get(2))
  const longitude = degrees(gps.get(4))
  if (latitude !== undefined && longitude !== undefined && latitude <= 90 && longitude <= 180) {
    const round = (value: number) => Math.round(value * 1e7) / 1e7
    const location: ImageLocation = {
      latitude: round(text(gps.get(1)) === 'S' ? -latitude : latitude),
      longitude: round(text(gps.get(3)) === 'W' ? -longitude : longitude),
    }
    const altitude = rationals(gps.get(6))?.[0]
    if (altitude !== undefined && Number.isFinite(altitude)) {
      const below = gps.get(5)
      const sign = below && below.type === 1 && tiff[below.at] === 1 ? -1 : 1
      location.altitude = Math.round(sign * altitude * 100) / 100
    }
    facts.location = location
  }
  return facts
}

const EXIF_HEADER = 'Exif\0\0'

/** The EXIF TIFF block a JPEG, PNG or WebP carries, if any. */
export function exifBlockOf(bytes: Uint8Array, format: string): Uint8Array | undefined {
  if (format === 'jpeg') {
    for (const segment of jpegSegments(bytes))
      if (segment.marker === 0xe1 && ascii(bytes, segment.body, 6) === EXIF_HEADER)
        return bytes.subarray(segment.body + 6, segment.end)
    return undefined
  }
  if (format === 'png') {
    for (const chunk of pngChunks(bytes))
      if (chunk.type === 'eXIf') return bytes.subarray(chunk.data, chunk.data + chunk.length)
    return undefined
  }
  if (format === 'webp') {
    for (const chunk of riffChunks(bytes))
      if (chunk.type === 'EXIF') {
        const data = bytes.subarray(chunk.data, chunk.data + chunk.length)
        return ascii(data, 0, 6) === EXIF_HEADER ? data.subarray(6) : data
      }
  }
  return undefined
}

/** What a photo's EXIF says, read before it is stripped. */
export const readExif = (bytes: Uint8Array, format: string): ExifFacts => {
  const block = exifBlockOf(bytes, format)
  return block ? readExifTiff(block) : {}
}

// ------------------------------------------------------------------ JPEG

interface Segment {
  marker: number
  /** Where the segment starts, at its 0xFF. */
  start: number
  /** Where its body starts, after the length. */
  body: number
  end: number
}

/** A JPEG's marker segments up to the start of scan; the scan itself is not walked. */
function jpegSegments(bytes: Uint8Array): Segment[] {
  const segments: Segment[] = []
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] as number
    if (marker === 0xff) {
      at += 1
      continue
    }
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number)
    const end = Math.min(bytes.length, at + 2 + length)
    segments.push({ marker, start: at, body: at + 4, end })
    if (marker === 0xda) break
    at = end
  }
  return segments
}

/**
 * A JPEG without its metadata: every APPn segment but JFIF (APP0) and the
 * colour profile (APP2 `ICC_PROFILE`), and every comment.
 */
export function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG.')
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  let rest = 2
  for (const segment of jpegSegments(bytes)) {
    if (segment.marker === 0xda) {
      rest = segment.start
      break
    }
    const app = segment.marker >= 0xe0 && segment.marker <= 0xef
    const keep =
      (!app && segment.marker !== 0xfe) ||
      segment.marker === 0xe0 ||
      (segment.marker === 0xe2 && ascii(bytes, segment.body, 12) === 'ICC_PROFILE\0')
    if (keep) parts.push(bytes.subarray(segment.start, segment.end))
    rest = segment.end
  }
  parts.push(bytes.subarray(rest))
  return join(parts)
}

// ------------------------------------------------------------------- PNG

const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
])

function pngChunks(bytes: Uint8Array) {
  const chunks: Array<{ type: string; start: number; data: number; length: number; end: number }> =
    []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at)
    const end = at + 12 + length
    if (end > bytes.length) break
    chunks.push({ type: ascii(bytes, at + 4, 4), start: at, data: at + 8, length, end })
    at = end
  }
  return chunks
}

/** A PNG with only the chunks that draw it: no text, EXIF, time or anything unknown. */
export function stripPng(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.subarray(0, 8)]
  for (const chunk of pngChunks(bytes))
    if (PNG_KEEP.has(chunk.type)) parts.push(bytes.subarray(chunk.start, chunk.end))
  return join(parts)
}

// ------------------------------------------------------------------ WebP

function riffChunks(bytes: Uint8Array) {
  const chunks: Array<{ type: string; start: number; data: number; length: number; end: number }> =
    []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 12
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at + 4, true)
    const end = Math.min(bytes.length, at + 8 + length + (length % 2))
    chunks.push({ type: ascii(bytes, at, 4), start: at, data: at + 8, length, end })
    at = end
  }
  return chunks
}

/** A WebP without its `EXIF` and `XMP ` chunks, its header's flags saying so. */
export function stripWebp(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = []
  for (const chunk of riffChunks(bytes)) {
    if (chunk.type === 'EXIF' || chunk.type === 'XMP ') continue
    const part = bytes.slice(chunk.start, chunk.end)
    // VP8X's flags: EXIF is bit 3, XMP bit 2.
    if (chunk.type === 'VP8X' && part.length > 8) part[8] = (part[8] as number) & ~0x0c
    kept.push(part)
  }
  const body = join(kept)
  const head = new Uint8Array(12)
  head.set(bytes.subarray(0, 12))
  new DataView(head.buffer).setUint32(4, body.length + 4, true)
  return join([head, body])
}

// ------------------------------------------------------------------- GIF

const NETSCAPE = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0'])

/**
 * A GIF without its comments and application blocks (XMP lives in one),
 * keeping the frames, their timing and the loop count, so an animation stays
 * one.
 */
export function stripGif(bytes: Uint8Array): Uint8Array {
  const head = ascii(bytes, 0, 6)
  if (head !== 'GIF87a' && head !== 'GIF89a') throw new Error('Not a GIF.')
  const table = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0)
  /** The end of a run of sub-blocks starting at `at`. */
  const subBlocks = (at: number) => {
    while (at < bytes.length) {
      const size = bytes[at] as number
      at += 1 + size
      if (size === 0) break
    }
    return at
  }
  let at = 13 + table(bytes[10] as number)
  const parts = [bytes.subarray(0, at)]
  while (at < bytes.length) {
    const kind = bytes[at] as number
    if (kind === 0x3b) {
      parts.push(bytes.subarray(at, at + 1))
      break
    }
    if (kind === 0x2c) {
      const start = at
      at += 10 + table(bytes[at + 9] as number)
      at = subBlocks(at + 1)
      parts.push(bytes.subarray(start, at))
    } else if (kind === 0x21) {
      const start = at
      const label = bytes[at + 1] as number
      const appId = label === 0xff ? ascii(bytes, at + 3, 11) : ''
      at = subBlocks(at + 2)
      const keep = label === 0xf9 || label === 0x01 || (label === 0xff && NETSCAPE.has(appId))
      if (keep) parts.push(bytes.subarray(start, at))
    } else throw new Error('The GIF could not be read.')
  }
  return join(parts)
}

// ------------------------------------------------------------- HEIF/AVIF

/** Whether an HEIF or AVIF file still holds an EXIF or XMP item, read from its header boxes. */
export function heifHasMetadata(bytes: Uint8Array): boolean {
  const mdat = indexOf(bytes, 'mdat')
  const header = bytes.subarray(0, mdat === -1 ? Math.min(bytes.length, 65536) : mdat)
  return indexOf(header, 'Exif') !== -1 || indexOf(header, 'application/rdf+xml') !== -1
}

function indexOf(bytes: Uint8Array, text: string): number {
  const needle = new TextEncoder().encode(text)
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
