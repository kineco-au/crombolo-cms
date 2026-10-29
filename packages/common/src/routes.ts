/**
 * The route handler contract (story 211): a site's own endpoints, and a server
 * bundle's, at the paths they declare. Plain web `Request` and `Response`;
 * a handler may also return a `Result`, whose value is sent as JSON and whose
 * outcome answers its status. docs/rendering.md, "Route handlers".
 */
import type { CookieOptions, ReadonlyRequestCookies } from './middleware.ts'
import type { Result } from './result.ts'

export type RouteMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'

/** The methods a route may declare a handler for; `HEAD` comes from `GET` when not given. */
export const ROUTE_METHODS: readonly RouteMethod[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]

/** What a handler is given besides the request. */
export interface RouteContext<Site = unknown, Member = unknown> {
  /** The path's `:name` segments. */
  params: Record<string, string>
  url: URL
  /** The request's cookies; reading them is fine, the answer is private by default. */
  cookies: ReadonlyRequestCookies
  /** Sets a cookie on the answer. */
  setCookie(name: string, value: string, options?: CookieOptions): void
  /** The site's services acting as the caller (story 206). */
  site(): Site
  /** The signed-in member, by session cookie or bearer token; looked up when asked. */
  member(): Promise<Member | undefined>
  /** Aborts when the route's time limit runs out, or the caller leaves. */
  signal: AbortSignal
}

/** One method's handler: a `Response`, or a `Result` (a value as JSON, an outcome as its status). */
export type RouteHandler<Site = unknown, Member = unknown, Extra = unknown> = (
  request: Request,
  context: RouteContext<Site, Member> & Extra,
) => Response | Result<unknown> | Promise<Response | Result<unknown>>

/** A route's limits and checks. */
export interface RouteOptions {
  /**
   * A cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` must come from a
   * page of this site, or carry the member's anti-forgery token. On by default;
   * `false` for a webhook receiver. Bearer-token calls are never checked.
   */
  csrf?: boolean
  /** Its own limit, in place of the site's default; `false` for none. */
  rateLimit?: { perMinute: number; by?: 'member' | 'caller' } | false
  /**
   * Answers pages on the Delivery API's allowed origins
   * (`deliveryApi.cors.allowedOrigins`) with CORS headers, pre-flights included.
   * Off by default: only this site's own pages may read the answer.
   */
  cors?: boolean
  /** Only for a signed-in member, or a member of one of these groups: 401 or 403 otherwise. */
  members?: true | { groups: readonly string[] }
  /**
   * Where it answers. `site`, the default, at its path on the site; `backoffice`
   * only for a bundle, below its back-office namespace, for users holding the
   * bundle's section.
   */
  audience?: 'site' | 'backoffice'
}

/** A route as declared: a path, a handler per method, and its options. */
export interface SiteRoute<Site = unknown, Member = unknown, Extra = unknown> {
  path: string
  handlers: Partial<Record<RouteMethod, RouteHandler<Site, Member, Extra>>>
  options: RouteOptions
}

/**
 * A route: `route('/api/records/:species', { GET: list, POST: add })`. A site
 * route's path starts with `/`; a bundle's back-office route's is relative to
 * its namespace.
 */
export function route<Site = unknown, Member = unknown, Extra = unknown>(
  path: string,
  handlers: Partial<Record<RouteMethod, RouteHandler<Site, Member, Extra>>>,
  options: RouteOptions = {},
): SiteRoute<Site, Member, Extra> {
  const unknown = Object.keys(handlers).filter(
    (method) => !ROUTE_METHODS.includes(method as RouteMethod),
  )
  if (unknown.length > 0)
    throw new Error(
      `The route ${path} names ${unknown.join(', ')}, which is not an HTTP method it can answer.`,
    )
  return { path, handlers, options }
}
