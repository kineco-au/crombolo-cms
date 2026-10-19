/**
 * Cross-origin protection for cookie-authenticated writes. A browser marks every
 * request with where it came from; a request carrying neither mark is not from a
 * browser, so it cannot be a forged one and passes.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Whether a method changes nothing, so needs no origin check. */
export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase())

/**
 * Whether `request` came from this site rather than another origin — a sibling
 * subdomain included. The `Origin` fallback compares hosts, since behind a proxy
 * that ends TLS the request's own URL says `http` while the browser said `https`.
 */
export function isSameOrigin(request: Request, applicationUrl?: string): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const origin = request.headers.get('origin')
  if (origin === null) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  if (origin === new URL(request.url).origin) return true
  if (applicationUrl && origin === new URL(applicationUrl).origin) return true
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  return host === (forwarded || request.headers.get('host'))
}
