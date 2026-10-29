/**
 * What a caching adapter does for `createCrombolo`, one per Next.js major
 * (story 208): keep the Delivery API's answers in Next's cache, tagged with the
 * content they hold, and clear them when the site says it changed.
 */
import { contentKeysIn } from '@crombolo/delivery-client'

export interface KeptAnswer {
  status: number
  body: string
  headers: Record<string, string>
}

export interface CacheAdapter {
  readonly major: 15 | 16
  /** The answer at `url`, from Next's cache when it holds one. */
  answer(url: string, headers: Record<string, string>): Promise<KeptAnswer>
  /** Clears every kept answer holding one of these keys, and every kept not-found. */
  revalidate(keys: readonly string[]): void
}

/** Every adapter's answers carry this, so a whole site can be cleared at once. */
export const SITE_TAG = 'crombolo'
/** Kept not-found answers, cleared on every change: a new page may answer one. */
export const MISSING_TAG = 'crombolo:missing'
/** Next.js keeps at most this many tags on one entry. */
const MAX_TAGS = 128

export const tagOf = (key: string) => `crombolo:${key.toLowerCase()}`

/** The tags an answer is kept under: the site's, and each key it holds or the site named. */
export function tagsFor(status: number, body: string, headers: Headers): string[] {
  if (status === 404) return [SITE_TAG, MISSING_TAG]
  let parsed: unknown = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {}
  const named = (headers.get('surrogate-key') ?? headers.get('cache-tag') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
  const keys = new Set([...contentKeysIn(parsed), ...named.map((k) => k.toLowerCase())])
  return [SITE_TAG, ...[...keys].map(tagOf)].slice(0, MAX_TAGS)
}

/** Whether the site said not to keep it: a redirect, a form, anything personal. */
export function unkept(headers: Headers): boolean {
  return /\b(no-store|private)\b/i.test(headers.get('cache-control') ?? '')
}

/** The headers a kept answer needs to be read again. */
export function keptHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ['content-type', 'etag', 'cache-control', 'surrogate-key', 'cache-tag']) {
    const value = headers.get(name)
    if (value !== null) out[name] = value
  }
  return out
}
