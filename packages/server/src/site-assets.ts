/**
 * The hash of each of the site's stylesheets and scripts (story 260), worked
 * out as the server starts and again when a watched file changes, so
 * `asset()` answers from memory. docs/rendering.md, "Stylesheets and scripts".
 */
import { existsSync, type FSWatcher, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { contentHash, hashedAddress } from '@crombolo/render'

export interface AssetRoot {
  /** Where its files are served: `/css`. */
  prefix: string
  dir: string
  extension: string
}

export class SiteAssets {
  readonly #roots: readonly AssetRoot[]
  readonly #hashes = new Map<string, string>()
  readonly #watchers: FSWatcher[] = []

  constructor(roots: readonly AssetRoot[]) {
    this.#roots = roots
  }

  /** Hashes every file, and watches each folder for changes. */
  start(): void {
    for (const root of this.#roots) {
      if (!existsSync(root.dir)) continue
      for (const file of filesIn(root.dir)) this.#hash(root, file)
      try {
        const watcher = watch(root.dir, { recursive: true }, (_event, name) => {
          if (name) this.#hash(root, join(root.dir, name.toString()))
        })
        watcher.on('error', () => {})
        this.#watchers.push(watcher)
      } catch {
        // A folder that cannot be watched keeps the hashes it started with.
      }
    }
  }

  /** The hashed address of a file the site has, or undefined. */
  address(path: string): string | undefined {
    const hash = this.#hashes.get(path)
    return hash ? hashedAddress(path, hash) : undefined
  }

  close(): void {
    for (const watcher of this.#watchers.splice(0)) watcher.close()
  }

  #hash(root: AssetRoot, file: string): void {
    const path = `${root.prefix}/${relative(root.dir, file).split(sep).join('/')}`
    if (!file.toLowerCase().endsWith(root.extension)) return
    try {
      if (!statSync(file).isFile()) return
      this.#hashes.set(path, contentHash(readFileSync(file)))
    } catch {
      this.#hashes.delete(path)
    }
  }
}

function filesIn(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) filesIn(path, out)
    else out.push(path)
  }
  return out
}
