/**
 * How long copies of a page, an API answer or a media file may be kept, and by
 * whom (story 057). Three levels, the narrowest set winning: the item's own
 * "Keep copies for" choice, its type's lifetime, the site's. Nothing is kept
 * unless one of them says so. docs/operations.md, "Behind a CDN".
 */
import { CACHE_KEEP_FOR_ALIAS, KEEP_COPIES_FOR } from '@crombolo/core'

export interface CacheLifetimeOptions {
  /** Seconds a copy may be reused; 0 keeps none, unless the mode is `check`. */
  maxAge?: number
  /** Seconds a stale copy may still be served while a fresh one is fetched. */
  staleWhileRevalidate?: number
  /** Seconds a stale copy may still be served while the site answers with an error (story 259). */
  staleIfError?: number
}

/**
 * How copies are kept (story 259): for the lifetime given, or, with `check`,
 * kept and checked back with the site before each use, served while checking
 * and while the site is down.
 */
export type CacheMode = 'lifetime' | 'check'

/**
 * What an ETag is worked out from (story 258): the body, after rendering, or
 * what was published, which a cache's check is answered from without rendering.
 */
export type Validator = 'published' | 'body'

export interface CacheTypeOptions extends CacheLifetimeOptions {
  validator?: Validator
}

export interface CacheOptions extends CacheLifetimeOptions {
  /** By content or media type alias, winning over the site's. */
  types?: Record<string, CacheTypeOptions>
  /** The header a CDN reads purge tags from, such as `Surrogate-Key` or `Cache-Tag`. */
  tagHeader?: string
  /** `body` unless set: a page that reads the clock changes with no publish. */
  validator?: Validator
  /** `lifetime` unless set. */
  mode?: CacheMode
  /** With `check`, the seconds a copy whose ETag is over its body is kept before checking: a minute. */
  checkFloor?: number
}

export interface CacheSettings {
  site: Lifetime
  types: ReadonlyMap<string, Lifetime>
  tagHeader: string | undefined
  validator: Validator
  validators: ReadonlyMap<string, Validator>
  mode: CacheMode
  checkFloor: number
  /** What "Keep copies for" and a template's `revalidate` are served stale for on an error. */
  staleIfError: number
}

/**
 * Kept this long, or not kept (`none`), or nothing said (`undefined`). A
 * `check` lifetime's `maxAge` is 0, or the floor for an ETag over the body.
 */
export type Lifetime =
  | { maxAge: number; staleWhileRevalidate?: number; staleIfError?: number; check?: boolean }
  | 'none'
  | undefined

const DAY = 86_400
const WEEK = 604_800
const CHECK_FLOOR = 60

/** What every answer that depends on who is asking carries, whatever is configured. */
export const PRIVATE_NO_STORE = 'private, no-store'

const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined

function lifetimeOf(
  options: CacheLifetimeOptions | undefined,
  mode: CacheMode = 'lifetime',
): Lifetime {
  const maxAge = seconds(options?.maxAge)
  const swr = seconds(options?.staleWhileRevalidate)
  // A copy kept for any time is served for a week if the site fails, unless told otherwise.
  const sie = seconds(options?.staleIfError) ?? WEEK
  if (maxAge === undefined) {
    if (mode !== 'check') return undefined
    return { maxAge: 0, staleWhileRevalidate: swr ?? DAY, staleIfError: sie, check: true }
  }
  if (maxAge === 0 && mode !== 'check') return 'none'
  return {
    maxAge,
    ...(swr ? { staleWhileRevalidate: swr } : {}),
    ...(sie ? { staleIfError: sie } : {}),
  }
}

/** The settings with what cannot be used dropped. Pure. */
export function resolveCacheSettings(options: CacheOptions = {}): CacheSettings {
  const mode: CacheMode = options.mode === 'check' ? 'check' : 'lifetime'
  const types = new Map<string, Lifetime>()
  const validators = new Map<string, Validator>()
  for (const [alias, own] of Object.entries(options.types ?? {})) {
    if (isValidator(own.validator)) validators.set(alias.toLowerCase(), own.validator)
    const inherited = {
      staleWhileRevalidate: options.staleWhileRevalidate,
      staleIfError: options.staleIfError,
      ...own,
    }
    // In `check`, a type naming only how long stale copies last is checked with those.
    const lifetime =
      mode === 'check' && own.maxAge === undefined && !own.staleWhileRevalidate && !own.staleIfError
        ? undefined
        : lifetimeOf(inherited, mode)
    if (lifetime) types.set(alias.toLowerCase(), lifetime)
  }
  const tagHeader = options.tagHeader?.trim()
  return {
    mode,
    checkFloor: seconds(options.checkFloor) ?? CHECK_FLOOR,
    staleIfError: seconds(options.staleIfError) ?? WEEK,
    site: lifetimeOf(options, mode),
    types,
    tagHeader: tagHeader && /^[A-Za-z0-9-]+$/.test(tagHeader) ? tagHeader : undefined,
    validator: isValidator(options.validator) ? options.validator : 'body',
    validators,
  }
}

const isValidator = (value: unknown): value is Validator =>
  value === 'published' || value === 'body'

/** The validator for an answer holding these types: `published` only when every one is. Pure. */
export function validatorFor(settings: CacheSettings, typeAliases: Iterable<string>): Validator {
  let any = false
  for (const alias of typeAliases) {
    any = true
    if ((settings.validators.get(alias.toLowerCase()) ?? settings.validator) !== 'published')
      return 'body'
  }
  return any ? 'published' : settings.validator
}

/** An editor's "Keep copies for" choice as a lifetime, or undefined for none chosen. Pure. */
export function chosenLifetime(
  value: unknown,
  staleWhileRevalidate?: number,
  staleIfError = WEEK,
): Lifetime {
  const label = Array.isArray(value) ? value[0] : value
  const choice = KEEP_COPIES_FOR.find((c) => c.label === label)
  if (!choice) return undefined
  if (choice.seconds === 0) return 'none'
  return {
    maxAge: choice.seconds,
    ...(staleWhileRevalidate ? { staleWhileRevalidate } : {}),
    ...(staleIfError ? { staleIfError } : {}),
  }
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
    chosenLifetime(item.value(CACHE_KEEP_FOR_ALIAS), swr, settings.staleIfError) ??
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
export function cacheControl(lifetime: Lifetime, checkFloor?: number): string | undefined {
  if (lifetime === undefined) return undefined
  if (lifetime === 'none') return 'no-store'
  // A check answered by rendering is kept a little first, so each cache renders a page once a floor.
  const maxAge = lifetime.check && checkFloor !== undefined ? checkFloor : lifetime.maxAge
  return [
    `public, max-age=${maxAge}`,
    ...(lifetime.staleWhileRevalidate
      ? [`stale-while-revalidate=${lifetime.staleWhileRevalidate}`]
      : []),
    ...(lifetime.staleIfError ? [`stale-if-error=${lifetime.staleIfError}`] : []),
  ].join(', ')
}

/** A weak validator over a body's bytes. */
export function etagFor(body: string | Uint8Array): string {
  return `W/"${Bun.hash(body).toString(36)}"`
}

/** A weak validator over what an answer was made from, rather than its bytes. Pure. */
export function publishedEtag(parts: readonly (string | number | null | undefined)[]): string {
  return `W/"p${Bun.hash(parts.map((part) => part ?? '').join('\u0000')).toString(36)}"`
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
  options: {
    lifetime: Lifetime
    tags?: Iterable<string>
    tagHeader?: string
    etag?: string
    /** With `check`, how long a copy whose ETag is over its body is kept (story 259). */
    checkFloor?: number
  },
): Response {
  const headers = new Headers(response.headers)
  const control = cacheControl(options.lifetime, options.etag ? undefined : options.checkFloor)
  if (control) headers.set('cache-control', control)
  const etag = options.etag ?? etagFor(body)
  headers.set('etag', etag)
  if (options.tagHeader && options.tags) {
    const tags = tagValue(options.tagHeader, options.tags)
    if (tags) headers.set(options.tagHeader, tags)
  }
  if (notModified(request, etag)) return unchanged(headers)
  return new Response(body as BodyInit, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** A `304` carrying the headers a `200` would, less the body's own. */
export function unchanged(headers: HeadersInit): Response {
  const kept = new Headers(headers)
  kept.delete('content-type')
  kept.delete('content-length')
  return new Response(null, { status: 304, headers: kept })
}

/** The ETag an address was last answered with, and what a `304` for it repeats. */
export interface RememberedAnswer {
  etag: string
  headers: [string, string][]
  /** What a check must still find unchanged before it is answered. */
  guard?: unknown
}

/**
 * The last answer each address was given, so a check is answered without
 * making it again (story 258). Held in memory by each server, the oldest
 * dropped past `limit`; one not held renders once and is remembered.
 */
export class RememberedAnswers<T extends RememberedAnswer = RememberedAnswer> {
  readonly #limit: number
  readonly #answers = new Map<string, T>()

  constructor(limit = 10_000) {
    this.#limit = limit
  }

  get size(): number {
    return this.#answers.size
  }

  get(address: string): T | undefined {
    const answer = this.#answers.get(address)
    if (!answer) return undefined
    this.#answers.delete(address)
    this.#answers.set(address, answer)
    return answer
  }

  set(address: string, answer: T): void {
    this.#answers.delete(address)
    this.#answers.set(address, answer)
    if (this.#answers.size > this.#limit)
      this.#answers.delete(this.#answers.keys().next().value as string)
  }

  delete(address: string): void {
    this.#answers.delete(address)
  }
}

/** The headers a remembered answer repeats: the ETag, the lifetime and the purge tags. Pure. */
export function rememberedHeaders(headers: Headers, tagHeader?: string): [string, string][] {
  return ['etag', 'cache-control', 'vary', ...(tagHeader ? [tagHeader.toLowerCase()] : [])]
    .map((name) => [name, headers.get(name)] as const)
    .filter((pair): pair is [string, string] => pair[1] !== null)
}
