/**
 * Cross-origin access to the Delivery API, so an app on another origin can call
 * it from the browser. docs/delivery-api.md, "Requests from another origin".
 */
import type { DeliveryApiSettings } from './settings.ts'

export interface CorsPolicy {
  /** Exact origins allowed, lower case, as `URL.origin` writes them. */
  origins: ReadonlySet<string>
  /** `*` was listed and the API is public. */
  any: boolean
  /** Configured origins that were ignored, said once at boot. */
  problems: string[]
}

/** The headers the API reads from a caller; a pre-flight allows exactly these. */
export const CORS_ALLOWED_HEADERS =
  'Accept-Language, Api-Key, Authorization, Content-Type, Preview, Preview-Token, Start-Item'

const MAX_AGE_SECONDS = '600'

/** The configured origins, checked: a path, query or missing scheme is a problem. Pure. */
export function corsPolicy(settings: DeliveryApiSettings): CorsPolicy {
  const origins = new Set<string>()
  const problems: string[] = []
  let any = false
  for (const raw of settings.cors.allowedOrigins) {
    const value = raw.trim()
    if (value === '*') {
      if (settings.publicAccess) any = true
      else
        problems.push(
          'An allowed origin of "*" is ignored because the Delivery API is not public; list each origin instead.',
        )
      continue
    }
    const origin = originOf(value)
    if (origin) origins.add(origin)
    else
      problems.push(
        `The allowed origin "${value}" is ignored: it must be a scheme and host, such as https://app.example.com, with no path.`,
      )
  }
  return { origins, any, problems }
}

function originOf(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined
  try {
    const url = new URL(value)
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
      return undefined
    if (value.replace(/\/$/, '').toLowerCase() !== url.origin.toLowerCase()) return undefined
    return url.origin.toLowerCase()
  } catch {
    return undefined
  }
}

/** The `Access-Control-Allow-Origin` value for a request, or none. Pure. */
export function allowedOrigin(policy: CorsPolicy, request: Request): string | undefined {
  const origin = request.headers.get('origin')
  if (!origin) return undefined
  if (policy.origins.has(origin.toLowerCase())) return origin
  return policy.any ? '*' : undefined
}

/** A browser's pre-flight: `OPTIONS` naming the method it means to send. Pure. */
export const isPreflight = (request: Request): boolean =>
  request.method === 'OPTIONS' &&
  request.headers.has('origin') &&
  request.headers.has('access-control-request-method')

/** The answer to a pre-flight; with no allowed origin it says nothing, and the browser refuses. */
export function preflightResponse(policy: CorsPolicy, request: Request, methods: string): Response {
  const origin = allowedOrigin(policy, request)
  const headers = new Headers({ vary: 'Origin' })
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-methods', methods)
    headers.set('access-control-allow-headers', CORS_ALLOWED_HEADERS)
    headers.set('access-control-max-age', MAX_AGE_SECONDS)
  }
  return new Response(null, { status: 204, headers })
}

/** The response with the CORS headers a cross-origin caller needs to read it. */
export function withCors(policy: CorsPolicy, request: Request, response: Response): Response {
  if (policy.origins.size === 0 && !policy.any) return response
  const origin = allowedOrigin(policy, request)
  const headers = new Headers(response.headers)
  const vary = headers.get('vary')
  if (!vary?.split(',').some((v) => v.trim().toLowerCase() === 'origin'))
    headers.set('vary', vary ? `${vary}, Origin` : 'Origin')
  if (origin) headers.set('access-control-allow-origin', origin)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
