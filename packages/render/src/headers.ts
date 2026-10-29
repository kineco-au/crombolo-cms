/**
 * The request a page is rendering for, as `next/headers` offers it: `cookies()`
 * and `headers()`, both read-only. Reading either makes the page personal, so
 * it is never shared (story 206).
 */
import type { ReadonlyRequestCookies, RequestCookie } from '@crombolo/common'
import { currentRequest } from './context.ts'

export type { ReadonlyRequestCookies, RequestCookie } from '@crombolo/common'

/** The request's headers, read-only: `get`, `has` and iteration. */
export interface ReadonlyHeaders extends Iterable<[string, string]> {
  get(name: string): string | null
  has(name: string): boolean
  entries(): IterableIterator<[string, string]>
  keys(): IterableIterator<string>
  values(): IterableIterator<string>
  forEach(callback: (value: string, name: string) => void): void
}

function parseCookies(header: string | null): RequestCookie[] {
  if (!header) return []
  const found: RequestCookie[] = []
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const name = part.slice(0, at).trim()
    const raw = part
      .slice(at + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
    let value = raw
    try {
      value = decodeURIComponent(raw)
    } catch {}
    if (name) found.push({ name, value })
  }
  return found
}

function readonlyCookies(header: string | null): ReadonlyRequestCookies {
  const all = parseCookies(header)
  const first = new Map<string, RequestCookie>()
  for (const cookie of all) if (!first.has(cookie.name)) first.set(cookie.name, cookie)
  return Object.freeze({
    get: (name: string) => first.get(name),
    getAll: (name?: string) => (name === undefined ? [...all] : all.filter((c) => c.name === name)),
    has: (name: string) => first.has(name),
    size: first.size,
    [Symbol.iterator]: () => first.entries(),
  })
}

function readonlyHeaders(source: Headers): ReadonlyHeaders {
  const copy = new Headers(source)
  return Object.freeze({
    get: (name: string) => copy.get(name),
    has: (name: string) => copy.has(name),
    entries: () => copy.entries(),
    keys: () => copy.keys(),
    values: () => copy.values(),
    forEach: (callback: (value: string, name: string) => void) =>
      copy.forEach((value, name) => {
        callback(value, name)
      }),
    [Symbol.iterator]: () => copy.entries(),
  })
}

/** The request's cookies; empty on a page that exports `dynamic = 'force-static'`. */
export function cookies(): Promise<ReadonlyRequestCookies> {
  try {
    return Promise.resolve(readonlyCookies(currentRequest('cookies()').headers.get('cookie')))
  } catch (error) {
    return Promise.reject(error)
  }
}

/** The request's headers; empty on a page that exports `dynamic = 'force-static'`. */
export function headers(): Promise<ReadonlyHeaders> {
  try {
    return Promise.resolve(readonlyHeaders(currentRequest('headers()').headers))
  } catch (error) {
    return Promise.reject(error)
  }
}
