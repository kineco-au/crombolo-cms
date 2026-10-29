/**
 * The middleware chain's contract (story 210): what a site's own code, an npm
 * package or a server bundle implements to be inserted into a site's chain.
 * Plain web `Request` and `Response`, with crombolo's extras in `context`.
 * docs/rendering.md, "Middleware".
 */

/** The request's cookies, read-only. Reading them marks the answer personal. */
export interface ReadonlyRequestCookies extends Iterable<[string, RequestCookie]> {
  get(name: string): RequestCookie | undefined
  getAll(name?: string): RequestCookie[]
  has(name: string): boolean
  readonly size: number
}

export interface RequestCookie {
  name: string
  value: string
}

/** Where in a site's handling a middleware runs. */
export type MiddlewareStage = 'request' | 'route' | 'page'

/** What crombolo gives a middleware besides the request. */
export interface MiddlewareContext<Site = unknown, Page = unknown, Member = unknown> {
  /** The request's address, parsed. */
  url: URL
  /** The request's cookies; reading them makes the answer `private, no-store`. */
  cookies: ReadonlyRequestCookies
  /** The site's services acting as the visitor (story 206). */
  site(): Site
  /** The page found, in the `route` and `page` stages. */
  page?: Page
  /** The signed-in member, in the `page` stage. */
  member?: Member
  /** An editor is previewing a draft. */
  preview: boolean
  /** Aborts when the chain's time limit runs out, or the visitor leaves. */
  signal: AbortSignal
  /** The stage this middleware is running in. */
  stage: MiddlewareStage
}

/**
 * One link in the chain. Answer outright by not calling `next`; change the
 * request with `next(changed)`; change the answer by returning `next()`'s
 * `Response` altered.
 */
export type MiddlewareHandler<Site = unknown, Page = unknown, Member = unknown> = (
  request: Request,
  next: (request?: Request) => Promise<Response>,
  context: MiddlewareContext<Site, Page, Member>,
) => Response | Promise<Response>

/** A condition on a header, cookie or query value, as Next.js's matcher takes. */
export interface MatcherCondition {
  type: 'header' | 'cookie' | 'query'
  key: string
  /** A regular expression the value must match; any value when left out. */
  value?: string
}

/** A path pattern in Next.js's matcher syntax, with optional conditions. */
export type Matcher =
  | string
  | { source: string; has?: MatcherCondition[]; missing?: MatcherCondition[] }

/** A middleware: a handler, or one with a name for logs and the paths it runs for. */
export type Middleware<Site = unknown, Page = unknown, Member = unknown> =
  | MiddlewareHandler<Site, Page, Member>
  | {
      /** For logs and errors: `security-headers`, `region-redirect`. */
      name: string
      /** The paths it runs for; every site path when left out. */
      matcher?: Matcher | Matcher[]
      handle: MiddlewareHandler<Site, Page, Member>
    }

/** A site's chain, by stage, each run in the order listed. */
export interface MiddlewareChain<Site = unknown, Page = unknown, Member = unknown> {
  /** First, before the redirect tables and content finding. */
  request?: Middleware<Site, Page, Member>[]
  /** After content finding, with `context.page`; a rewrite is resolved again. */
  route?: Middleware<Site, Page, Member>[]
  /** After public access, with `context.page` and `context.member`; no rewrites. */
  page?: Middleware<Site, Page, Member>[]
}

/**
 * The request for another path on this site, rendered at the address the
 * visitor asked for. `path` may carry its own query; without one the
 * request's query carries over.
 */
export function rewrite(request: Request, path: string): Request {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error(`A rewrite goes to a path on this site, such as /about, not '${path}'.`)
  const from = new URL(request.url)
  const to = new URL(path, from)
  if (!path.includes('?')) to.search = from.search
  return new Request(to, request)
}

/** A `Set-Cookie`'s attributes. */
export interface CookieOptions {
  path?: string
  maxAge?: number
  expires?: Date
  domain?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/** The response with a cookie set on it; `Max-Age=0` and an empty value delete one. */
export function withCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions = {},
): Response {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
    throw new Error(`'${name}' is not a cookie name.`)
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.secure ?? true) parts.push('Secure')
  if (options.httpOnly ?? true) parts.push('HttpOnly')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  const headers = new Headers(response.headers)
  headers.append('set-cookie', parts.join('; '))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
