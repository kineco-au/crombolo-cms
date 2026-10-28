/**
 * EXIF for tests: a little-endian TIFF block naming an orientation, when a
 * photo was taken and where, and the containers a phone writes it into.
 */

export interface ExifFields {
  orientation?: number
  /** `YYYY:MM:DD HH:MM:SS`, as a camera writes it. */
  takenAt?: string
  /** `+10:00`. */
  offset?: string
  latitude?: number
  longitude?: number
  altitude?: number
  /** Written to IFD0 as the camera's make, to find in the bytes afterwards. */
  make?: string
}

interface Entry {
  tag: number
  type: number
  count: number
  /** Inline when four bytes or fewer, else written after the IFD. */
  data: Uint8Array
}

const ascii = (tag: number, text: string): Entry => {
  const data = new TextEncoder().encode(`${text}\0`)
  return { tag, type: 2, count: data.length, data }
}
const short = (tag: number, value: number): Entry => {
  const data = new Uint8Array(2)
  new DataView(data.buffer).setUint16(0, value, true)
  return { tag, type: 3, count: 1, data }
}
const long = (tag: number, value: number): Entry => {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value, true)
  return { tag, type: 4, count: 1, data }
}
const byte = (tag: number, value: number): Entry => ({
  tag,
  type: 1,
  count: 1,
  data: new Uint8Array([value]),
})
const rationals = (tag: number, values: readonly number[]): Entry => {
  const data = new Uint8Array(values.length * 8)
  const view = new DataView(data.buffer)
  values.forEach((value, i) => {
    view.setUint32(i * 8, Math.round(value * 10000), true)
    view.setUint32(i * 8 + 4, 10000, true)
  })
  return { tag, type: 5, count: values.length, data }
}
const dms = (value: number) => {
  const abs = Math.abs(value)
  const degrees = Math.floor(abs)
  const minutes = Math.floor((abs - degrees) * 60)
  const seconds = (abs - degrees - minutes / 60) * 3600
  return [degrees, minutes, seconds]
}

/** Lays out IFDs at `start`, returning their bytes; pointers are patched by `link`. */
function ifd(entries: Entry[], start: number): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag)
  const head = 2 + sorted.length * 12 + 4
  const extra = sorted.reduce(
    (n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0),
    0,
  )
  const out = new Uint8Array(head + extra)
  const view = new DataView(out.buffer)
  view.setUint16(0, sorted.length, true)
  let at = head
  sorted.forEach((entry, i) => {
    const o = 2 + i * 12
    view.setUint16(o, entry.tag, true)
    view.setUint16(o + 2, entry.type, true)
    view.setUint32(o + 4, entry.count, true)
    if (entry.data.length <= 4) out.set(entry.data, o + 8)
    else {
      view.setUint32(o + 8, start + at, true)
      out.set(entry.data, at)
      at += entry.data.length + (entry.data.length % 2)
    }
  })
  return out
}

/** The TIFF block an EXIF segment carries. */
export function exifTiff(fields: ExifFields): Uint8Array {
  const exif: Entry[] = []
  if (fields.takenAt) exif.push(ascii(0x9003, fields.takenAt))
  if (fields.offset) exif.push(ascii(0x9011, fields.offset))
  const gps: Entry[] = []
  if (fields.latitude !== undefined && fields.longitude !== undefined) {
    gps.push(ascii(1, fields.latitude < 0 ? 'S' : 'N'), rationals(2, dms(fields.latitude)))
    gps.push(ascii(3, fields.longitude < 0 ? 'W' : 'E'), rationals(4, dms(fields.longitude)))
    if (fields.altitude !== undefined)
      gps.push(byte(5, fields.altitude < 0 ? 1 : 0), rationals(6, [Math.abs(fields.altitude)]))
  }
  const zero: Entry[] = []
  if (fields.orientation) zero.push(short(0x0112, fields.orientation))
  if (fields.make) zero.push(ascii(0x010f, fields.make))
  // Pointers are placeholders first, so IFD0's size is known.
  if (exif.length) zero.push(long(0x8769, 0))
  if (gps.length) zero.push(long(0x8825, 0))
  const first = ifd(zero, 8)
  const exifAt = 8 + first.length
  const exifBytes = exif.length ? ifd(exif, exifAt) : new Uint8Array()
  const gpsAt = exifAt + exifBytes.length
  const gpsBytes = gps.length ? ifd(gps, gpsAt) : new Uint8Array()
  const patched = zero.map((entry) =>
    entry.tag === 0x8769
      ? long(0x8769, exifAt)
      : entry.tag === 0x8825
        ? long(0x8825, gpsAt)
        : entry,
  )
  const head = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
  return concat(head, ifd(patched, 8), exifBytes, gpsBytes)
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A JPEG with an APP1 EXIF segment, and an XMP and a comment segment, after its SOI. */
export function jpegWithExif(jpeg: Uint8Array, fields: ExifFields): Uint8Array {
  const segment = (marker: number, body: Uint8Array) => {
    const head = new Uint8Array([0xff, marker, 0, 0])
    new DataView(head.buffer).setUint16(2, body.length + 2)
    return concat(head, body)
  }
  const exif = segment(0xe1, concat(new TextEncoder().encode('Exif\0\0'), exifTiff(fields)))
  const xmp = segment(
    0xe1,
    new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret-xmp</x:xmpmeta>'),
  )
  const comment = segment(0xfe, new TextEncoder().encode('secret-comment'))
  return concat(jpeg.subarray(0, 2), exif, xmp, comment, jpeg.subarray(2))
}

/** A PNG with an `eXIf` chunk and a `tEXt` chunk before its IEND. */
export function pngWithExif(png: Uint8Array, fields: ExifFields): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const end = png.length - 12
  return concat(
    png.subarray(0, end),
    chunk('eXIf', exifTiff(fields)),
    chunk('tEXt', new TextEncoder().encode('Comment\0secret-text')),
    png.subarray(end),
  )
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

/** Whether `needle` appears anywhere in `bytes`. */
export function contains(bytes: Uint8Array, needle: string | Uint8Array): boolean {
  const n = typeof needle === 'string' ? new TextEncoder().encode(needle) : needle
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer
    return true
  }
  return false
}
