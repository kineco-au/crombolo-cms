/**
 * Story 435: an extension's own files, kept by the host in its data folder, which its
 * process can no longer read or write itself, so nothing it saves is ever run. Names are
 * plain (`notes.json`, `cache/feed.xml`), each file at most 10 MB and all of them 200 MB.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

/** What an extension keeps: by a name relative to its own folder. */
export interface BundleFiles {
  read(name: string): Promise<Uint8Array | undefined>
  /** Refused over 10 MB, or past 200 MB in all. */
  write(name: string, bytes: Uint8Array | string): Promise<void>
  remove(name: string): Promise<void>
  /** Every name it holds, sorted. */
  list(): Promise<string[]>
}

export const FILE_LIMIT_BYTES = 10 * 1024 * 1024
export const FOLDER_LIMIT_BYTES = 200 * 1024 * 1024

const NAME = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

/** An extension's data folder, where only the host writes. */
export const extensionDataDir = (siteDir: string, bundleId: string) =>
  join(siteDir, '.crombolo', 'extensions', bundleId, 'data')

function walk(dir: string, root: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, root, out)
    else out.push(relative(root, path).split(sep).join('/'))
  }
  return out
}

/** An extension's files, kept in `dir`. */
export function createBundleFiles(dir: string): BundleFiles {
  const pathOf = (name: string) => {
    if (
      typeof name !== 'string' ||
      !NAME.test(name) ||
      name.split('/').some((p) => /^\.+$/.test(p))
    )
      throw new Error(`"${name}" is not a file name: letters, digits, dots, hyphens and slashes.`)
    const path = normalize(join(dir, name))
    if (!path.startsWith(`${normalize(dir)}${sep}`))
      throw new Error(`"${name}" is outside its folder.`)
    return path
  }
  const used = () =>
    walk(dir, dir).reduce((total, name) => total + statSync(join(dir, name)).size, 0)
  return {
    async read(name) {
      const file = Bun.file(pathOf(name))
      return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : undefined
    },
    async write(name, bytes) {
      const path = pathOf(name)
      const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
      if (body.byteLength > FILE_LIMIT_BYTES)
        throw new Error(`"${name}" is larger than the 10 MB a file may be.`)
      const before = existsSync(path) ? statSync(path).size : 0
      if (used() - before + body.byteLength > FOLDER_LIMIT_BYTES)
        throw new Error('Its files would come to more than the 200 MB it may keep.')
      mkdirSync(dirname(path), { recursive: true })
      await Bun.write(path, body)
    },
    async remove(name) {
      rmSync(pathOf(name), { force: true })
    },
    async list() {
      return walk(dir, dir).sort()
    },
  }
}
