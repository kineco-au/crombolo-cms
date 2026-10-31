/**
 * Route handlers (story 211): a site's own endpoints and a server bundle's, at
 * the paths they declare. One pipeline for both: the method, the rate limit,
 * the member check, CSRF, the handler under a time limit, and its answer made a
 * response — a `Result`'s value as JSON, an outcome as its status, an error as
 * problem+json or the status page. docs/rendering.md, "Route handlers".
 */
import { type CorsPolicy, isPreflight, preflightResponse, withCors } from '@crombolo/api-delivery'
import {
  type CookieOptions,
  type FieldError,
  isOutcome,
  Ok,
  type Outcome,
  type RouteMethod,
  type RouteOptions,
  type SiteRoute,
} from '@crombolo/common'
import { ANTIFORGERY_HEADER, type PageOutcome, requestScope } from '@crombolo/render'
import { isSitePath, requestCookies } from './middleware.ts'
import { RateLimiter } from './rate-limit.ts'

/** A member as a route sees them: their key, for limits, and their group names. */
export interface RouteMember {
  key: string
  roles: readonly string[]
}

export interface RouteDeps<Member extends RouteMember> {
  backOfficePath: string
  /** The handler's time limit; 0 for none. */
  timeoutMs: number
  /** The site-wide limit per caller a minute; 0 for none. */
  defaultPerMinute: number
  /** The site's services for a caller, the member looked up when asked. */
  siteFor(member: () => Promise<Member | undefined>): () => unknown
  /** The member signed in by cookie, and how to check their anti-forgery token. */
  session(
    request: Request,
  ): Promise<{ member: Member; verify(token: string | null): Promise<boolean> } | undefined>
  /** The member a bearer token names. */
  memberByToken?(token: string): Promise<Member | undefined>
  callerAddress(request: Request): string
  /** 206's status page for a request that prefers HTML. */
  statusPage(request: Request, outcome: PageOutcome): Promise<Response>
  logError(message: string, properties: Record<string, unknown>): void
  showDetails: boolean
  /** The origins a route with `cors: true` answers. */
  cors?: CorsPolicy
  now?: () => number
}

/** A route with what it needs added to its context, such as a bundle's capabilities. */
export interface DeclaredRoute {
  route: SiteRoute
  /** Who declared it, for errors and logs: the site, or a bundle by id. */
  owner: string
  extra?: (caller: { member?: RouteMember; via: 'cookie' | 'token' }) => Record<string, unknown>
}

const BEARER = /^Bearer\s+(\S+)$/i
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MINUTE = 60_000

/** Every reason a set of site routes cannot be mounted: reserved paths and two routes on one path. */
export function siteRouteProblems(
  routes: readonly DeclaredRoute[],
  backOfficePath: string,
): string[] {
  const problems: string[] = []
  const seen = new Map<string, string>()
  for (const { route, owner } of routes) {
    if (!route.path.startsWith('/') || route.path.startsWith('//'))
      problems.push(`${owner}: the route "${route.path}" must be a path starting with /.`)
    else if (!isSitePath(route.path.replace(/[:*(].*$/, ''), backOfficePath))
      problems.push(
        `${owner}: the route "${route.path}" is under one of crombolo's own paths (/umbraco, /crombolo, /media or the back office).`,
      )
    try {
      new URLPattern({ pathname: route.path })
    } catch {
      problems.push(`${owner}: "${route.path}" is not a path pattern.`)
    }
    const key = route.path.toLowerCase().replace(/:[^/]+/g, ':')
    const other = seen.get(key)
    if (other) problems.push(`${owner} and ${other} both claim the route "${route.path}".`)
    else seen.set(key, owner)
  }
  return problems
}

/** The methods a route answers, `HEAD` and `OPTIONS` included. */
function allowed(route: SiteRoute): string {
  const methods = new Set(Object.keys(route.handlers))
  if (methods.has('GET')) methods.add('HEAD')
  methods.add('OPTIONS')
  return [...methods].join(', ')
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  410: 'Gone',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  504: 'Gateway Timeout',
}

const prefersHtml = (request: Request) => {
  const accept = request.headers.get('accept') ?? ''
  const html = accept.indexOf('text/html')
  const json = accept.search(/application\/(problem\+)?json/)
  return html >= 0 && (json < 0 || html < json)
}

/** Builds the site's route pipeline over its routes and its bundles'. */
/** Why a route's signal is aborted once its answer has been sent. */
const ANSWERED = new Error('The answer has been sent.')

export function createRoutes<Member extends RouteMember>(
  declared: readonly DeclaredRoute[],
  deps: RouteDeps<Member>,
) {
  const compiled = declared.map((entry) => ({
    ...entry,
    pattern: new URLPattern({ pathname: entry.route.path }),
  }))
  const defaultLimiter =
    deps.defaultPerMinute > 0
      ? new RateLimiter({ max: deps.defaultPerMinute, windowMs: MINUTE, now: deps.now })
      : undefined
  const ownLimiters = new Map<SiteRoute, RateLimiter>()
  const limiterFor = (route: SiteRoute): RateLimiter | undefined => {
    const limit = route.options.rateLimit
    if (limit === false) return undefined
    if (!limit) return defaultLimiter
    let own = ownLimiters.get(route)
    if (!own) {
      own = new RateLimiter({ max: limit.perMinute, windowMs: MINUTE, now: deps.now })
      ownLimiters.set(route, own)
    }
    return own
  }

  /** A refusal or failure, as problem+json, or as the status page for a browser. */
  const problem = async (
    request: Request,
    status: number,
    details: {
      message?: string
      errors?: readonly FieldError[]
      reference?: string
      headers?: Record<string, string>
    } = {},
  ): Promise<Response> => {
    const headers = { 'cache-control': 'private, no-store', ...details.headers }
    if (prefersHtml(request) && status !== 405 && status !== 429) {
      const page = await deps.statusPage(request, {
        status,
        name: status === 500 ? 'serverError' : (TITLES[status] ?? 'error'),
        message: details.message,
        errors: details.errors ?? [],
        ...(details.reference ? { reference: details.reference } : {}),
      })
      const out = new Headers(page.headers)
      for (const [name, value] of Object.entries(headers)) out.set(name, value)
      return new Response(page.body, { status, headers: out })
    }
    return Response.json(
      {
        type: 'about:blank',
        title: TITLES[status] ?? 'Error',
        status,
        ...(details.message ? { detail: details.message } : {}),
        ...(details.errors?.length ? { errors: details.errors } : {}),
        ...(details.reference ? { reference: details.reference } : {}),
      },
      { status, headers: { 'content-type': 'application/problem+json', ...headers } },
    )
  }

  const fromOutcome = (request: Request, outcome: Outcome) =>
    outcome.isRedirect
      ? new Response(null, {
          status: outcome.status,
          headers: { location: outcome.location as string, 'cache-control': 'no-store' },
        })
      : problem(request, outcome.status, { message: outcome.message, errors: outcome.errors })

  /** Whether an unsafe, cookie-authenticated request came from a page of this site. */
  const fromThisSite = async (
    request: Request,
    url: URL,
    verify: (token: string | null) => Promise<boolean>,
  ): Promise<boolean> => {
    const site = request.headers.get('sec-fetch-site')
    if (site === 'same-origin') return true
    const origin = request.headers.get('origin')
    if (!site && origin && origin === url.origin) return true
    if (await verify(request.headers.get(ANTIFORGERY_HEADER))) return true
    const type = request.headers.get('content-type') ?? ''
    if (/application\/x-www-form-urlencoded|multipart\/form-data/.test(type)) {
      const form = await request
        .clone()
        .formData()
        .catch(() => undefined)
      const token = form?.get('__antiforgery')
      if (typeof token === 'string' && (await verify(token))) return true
    }
    return false
  }

  /**
   * Answers a request with one route: everything but matching, which
   * `handle` does for site routes and a bundle does for its back-office ones.
   */
  async function invoke(
    entry: DeclaredRoute,
    request: Request,
    url: URL,
    params: Record<string, string>,
    options: { checks: boolean; extra?: Record<string, unknown> } = { checks: true },
  ): Promise<Response> {
    const policy = entry.route.options.cors ? deps.cors : undefined
    if (!policy) return answer(entry, request, url, params, options)
    if (isPreflight(request)) return preflightResponse(policy, request, allowed(entry.route))
    return withCors(policy, request, await answer(entry, request, url, params, options))
  }

  async function answer(
    entry: DeclaredRoute,
    request: Request,
    url: URL,
    params: Record<string, string>,
    options: { checks: boolean; extra?: Record<string, unknown> },
  ): Promise<Response> {
    const { route } = entry
    const method = request.method.toUpperCase() as RouteMethod
    let handler = route.handlers[method]
    if (!handler && method === 'HEAD') handler = route.handlers.GET
    if (!handler && method === 'OPTIONS')
      return new Response(null, { status: 204, headers: { allow: allowed(route) } })
    if (!handler)
      return problem(request, 405, {
        message: `${url.pathname} answers ${allowed(route)}.`,
        headers: { allow: allowed(route) },
      })

    // Who is calling: a bearer token, or the member's session cookie, looked up once.
    const bearer = BEARER.exec(request.headers.get('authorization') ?? '')?.[1]
    let identified:
      | Promise<{ member: Member | undefined; verify?: (token: string | null) => Promise<boolean> }>
      | undefined
    const identify = () => {
      identified ??= bearer
        ? (deps.memberByToken?.(bearer) ?? Promise.resolve(undefined)).then((member) => ({
            member,
          }))
        : deps
            .session(request)
            .then((session) => ({ member: session?.member, verify: session?.verify }))
      return identified
    }
    const member = async () => (await identify()).member

    if (options.checks) {
      const limiter = limiterFor(route)
      if (limiter) {
        const signedIn = await member()
        const limit = route.options.rateLimit
        const by = limit ? limit.by : undefined
        const key =
          signedIn && by !== 'caller'
            ? `member:${signedIn.key.toLowerCase()}`
            : `caller:${deps.callerAddress(request)}`
        const wait = limiter.take(key)
        if (wait)
          return problem(request, 429, {
            message: 'Too many requests. Try again in a moment.',
            headers: { 'retry-after': String(wait) },
          })
      }
      const required = route.options.members
      if (required) {
        const signedIn = await member()
        if (!signedIn) return problem(request, 401, { message: 'Sign in to continue.' })
        if (
          typeof required === 'object' &&
          !required.groups.some((group) =>
            signedIn.roles.some((role) => role.toLowerCase() === group.toLowerCase()),
          )
        )
          return problem(request, 403, { message: 'Your account does not have access to this.' })
      }
      if (route.options.csrf !== false && UNSAFE.has(method) && !bearer) {
        const { member: cookieMember, verify } = await identify()
        if (cookieMember && verify && !(await fromThisSite(request, url, verify)))
          return problem(request, 403, {
            message:
              'This request was refused because it did not come from a page of this site. Send it with crombolo.fetch from /crombolo/bundle.js, or include the anti-forgery token.',
          })
      }
    }

    const cookies: string[] = []
    const deadline = new AbortController()
    const signal = AbortSignal.any([request.signal, deadline.signal])
    const site = deps.siteFor(member)
    const context = {
      params,
      url,
      cookies: requestCookies(request),
      setCookie: (name: string, value: string, cookie: CookieOptions = {}) => {
        const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookie.path ?? '/'}`]
        if (cookie.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(cookie.maxAge)}`)
        if (cookie.expires) parts.push(`Expires=${cookie.expires.toUTCString()}`)
        if (cookie.domain) parts.push(`Domain=${cookie.domain}`)
        if (cookie.secure ?? true) parts.push('Secure')
        if (cookie.httpOnly ?? true) parts.push('HttpOnly')
        parts.push(`SameSite=${cookie.sameSite ?? 'Lax'}`)
        cookies.push(parts.join('; '))
      },
      site,
      member,
      signal,
      ...(entry.extra?.({ member: await member(), via: bearer ? 'token' : 'cookie' }) ?? {}),
      ...options.extra,
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const overran = new Promise<'overran'>((resolve) => {
      if (deps.timeoutMs > 0)
        timer = setTimeout(() => {
          deadline.abort(new Error(`${url.pathname} took longer than ${deps.timeoutMs}ms.`))
          resolve('overran')
        }, deps.timeoutMs)
    })
    let response: Response
    try {
      const work = Promise.resolve().then(() =>
        requestScope({ headers: request.headers }, site, () => handler(request, context as never)),
      )
      work.catch(() => {})
      const answer = await Promise.race([work, overran])
      if (answer === 'overran')
        response = await problem(request, 504, { message: 'This took too long to answer.' })
      else if (answer instanceof Response) response = answer
      else if (isOutcome(answer)) response = await fromOutcome(request, answer)
      else if (answer instanceof Ok) response = Response.json(answer.value)
      else
        throw new Error(
          `${entry.owner}'s ${method} ${route.path} answered with neither a Response nor a Result.`,
        )
    } catch (error) {
      if (isOutcome(error)) response = await fromOutcome(request, error)
      else {
        const reference = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
        const message = error instanceof Error ? error.message : String(error)
        deps.logError(
          'The route {method} {path} ({owner}) failed, reference {reference}: {error}',
          {
            method,
            path: url.pathname,
            owner: entry.owner,
            reference,
            error: error instanceof Error ? (error.stack ?? message) : message,
          },
        )
        response = await problem(request, 500, {
          reference,
          ...(deps.showDetails ? { message } : {}),
        })
      }
    } finally {
      clearTimeout(timer)
    }

    const headers = new Headers(response.headers)
    for (const cookie of cookies) headers.append('set-cookie', cookie)
    // Kept only where the handler said so, and only for a read.
    if (!headers.has('cache-control') || (method !== 'GET' && method !== 'HEAD'))
      headers.set('cache-control', 'private, no-store')
    const body = method === 'HEAD' ? null : response.body
    // Story 224: the signal ends once the answer has been sent, its body read
    // to the end, failed or cancelled, so nothing still listening is kept alive.
    const answered = () => deadline.abort(ANSWERED)
    if (!body) answered()
    const sent = body?.pipeThrough(
      new TransformStream({ flush: answered, cancel: answered } as Transformer<
        Uint8Array,
        Uint8Array
      >),
    )
    return new Response(sent ?? null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  /** The route a site path matches, with its params. */
  function match(pathname: string) {
    for (const entry of compiled) {
      const found = entry.pattern.exec({ pathname })
      if (found)
        return {
          entry,
          params: Object.fromEntries(
            Object.entries(found.pathname.groups).filter(
              (pair): pair is [string, string] =>
                typeof pair[1] === 'string' && !/^\d+$/.test(pair[0]),
            ),
          ),
        }
    }
    return undefined
  }

  return {
    routes: declared,
    match,
    invoke,
    /** A site request a route answers, or undefined for content finding to have it. */
    async handle(request: Request, url: URL): Promise<Response | undefined> {
      const found = match(url.pathname)
      if (!found) return undefined
      return invoke(found.entry, request, url, found.params)
    },
  }
}

export type SiteRoutes = ReturnType<typeof createRoutes>
export type { RouteOptions }
