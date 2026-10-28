/**
 * What may be uploaded, as Umbraco's defaults have it (`ContentSettings`,
 * `ContentImagingSettings`). The temporary-file configuration endpoint reports
 * these, and the upload endpoints enforce the same lists.
 */
export interface UploadSettings {
  /** Extensions treated as images: resizable, croppable, shown as thumbnails. */
  imageFileTypes: string[]
  /** Never accepted, whatever else is configured: files a server could execute. */
  disallowedExtensions: string[]
  /** When non-empty, only these are accepted. Empty means anything not disallowed. */
  allowedExtensions: string[]
  /** In bytes; null means no limit is configured. */
  maxFileSize: number | null
}

export const DEFAULT_UPLOAD_SETTINGS: Readonly<UploadSettings> = {
  imageFileTypes: ['jpeg', 'jpg', 'gif', 'bmp', 'png', 'tiff', 'tif', 'webp'],
  disallowedExtensions: [
    'ashx',
    'aspx',
    'ascx',
    'config',
    'cshtml',
    'vbhtml',
    'asmx',
    'air',
    'axd',
    'xamlx',
  ],
  allowedExtensions: [],
  maxFileSize: null,
}

/** Whether a file name's extension may be uploaded under these settings. */
export function isUploadAllowed(fileName: string, settings: UploadSettings): boolean {
  const dot = fileName.lastIndexOf('.')
  const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  if (settings.disallowedExtensions.includes(extension)) return false
  return settings.allowedExtensions.length === 0 || settings.allowedExtensions.includes(extension)
}

/** The extension of a file name, lowercase and without the dot; `''` when it has none. Pure. */
export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

/**
 * A file type a member may be allowed to upload into a media folder (story
 * 198), recognised by its first bytes. `image` types are re-encoded on the way
 * in, so their metadata is stripped.
 */
export interface MemberFileType {
  /** Stored on the folder's rule. */
  id: string
  label: string
  extensions: readonly string[]
  image: boolean
}

export const MEMBER_FILE_TYPES: readonly MemberFileType[] = [
  { id: 'jpeg', label: 'JPEG image', extensions: ['jpg', 'jpeg'], image: true },
  { id: 'png', label: 'PNG image', extensions: ['png'], image: true },
  { id: 'gif', label: 'GIF image', extensions: ['gif'], image: true },
  { id: 'webp', label: 'WebP image', extensions: ['webp'], image: true },
  { id: 'avif', label: 'AVIF image', extensions: ['avif'], image: true },
  { id: 'heic', label: 'HEIC image (iPhone)', extensions: ['heic', 'heif'], image: true },
  { id: 'pdf', label: 'PDF document', extensions: ['pdf'], image: false },
  { id: 'mp3', label: 'MP3 audio', extensions: ['mp3'], image: false },
  { id: 'wav', label: 'WAV audio', extensions: ['wav'], image: false },
  { id: 'mp4', label: 'MP4 video', extensions: ['mp4', 'm4v'], image: false },
  { id: 'mov', label: 'QuickTime video', extensions: ['mov'], image: false },
]

const memberFileType = (id: string) => MEMBER_FILE_TYPES.find((type) => type.id === id)

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

/** The brands an ISO media file's `ftyp` box names: its major brand and the compatible ones. */
function ftypBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return []
  const size = Math.min(
    bytes.length,
    ((bytes[0] as number) << 24) |
      ((bytes[1] as number) << 16) |
      ((bytes[2] as number) << 8) |
      (bytes[3] as number),
  )
  const brands = [ascii(bytes, 8, 4)]
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(bytes, at, 4))
  return brands
}

/**
 * What a file is, read from its first bytes (its magic number) for the types
 * members may be allowed to upload; undefined for anything else. Pure.
 */
export function detectFileType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value)
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg'
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav'
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf'
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    return 'mp3'
  const brands = ftypBrands(bytes)
  if (brands.length > 0) {
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'avif'
    if (
      brands.some((b) =>
        ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(b),
      )
    )
      return 'heic'
    if (brands[0] === 'qt  ') return 'mov'
    if (
      brands.some((b) =>
        ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(
          b,
        ),
      )
    )
      return 'mp4'
  }
  return undefined
}

/** Why a member's upload is refused, or the type it is. */
export type MemberUploadCheck =
  | { ok: true; type: MemberFileType }
  | { ok: false; reason: string; status: 400 | 415 }

/**
 * Whether a member may upload this file where `allowed` lists the types
 * accepted: what its first bytes say it is, its extension and the list must
 * all agree, and the site's own upload settings must not refuse it. Pure.
 */
export function checkMemberUpload(
  fileName: string,
  head: Uint8Array,
  allowed: readonly string[],
  settings: UploadSettings = DEFAULT_UPLOAD_SETTINGS,
): MemberUploadCheck {
  const extension = extensionOf(fileName)
  if (!extension)
    return { ok: false, status: 400, reason: 'The file needs an extension, such as .jpg.' }
  if (!isUploadAllowed(fileName, settings))
    return { ok: false, status: 415, reason: `This site does not accept .${extension} files.` }
  const detected = detectFileType(head)
  const type = detected ? memberFileType(detected) : undefined
  if (!type) return { ok: false, status: 415, reason: 'This kind of file cannot be uploaded here.' }
  if (!type.extensions.includes(extension))
    return {
      ok: false,
      status: 415,
      reason: `The file is named .${extension} but is a ${type.label}; rename it and try again.`,
    }
  if (!allowed.includes(type.id))
    return { ok: false, status: 415, reason: `A ${type.label} cannot be uploaded here.` }
  return { ok: true, type }
}
