/**
 * The site's `public/` folder in a bundle (story 284). Its files can be large,
 * so `public.json` lists each with its size and hash, the bundle's hash covers
 * that list, and no file is held in memory. `docs/bundles.md`, "Public files".
 */
import { closeSync, openSync, readSync } from 'node:fs'
import { BUNDLE_SECTIONS } from './model.ts'

/** The list of public files, at the package root beside `bundle.json`. */
export const PUBLIC_MANIFEST = 'public.json'

/** A public file a bundle carries, at its path inside the bundle. */
export interface PublicFile {
  path: string
  size: number
  sha256: string
}

/** A public file on its way into a bundle, and where its bytes are. */
export interface PublicSource extends PublicFile {
  source: string
}

/** A path that stays inside the bundle's `public/`. */
export const isPublicPath = (path: string): boolean => {
  const [top, ...rest] = path.split('/')
  return (
    top === BUNDLE_SECTIONS.public &&
    rest.length > 0 &&
    !rest.some((part) => part === '' || part === '.' || part === '..' || part.includes('\\'))
  )
}

/** A file's SHA-256, read a piece at a time. */
export function hashFile(file: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  const piece = new Uint8Array(1024 * 1024)
  const fd = openSync(file, 'r')
  try {
    for (let read = readSync(fd, piece); read > 0; read = readSync(fd, piece))
      hasher.update(piece.subarray(0, read))
  } finally {
    closeSync(fd)
  }
  return hasher.digest('hex')
}

export function writePublicManifest(files: readonly PublicFile[]): string {
  const entries = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, size, sha256 }) => ({ path, size, sha256 }))
  return `${JSON.stringify({ files: entries }, null, 2)}\n`
}
