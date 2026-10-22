/**
 * How long copies of a page, an API answer or a media file may be kept, and by
 * whom (story 057). Three levels, the narrowest set winning: the item's own
 * "Keep copies for" choice, its type's lifetime, the site's. Nothing is kept
 * unless one of them says so. docs/operations.md, "Behind a CDN".
 */
import { CACHE_KEEP_FOR_ALIAS, KEEP_COPIES_FOR } from '@crombolo/core'

export interface CacheLifetimeOptions {
  /** Seconds a copy may be reused; 0 keeps none. */
  maxAge?: number
  /** Seconds a stale copy may still be served while a fresh one is fetched. */
  staleWhileRevalidate?: number
}

export interface CacheOptions extends CacheLifetimeOptions {
  /** By content or media type alias, winning over the site's. */
  types?: Record<string, CacheLifetimeOptions>
  /** The header a CDN reads purge tags from, such as `Surrogate-Key` or `Cache-Tag`. */
  tagHeader?: string
}

export interface CacheSettings {
  site: Lifetime
  types: ReadonlyMap<string, Lifetime>
  tagHeader: string | undefined
}

/** Kept this long, or not kept (`none`), or nothing said (`undefined`). */
export type Lifetime = { maxAge: number; staleWhileRevalidate?: number } | 'none' | undefined

/** What every answer that depends on who is asking carries, whatever is configured. */
export const PRIVATE_NO_STORE = 'private, no-store'

const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined

function lifetimeOf(options: CacheLifetimeOptions | undefined): Lifetime {
  const maxAge = seconds(options?.maxAge)
  if (maxAge === undefined) return undefined
  if (maxAge === 0) return 'none'
  const swr = seconds(options?.staleWhileRevalidate)
  return swr ? { maxAge, staleWhileRevalidate: swr } : { maxAge }
}

/** The settings with what cannot be used dropped. Pure. */
export function resolveCacheSettings(options: CacheOptions = {}): CacheSettings {
  const types = new Map<string, Lifetime>()
  for (const [alias, own] of Object.entries(options.types ?? {})) {
    const lifetime = lifetimeOf({
      staleWhileRevalidate: options.staleWhileRevalidate,
      ...own,
    })
    if (lifetime) types.set(alias.toLowerCase(), lifetime)
  }
  const tagHeader = options.tagHeader?.trim()
  return {
    site: lifetimeOf(options),
    types,
    tagHeader: tagHeader && /^[A-Za-z0-9-]+$/.test(tagHeader) ? tagHeader : undefined,
  }
}

/** An editor's "Keep copies for" choice as a lifetime, or undefined for none chosen. Pure. */
export function chosenLifetime(value: unknown, staleWhileRevalidate?: number): Lifetime {
  const label = Array.isArray(value) ? value[0] : value
  const choice = KEEP_COPIES_FOR.find((c) => c.label === label)
  if (!choice) return undefined
  if (choice.seconds === 0) return 'none'
  return staleWhileRevalidate
    ? { maxAge: choice.seconds, staleWhileRevalidate }
    : { maxAge: choice.seconds }
}

/** Anything with a type and properties: a page, an element or a media item. */
export interface Cacheable {
  typeAlias: string
  value(alias: string): unknown
}

/**
 * An item's lifetime: its own choice, else its type's, else the site's — or,
 * without `site`, nothing, for media files, which keep their own default. Pure.
 */
export function lifetimeFor(
  settings: CacheSettings,
  item: Cacheable,
  options: { site?: boolean } = {},
): Lifetime {
  const swr =
    settings.site && settings.site !== 'none' ? settings.site.staleWhileRevalidate : undefined
  return (
    chosenLifetime(item.value(CACHE_KEEP_FOR_ALIAS), swr) ??
    settings.types.get(item.typeAlias.toLowerCase()) ??
    (options.site === false ? undefined : settings.site)
  )
}

/** The shortest of several lifetimes: one that keeps nothing wins, one that says nothing is ignored. Pure. */
export function shortest(lifetimes: readonly Lifetime[], whenEmpty: Lifetime): Lifetime {
  let result: Lifetime
  let any = false
  for (const lifetime of lifetimes) {
    if (lifetime === undefined) continue
    if (lifetime === 'none') return 'none'
    any = true
    if (!result || result === 'none' || lifetime.maxAge < result.maxAge) result = lifetime
  }
  return any ? result : lifetimes.length === 0 ? whenEmpty : undefined
}

/** The `Cache-Control` value for a public answer, or undefined to say nothing. Pure. */
export function cacheControl(lifetime: Lifetime): string | undefined {
  if (lifetime === undefined) return undefined
  if (lifetime === 'none') return 'no-store'
  return lifetime.staleWhileRevalidate
    ? `public, max-age=${lifetime.maxAge}, stale-while-revalidate=${lifetime.staleWhileRevalidate}`
    : `public, max-age=${lifetime.maxAge}`
}

/** A weak validator over a body's bytes. */
export function etagFor(body: string | Uint8Array): string {
  return `W/"${Bun.hash(body).toString(36)}"`
}

/** Whether `If-None-Match` names this tag, or `*`. Pure. */
export function notModified(request: Request, etag: string): boolean {
  const header = request.headers.get('if-none-match')
  if (!header) return false
  const bare = etag.replace(/^W\//, '')
  return header
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || tag.replace(/^W\//, '') === bare)
}

/** Purge tags in the form the header expects: spaces for `Surrogate-Key`, commas otherwise. Pure. */
export function tagValue(header: string, keys: Iterable<string>): string | undefined {
  const unique = [...new Set([...keys].map((key) => key.toLowerCase()))]
  if (unique.length === 0) return undefined
  return unique.join(header.toLowerCase() === 'surrogate-key' ? ' ' : ',')
}

/**
 * The finished headers of a public `200`: its lifetime, an ETag over the body,
 * and its tags; a `304` when the caller already holds it.
 */
export function cacheable(
  request: Request,
  response: Response,
  body: string | Uint8Array,
  options: { lifetime: Lifetime; tags?: Iterable<string>; tagHeader?: string },
): Response {
  const headers = new Headers(response.headers)
  const control = cacheControl(options.lifetime)
  if (control) headers.set('cache-control', control)
  const etag = etagFor(body)
  headers.set('etag', etag)
  if (options.tagHeader && options.tags) {
    const tags = tagValue(options.tagHeader, options.tags)
    if (tags) headers.set(options.tagHeader, tags)
  }
  if (notModified(request, etag)) {
    headers.delete('content-type')
    headers.delete('content-length')
    return new Response(null, { status: 304, headers })
  }
  return new Response(body as BodyInit, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
