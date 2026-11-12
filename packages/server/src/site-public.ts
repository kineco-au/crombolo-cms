/**
 * The site's `public/` folder (story 284): its files at the root of the site,
 * at the same paths. Listed as the server starts and when the folder changes,
 * so a page request asks a map and never the disk, and only a path in the map
 * is ever served. docs/rendering.md, "Public files".
 */
import { existsSync, type FSWatcher, readdirSync, realpathSync, statSync, watch } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { serveStaticFile } from '@crombolo/backoffice-host'
import { hashedAddress, splitHashedAddress } from '@crombolo/render'
import { BUNDLE_SECTIONS, hashFile, type PublicSource } from '@crombolo/transfer'
import { isSitePath } from './middleware.ts'

/** Where a CLI finds out what a server is: never a site's to answer. */
export const REMOTE_DISCOVERY_PATH = '/.well-known/crombolo-remote'

/** Above this, `site build` says what is making the bundle heavy. */
export const PUBLIC_WARNING_BYTES = 100 * 1024 ** 2

const IMMUTABLE = 'public, max-age=31536000, immutable'
const WELL_KNOWN = '.well-known'
/** What git needs to keep an empty folder: it travels with the folder, and is never served. */
const FOLDER_KEEPER = '.gitkeep'
const RESCAN_DELAY_MS = 25
/**
 * After a node is told of a change, it lists the folder again at these delays:
 * a shared folder can show another machine's write up to a minute late.
 */
const RELIST_AFTER_MS = [5_000, 15_000, 30_000, 60_000, 90_000]

/** Whether an address is the CMS's own, which no public file can take. */
export function isReservedPublicPath(path: string, backOfficePath: string): boolean {
  const lower = path.toLowerCase()
  if (lower === '/robots.txt' || lower === '/sitemap.xml') return false
  return (
    !isSitePath(path, backOfficePath) ||
    lower === REMOTE_DISCOVERY_PATH ||
    ['/css', '/scripts'].some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))
  )
}

/** A dotfile, and anything in a dot folder, stays private except under `.well-known/`. Pure. */
const isServable = (relativePath: string): boolean =>
  relativePath
    .split('/')
    .every((part, index) => !part.startsWith('.') || (index === 0 && part === WELL_KNOWN))

/** A symlink counts only when it ends inside the folder and at a file. */
function isInsideFolder(root: string, file: string): boolean {
  try {
    const real = realpathSync(file)
    return real.startsWith(`${realpathSync(root)}${sep}`) && statSync(real).isFile()
  } catch {
    return false
  }
}

/** Every regular file under `root`, relative and `/`-separated, dotfiles included. */
function filesIn(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) filesIn(root, path, out)
    else if (entry.isFile() || (entry.isSymbolicLink() && isInsideFolder(root, path)))
      out.push(relative(root, path).split(sep).join('/'))
  }
  return out
}

/** What a bundle carries from the folder: the files that are served, and what keeps it in git. */
export function publicSources(root: string): PublicSource[] {
  if (!existsSync(root)) return []
  return filesIn(root)
    .filter((path) => isServable(path) || basename(path) === FOLDER_KEEPER)
    .sort()
    .map((path) => {
      const source = join(root, path)
      return {
        path: `${BUNDLE_SECTIONS.public}/${path}`,
        size: statSync(source).size,
        sha256: hashFile(source),
        source,
      }
    })
}

export interface PublicClash {
  /** The file, inside the folder. */
  file: string
  /** `reserved`: it can never answer. `route`: it takes a route's address. `generated`: it replaces what the CMS writes there. */
  kind: 'reserved' | 'route' | 'generated'
  address: string
}

/** Each public file at an address something else answers, from files alone. */
export function publicClashes(options: {
  publicDir: string
  backOfficePath: string
  routes?: readonly { path: string }[]
}): PublicClash[] {
  const routes = (options.routes ?? []).map((route) => new URLPattern({ pathname: route.path }))
  return filesFrom(options.publicDir).flatMap((file): PublicClash[] => {
    const address = `/${file}`
    if (isReservedPublicPath(address, options.backOfficePath))
      return [{ file, kind: 'reserved', address }]
    if (address === '/robots.txt' || address === '/sitemap.xml')
      return [{ file, kind: 'generated', address }]
    return routes.some((route) => route.test({ pathname: address }))
      ? [{ file, kind: 'route', address }]
      : []
  })
}

interface PublicEntry {
  file: string
  /** Of the file's bytes, worked out when first asked for and kept until it changes. */
  hash?: string
  size: number
  modified: number
}

/** The URL path of each file, decoded; a malformed escape matches nothing. */
function decoded(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

export class PublicFiles {
  readonly #root: string
  readonly #backOfficePath: string
  #index = new Map<string, PublicEntry>()
  #folder: FSWatcher | undefined
  #parent: FSWatcher | undefined
  #rescan: ReturnType<typeof setTimeout> | undefined
  #relist: ReturnType<typeof setTimeout>[] = []
  readonly #watch: boolean
  readonly #relistAfter: readonly number[]

  constructor(
    root: string,
    backOfficePath: string,
    options: { watch?: boolean; relistAfterMs?: readonly number[] } = {},
  ) {
    this.#root = root
    this.#backOfficePath = backOfficePath
    this.#watch = options.watch !== false
    this.#relistAfter = options.relistAfterMs ?? RELIST_AFTER_MS
  }

  /** Lists the folder and watches it, and watches for it being made or replaced. */
  start(): void {
    this.#list()
    if (!this.#watch) return
    this.#watchFolder()
    try {
      const name = basename(this.#root)
      this.#parent = watch(dirname(this.#root), (_event, changed) => {
        if (changed !== null && changed.toString() !== name) return
        this.#watchFolder()
        this.#scheduleRescan()
      })
      this.#parent.on('error', () => {})
    } catch {
      // A folder that cannot be watched keeps the files it started with.
    }
  }

  /** The folder changed where no watcher can see: listed now, and again as it settles. */
  changed(): void {
    for (const timer of this.#relist.splice(0)) clearTimeout(timer)
    this.#list()
    this.#relist = this.#relistAfter.map((delay) => {
      const timer = setTimeout(() => this.#list(), delay)
      timer.unref?.()
      return timer
    })
  }

  close(): void {
    clearTimeout(this.#rescan)
    for (const timer of this.#relist.splice(0)) clearTimeout(timer)
    this.#folder?.close()
    this.#parent?.close()
  }

  /** Whether a request path is a public file. */
  has(pathname: string): boolean {
    const path = decoded(pathname)
    return path !== undefined && this.#index.has(path)
  }

  /** The URL paths of the files, sorted. */
  paths(): string[] {
    return [...this.#index.keys()].sort()
  }

  /** The files at an address that `page` says has a page. */
  async hiding(page: (path: string) => Promise<unknown>): Promise<string[]> {
    const found = await Promise.all(
      this.paths().map(async (path) => ((await page(path)) ? [path] : [])),
    )
    return found.flat()
  }

  /** The hashed address of a file the site has, or undefined. */
  address(path: string): string | undefined {
    const entry = this.#index.get(path)
    if (!entry) return undefined
    try {
      entry.hash ??= addressHash(entry.file)
      return hashedAddress(path, entry.hash)
    } catch {
      return undefined
    }
  }

  /**
   * A public file's answer, or undefined when the path is not one. The hashed
   * address answers only while the hash is the file's, and nothing when not.
   */
  async serve(request: Request, pathname: string): Promise<Response | undefined> {
    const path = decoded(pathname)
    if (path === undefined) return undefined
    const own = this.#index.get(path)
    if (own) return this.#send(own, 'no-cache', request)
    const hashed = splitHashedAddress(path)
    const entry = hashed && this.#index.get(hashed.path)
    if (!hashed || !entry) return undefined
    if (this.#hashNow(entry) !== hashed.hash)
      return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } })
    return this.#send(entry, IMMUTABLE, request)
  }

  async #send(entry: PublicEntry, cacheControl: string, request: Request) {
    const response = await serveStaticFile({ file: entry.file, cacheControl }, request)
    response?.headers.set('x-content-type-options', 'nosniff')
    return response
  }

  /** The hash of the bytes as they are now, so a change the watcher missed is never kept. */
  #hashNow(entry: PublicEntry): string | undefined {
    try {
      const stat = statSync(entry.file)
      if (stat.size !== entry.size || stat.mtimeMs !== entry.modified) entry.hash = undefined
      entry.size = stat.size
      entry.modified = stat.mtimeMs
      entry.hash ??= addressHash(entry.file)
      return entry.hash
    } catch {
      return undefined
    }
  }

  #list(): void {
    const next = new Map<string, PublicEntry>()
    for (const path of filesFrom(this.#root)) {
      const key = `/${path}`
      if (isReservedPublicPath(key, this.#backOfficePath)) continue
      const file = join(this.#root, path)
      try {
        const stat = statSync(file)
        const known = this.#index.get(key)
        const same = known?.size === stat.size && known.modified === stat.mtimeMs
        next.set(key, {
          file,
          size: stat.size,
          modified: stat.mtimeMs,
          ...(same && known.hash ? { hash: known.hash } : {}),
        })
      } catch {
        // Gone between the listing and the look: it is not there.
      }
    }
    this.#index = next
  }

  #watchFolder(): void {
    this.#folder?.close()
    this.#folder = undefined
    if (!existsSync(this.#root)) return
    try {
      this.#folder = watch(this.#root, { recursive: true }, () => this.#scheduleRescan())
      this.#folder.on('error', () => {})
    } catch {
      // As in `start`.
    }
  }

  /** Listed again as a whole: a folder moved in reports only its own name. */
  #scheduleRescan(): void {
    clearTimeout(this.#rescan)
    this.#rescan = setTimeout(() => this.#list(), RESCAN_DELAY_MS)
    this.#rescan.unref?.()
  }
}

/** The servable files of a folder, which may not exist. */
function filesFrom(root: string): string[] {
  try {
    // Sorted: the folder's own order differs between file systems.
    return existsSync(root) ? filesIn(root).filter(isServable).sort() : []
  } catch {
    return []
  }
}

/** `contentHash` of the file's bytes, without holding them in memory. */
const addressHash = (file: string): string => hashFile(file).slice(0, 8)
