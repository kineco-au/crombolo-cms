/**
 * A minimal zip writer, because a created package is a zip (`docs/bundles.md`),
 * and a bounded reader, for a schema uploaded in Settings (story 342).
 *
 * No dependency: `node:zlib` provides `deflateRawSync` and `crc32`, which is
 * everything the format needs. Entries are written in the order given, each
 * stored if deflating does not make it smaller, and timestamps are fixed at the
 * epoch the format starts from so the same selection zips to the same bytes.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** The path inside the archive, `/`-separated and never absolute. */
  path: string
  bytes: Uint8Array
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50

/** Deflate, or store when deflating gains nothing — as every zip writer does. */
const STORED = 0
const DEFLATED = 8

/**
 * 1980-01-01 00:00:00, the earliest the DOS field can express. A real time
 * would make the bytes depend on when the download happened, and nothing reads
 * these timestamps.
 */
const DOS_DATE = 0x0021
const DOS_TIME = 0x0000

/** Bit 11: the name is UTF-8, so a non-ASCII path survives the round trip. */
const UTF8_FLAG = 0x0800

class Writer {
  #chunks: Uint8Array[] = []
  #length = 0

  get length(): number {
    return this.#length
  }

  bytes(value: Uint8Array): void {
    this.#chunks.push(value)
    this.#length += value.length
  }

  u16(value: number): void {
    const view = new Uint8Array(2)
    new DataView(view.buffer).setUint16(0, value, true)
    this.bytes(view)
  }

  u32(value: number): void {
    const view = new Uint8Array(4)
    new DataView(view.buffer).setUint32(0, value >>> 0, true)
    this.bytes(view)
  }

  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.#length)
    let offset = 0
    for (const chunk of this.#chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

interface Compressed {
  method: number
  crc: number
  deflated: Uint8Array
  size: number
}

function compress(bytes: Uint8Array): Compressed {
  const crc = crc32(bytes) >>> 0
  if (bytes.length === 0) return { method: STORED, crc, deflated: bytes, size: 0 }
  const deflated = new Uint8Array(deflateRawSync(bytes))
  return deflated.length < bytes.length
    ? { method: DEFLATED, crc, deflated, size: bytes.length }
    : { method: STORED, crc, deflated: bytes, size: bytes.length }
}

/**
 * The archive as one buffer. Package zips are a schema directory, some views
 * and a media library's worth of images — large enough to care about, small
 * enough that streaming would buy nothing but complexity.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const body = new Writer()
  const central = new Writer()

  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const { method, crc, deflated, size } = compress(entry.bytes)
    const offset = body.length

    body.u32(LOCAL_HEADER)
    body.u16(20)
    body.u16(UTF8_FLAG)
    body.u16(method)
    body.u16(DOS_TIME)
    body.u16(DOS_DATE)
    body.u32(crc)
    body.u32(deflated.length)
    body.u32(size)
    body.u16(name.length)
    body.u16(0)
    body.bytes(name)
    body.bytes(deflated)

    central.u32(CENTRAL_HEADER)
    central.u16(20)
    central.u16(20)
    central.u16(UTF8_FLAG)
    central.u16(method)
    central.u16(DOS_TIME)
    central.u16(DOS_DATE)
    central.u32(crc)
    central.u32(deflated.length)
    central.u32(size)
    central.u16(name.length)
    central.u16(0)
    central.u16(0)
    central.u16(0)
    central.u16(0)
    // 0o100644 in the high word: a regular file, readable, as unzip expects.
    central.u32(0o100644 << 16)
    central.u32(offset)
    central.bytes(name)
  }

  const out = new Writer()
  out.bytes(body.concat())
  const centralOffset = out.length
  out.bytes(central.concat())
  out.u32(END_OF_CENTRAL)
  out.u16(0)
  out.u16(0)
  out.u16(entries.length)
  out.u16(entries.length)
  out.u32(central.length)
  out.u32(centralOffset)
  out.u16(0)
  return out.concat()
}

export class ZipError extends Error {}

export interface ZipLimits {
  /** The most entries an archive may hold. */
  maxEntries: number
  /** The most bytes one entry may unpack to. */
  maxEntryBytes: number
  /** The most bytes every entry together may unpack to. */
  maxTotalBytes: number
}

/**
 * The files in an archive, read through its central directory as an unzip tool
 * does. Directories are left out. Anything this writer would not write, an
 * encrypted or unknown entry, or one past the limits, is refused rather than
 * guessed at, so an upload can't unpack to more than the limits say.
 */
export function readZip(archive: Uint8Array, limits: ZipLimits): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let end = archive.length - 22
  const floor = Math.max(0, archive.length - 22 - 0xffff)
  while (end >= floor && view.getUint32(end, true) !== END_OF_CENTRAL) end -= 1
  if (end < floor) throw new ZipError('This is not a zip file.')

  const count = view.getUint16(end + 10, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (count > limits.maxEntries)
    throw new ZipError(`It holds more than ${limits.maxEntries} files.`)

  const entries: ZipEntry[] = []
  let total = 0
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > archive.length || view.getUint32(cursor, true) !== CENTRAL_HEADER)
      throw new ZipError('The zip file is damaged.')
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    let path: string
    try {
      path = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength))
    } catch {
      throw new ZipError('A file in the zip has a name that is not readable text.')
    }
    cursor += 46 + nameLength + extraLength + commentLength
    if (path.endsWith('/')) continue
    if (flags & 0x1) throw new ZipError(`"${path}" is encrypted.`)
    if (method !== STORED && method !== DEFLATED)
      throw new ZipError(`"${path}" is compressed in a way this can't read.`)
    if (size > limits.maxEntryBytes) throw new ZipError(`"${path}" is too large.`)
    total += size
    if (total > limits.maxTotalBytes) throw new ZipError('The files in it are too large together.')

    if (localOffset + 30 > archive.length || view.getUint32(localOffset, true) !== LOCAL_HEADER)
      throw new ZipError('The zip file is damaged.')
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true)
    if (start + compressedSize > archive.length) throw new ZipError('The zip file is damaged.')
    const stored = archive.subarray(start, start + compressedSize)
    let bytes: Uint8Array
    try {
      bytes =
        method === STORED
          ? stored.slice()
          : new Uint8Array(inflateRawSync(stored, { maxOutputLength: limits.maxEntryBytes }))
    } catch {
      throw new ZipError(`"${path}" could not be unpacked.`)
    }
    if (bytes.length !== size) throw new ZipError('The zip file is damaged.')
    entries.push({ path, bytes })
  }
  return entries
}
