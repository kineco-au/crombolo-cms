/**
 * Static serving for the vendored client.
 *
 * Two behaviours are load-bearing: the cache-bust path segment is stripped
 * before the file is looked up (Umbraco does this with a rewrite rule), and the
 * hashed prefix gets immutable caching while the unhashed one does not.
 */
import { join, normalize } from 'node:path'
import { rehomeClientModule } from '@crombolo/core'
import { type InstalledExtension, resolveExtensionFile } from './extensions.ts'
import { brandedAsset } from './graphics.ts'
import type { BackOfficePaths } from './paths.ts'
import { VENDORED_ASSETS_PATH } from './paths.ts'

const IMMUTABLE = 'public, max-age=31536000, immutable'

export interface StaticOptions {
  /** The installed npm extensions, which serve their own assets at /packages/. */
  extensions?: readonly InstalledExtension[]
  /** Serve the hashed prefix with immutable caching. Off in development. */
  immutable?: boolean
}

/** Rejects any path that escapes the root once normalised. */
function safeJoin(root: string, relative: string): string | undefined {
  const decoded = decodeURIComponent(relative)
  if (decoded.includes('\0')) return undefined
  const target = normalize(join(root, decoded))
  const rootWithSep = root.endsWith('/') ? root : `${root}/`
  return target.startsWith(rootWithSep) ? target : undefined
}

export interface StaticMatch {
  file: string
  cacheControl: string
  /**
   * A vendored module whose request addresses move to this back office path
   * as it is served: the client hard-codes Umbraco's API paths.
   */
  rehome?: string
}

/** Rewritten modules, by file and back office path: the vendored files never change while serving. */
const rehomed = new Map<string, { text: string; changed: boolean }>()

/**
 * Resolves a request path to a file on disk, or undefined if this request is not
 * ours. Strips the cache-bust segment, as Umbraco's rewrite does.
 */
export function resolveStaticFile(
  paths: BackOfficePaths,
  pathname: string,
  options: StaticOptions = {},
): StaticMatch | undefined {
  const hashedPrefix = `${paths.assetsPath}/`
  if (pathname.startsWith(hashedPrefix)) {
    const relative = pathname.slice(hashedPrefix.length)
    const branded = brandedAsset(relative)
    if (branded) return { file: join(paths.pluginDir, branded), cacheControl: 'no-cache' }
    const file = safeJoin(paths.vendorDir, relative)
    if (!file) return undefined
    return {
      file,
      cacheControl: options.immutable === false ? 'no-cache' : IMMUTABLE,
      ...rehomeFor(paths, file),
    }
  }

  // The vendored literal is an alias for wherever the editor is mounted: parts
  // of the client hard-code `/umbraco/backoffice/…` for an asset — the header
  // popover's logo, for one — and those requests arrive whatever the path is.
  const plainPrefix = [`${paths.virtualDirectory}/`, `${VENDORED_ASSETS_PATH}/`].find((prefix) =>
    pathname.startsWith(prefix),
  )
  if (plainPrefix) {
    // A stale hash from a previous deploy lands here; serve it, but do not cache.
    const rest = pathname.slice(plainPrefix.length)
    const withoutStaleHash = /^[0-9a-f]{16}\//.test(rest) ? rest.slice(17) : rest
    const branded = brandedAsset(withoutStaleHash)
    if (branded) return { file: join(paths.pluginDir, branded), cacheControl: 'no-cache' }
    const file = safeJoin(paths.vendorDir, withoutStaleHash)
    if (!file) return undefined
    return { file, cacheControl: 'no-cache', ...rehomeFor(paths, file) }
  }

  const pluginPrefix = `${paths.pluginPath}/`
  if (pathname.startsWith(pluginPrefix)) {
    const file = safeJoin(paths.pluginDir, pathname.slice(pluginPrefix.length))
    if (!file) return undefined
    return { file, cacheControl: 'no-cache' }
  }

  // An installed extension's own files, resolved inside the package it names
  // and nowhere else. `no-cache` for the same reason the framework plugin uses
  // it: a version bump moves the file behind an unchanged path.
  if (options.extensions && options.extensions.length > 0) {
    const file = resolveExtensionFile(options.extensions, pathname)
    if (file) return { file, cacheControl: 'no-cache' }
  }

  return undefined
}

const rehomeFor = (paths: BackOfficePaths, file: string): { rehome?: string } =>
  file.endsWith('.js') ? { rehome: paths.backOfficePath } : {}

/** Serves a resolved file, honouring If-None-Match. */
export async function serveStaticFile(
  match: StaticMatch,
  request: Request,
): Promise<Response | undefined> {
  const file = Bun.file(match.file)
  if (!(await file.exists())) return undefined

  const body = match.rehome === undefined ? undefined : await rehome(match.file, match.rehome)
  // The path it was rewritten for is in the tag, so moving the back office
  // is never answered from a cache of the old addresses.
  const salt = body?.changed ? `-${Bun.hash(match.rehome ?? '').toString(16)}` : ''
  const etag = `W/"${file.size.toString(16)}-${Math.floor(file.lastModified).toString(16)}${salt}"`
  const headers = new Headers({ etag, 'cache-control': match.cacheControl })
  if (file.type) headers.set('content-type', file.type)

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(body?.changed ? body.text : file, { headers })
}

async function rehome(file: string, backOfficePath: string) {
  const key = `${backOfficePath}|${file}`
  const cached = rehomed.get(key)
  if (cached) return cached
  const source = await Bun.file(file).text()
  const text = rehomeClientModule(source, backOfficePath)
  // Only the modules that change are kept as text; the rest are served as files.
  const entry = text === source ? { text: '', changed: false } : { text, changed: true }
  rehomed.set(key, entry)
  return entry
}
