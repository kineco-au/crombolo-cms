/**
 * A site's middleware (story 210): the contract from `@crombolo/common`, bound
 * to crombolo's own types, and `fromNextMiddleware`, which brings a Next.js
 * middleware into the chain as one link.
 */
import {
  type Middleware as CommonMiddleware,
  type MiddlewareContext as CommonMiddlewareContext,
  type MiddlewareHandler as CommonMiddlewareHandler,
  type CookieOptions,
  type Matcher,
  rewrite,
} from '@crombolo/common'
import type { PublishedContent, RequestMember, SiteServices } from '@crombolo/render'

export {
  type CookieOptions,
  type Matcher,
  type MatcherCondition,
  type MiddlewareStage,
  type ReadonlyRequestCookies,
  type RequestCookie,
  rewrite,
  withCookie,
} from '@crombolo/common'

/** A middleware for this site: `site()` gives its services, `page` and `member` crombolo's own. */
export type Middleware = CommonMiddleware<SiteServices, PublishedContent, RequestMember>
export type MiddlewareHandler = CommonMiddlewareHandler<
  SiteServices,
  PublishedContent,
  RequestMember
>
export type MiddlewareContext = CommonMiddlewareContext<
  SiteServices,
  PublishedContent,
  RequestMember
>

/** What a Next.js-style middleware is handed: the request, with `nextUrl` and `cookies`. */
export type NextRequest = Request & {
  nextUrl: URL
  cookies: {
    get(name: string): { name: string; value: string } | undefined
    getAll(): Array<{ name: string; value: string }>
    has(name: string): boolean
  }
}

interface Marks {
  next?: true
  rewrite?: string | URL
  requestHeaders?: Headers
}

const marks = new WeakMap<Response, Marks>()

/** A Next.js-style answer: `next()`, `redirect()`, `rewrite()` and `json()`, with cookies to set. */
export class NextResponse extends Response {
  readonly cookies = {
    set: (name: string, value: string, options: CookieOptions = {}) => {
      const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`]
      if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
      if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
      if (options.domain) parts.push(`Domain=${options.domain}`)
      if (options.secure ?? true) parts.push('Secure')
      if (options.httpOnly ?? true) parts.push('HttpOnly')
      parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
      this.headers.append('set-cookie', parts.join('; '))
      return this.cookies
    },
    delete: (name: string) => this.cookies.set(name, '', { maxAge: 0 }),
  }

  /** Carry on, optionally with the request's headers replaced for what follows. */
  static next(init: { request?: { headers?: Headers }; headers?: HeadersInit } = {}): NextResponse {
    const response = new NextResponse(null, { headers: init.headers })
    marks.set(response, {
      next: true,
      ...(init.request?.headers ? { requestHeaders: new Headers(init.request.headers) } : {}),
    })
    return response
  }

  /** Render another path of this site at the address asked for. */
  static rewrite(
    url: string | URL,
    init: { request?: { headers?: Headers }; headers?: HeadersInit } = {},
  ): NextResponse {
    const response = new NextResponse(null, { headers: init.headers })
    marks.set(response, {
      rewrite: url,
      ...(init.request?.headers ? { requestHeaders: new Headers(init.request.headers) } : {}),
    })
    return response
  }

  static override redirect(url: string | URL, status = 307): NextResponse {
    return new NextResponse(null, { status, headers: { location: String(url) } })
  }

  static override json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new NextResponse(JSON.stringify(body), { ...init, headers })
  }
}

/** A Next.js-style middleware: the request in, a response (or nothing, to carry on) out. */
export type NextMiddleware = (
  request: NextRequest,
) => Response | undefined | Promise<Response | undefined>

function nextRequestOf(request: Request, context: MiddlewareContext): NextRequest {
  const copy = new Request(request)
  const read = () => context.cookies
  return Object.assign(copy, {
    nextUrl: new URL(request.url),
    cookies: {
      get: (name: string) => read().get(name),
      getAll: () => read().getAll(),
      has: (name: string) => read().has(name),
    },
  })
}

/**
 * A Next.js middleware as one link in the chain: `NextResponse.next()` carries
 * on, `rewrite()` renders another path of this site, `redirect()` and any
 * other response answer outright, and headers and cookies set on a
 * `NextResponse` reach the final answer.
 */
export function fromNextMiddleware(
  middleware: NextMiddleware,
  options: { name?: string; matcher?: Matcher | Matcher[] } = {},
): Middleware {
  return {
    name: options.name ?? (middleware.name || 'next middleware'),
    ...(options.matcher ? { matcher: options.matcher } : {}),
    async handle(request, next, context) {
      const answer = await middleware(nextRequestOf(request, context))
      if (!answer) return next()
      const marked = marks.get(answer)
      if (!marked) return answer
      let forward = marked.requestHeaders
        ? new Request(request, { headers: marked.requestHeaders })
        : request
      if (marked.rewrite !== undefined) {
        const target = new URL(String(marked.rewrite), request.url)
        if (target.origin !== new URL(request.url).origin)
          throw new Error(`A rewrite goes to a path on this site, not to ${target.origin}.`)
        forward = rewrite(forward, `${target.pathname}${target.search}`)
      }
      const inner = await next(forward)
      const headers = new Headers(inner.headers)
      for (const [name, value] of answer.headers)
        if (name !== 'set-cookie') headers.set(name, value)
      for (const cookie of answer.headers.getSetCookie()) headers.append('set-cookie', cookie)
      return new Response(inner.body, {
        status: inner.status,
        statusText: inner.statusText,
        headers,
      })
    },
  }
}
