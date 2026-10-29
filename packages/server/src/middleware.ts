/**
 * Running a site's middleware chain (story 210): each stage an onion, its
 * middleware matched by path, under one time budget for the whole chain that
 * stops while a middleware waits on `next()`, so crombolo's own work never
 * counts against it. docs/rendering.md, "Middleware".
 */
import type {
  Matcher,
  MatcherCondition,
  Middleware,
  MiddlewareContext,
  MiddlewareHandler,
  MiddlewareStage,
} from '@crombolo/common'

/** A middleware that threw, overran, or tried what its stage refuses, by name. */
export class MiddlewareError extends Error {
  constructor(
    readonly middleware: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
  }
}

/** Any middleware, whatever its context is bound to: the runner hands each the context it gets. */
type AnyMiddleware = Middleware<never, never, never>

/** The chain's time, shared by every middleware in a request. */
export interface MiddlewareBudget {
  remainingMs: number
}

const nameOf = (middleware: AnyMiddleware, index: number, stage: MiddlewareStage) =>
  typeof middleware === 'function'
    ? middleware.name || `${stage} middleware ${index + 1}`
    : middleware.name

const handlerOf = (middleware: AnyMiddleware): MiddlewareHandler =>
  (typeof middleware === 'function' ? middleware : middleware.handle) as MiddlewareHandler

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name)
      return decodeURIComponent(part.slice(at + 1).trim())
  }
  return undefined
}

function conditionHolds(condition: MatcherCondition, request: Request, url: URL): boolean {
  const value =
    condition.type === 'header'
      ? request.headers.get(condition.key)
      : condition.type === 'cookie'
        ? cookieValue(request, condition.key)
        : url.searchParams.get(condition.key)
  if (value === null || value === undefined) return false
  return condition.value === undefined || new RegExp(`^(?:${condition.value})$`).test(value)
}

const patterns = new Map<string, URLPattern>()

/** Whether a matcher, in Next.js's syntax, selects this request. Pure but for a pattern cache. */
export function matches(
  matcher: Matcher | Matcher[] | undefined,
  request: Request,
  url: URL,
): boolean {
  if (matcher === undefined) return true
  const list = Array.isArray(matcher) ? matcher : [matcher]
  return list.some((entry) => {
    const { source, has = [], missing = [] } = typeof entry === 'string' ? { source: entry } : entry
    let pattern = patterns.get(source)
    if (!pattern) {
      pattern = new URLPattern({ pathname: source })
      patterns.set(source, pattern)
    }
    return (
      pattern.test({ pathname: url.pathname }) &&
      has.every((c) => conditionHolds(c, request, url)) &&
      !missing.some((c) => conditionHolds(c, request, url))
    )
  })
}

/** Runs one handler, its clock stopped while it waits on `next()`. */
function timed(
  name: string,
  budget: MiddlewareBudget,
  run: (next: (request?: Request) => Promise<Response>) => Response | Promise<Response>,
  next: (request?: Request) => Promise<Response>,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let armedAt = 0
    const arm = () => {
      armedAt = Date.now()
      if (!Number.isFinite(budget.remainingMs)) return
      timer = setTimeout(
        () => {
          if (settled) return
          settled = true
          budget.remainingMs = 0
          reject(
            new MiddlewareError(
              name,
              `${name} took longer than the middleware chain's time limit.`,
            ),
          )
        },
        Math.max(0, budget.remainingMs),
      )
    }
    const pause = () => {
      clearTimeout(timer)
      if (Number.isFinite(budget.remainingMs)) budget.remainingMs -= Date.now() - armedAt
    }
    arm()
    const waiting = async (request?: Request) => {
      pause()
      try {
        return await next(request)
      } finally {
        if (!settled) arm()
      }
    }
    Promise.resolve()
      .then(() => run(waiting))
      .then(
        (response) => {
          if (settled) return
          settled = true
          pause()
          if (!(response instanceof Response))
            reject(new MiddlewareError(name, `${name} did not answer with a Response.`))
          else resolve(response)
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(
            error instanceof MiddlewareError
              ? error
              : new MiddlewareError(
                  name,
                  `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
                  error,
                ),
          )
        },
      )
  })
}

export interface StageOptions {
  stage: MiddlewareStage
  chain: readonly AnyMiddleware[] | undefined
  request: Request
  /** What follows the stage: the next stage, or crombolo itself. */
  inner: (request: Request) => Promise<Response>
  /** The context each middleware is given, less what the runner fills in. */
  context: (request: Request) => Omit<MiddlewareContext, 'stage'>
  budget: MiddlewareBudget
}

/** One stage of the chain as an onion, outermost first; the matching middleware only. */
export function runStage(options: StageOptions): Promise<Response> {
  const chain = options.chain ?? []
  const step = (index: number, request: Request): Promise<Response> => {
    if (index >= chain.length) return options.inner(request)
    const middleware = chain[index] as AnyMiddleware
    const url = new URL(request.url)
    if (typeof middleware !== 'function' && !matches(middleware.matcher, request, url))
      return step(index + 1, request)
    const name = nameOf(middleware, index, options.stage)
    return timed(
      name,
      options.budget,
      // Assigned, not spread: spreading would read `cookies`, which marks the answer personal.
      (next) =>
        handlerOf(middleware)(
          request,
          next,
          Object.assign(options.context(request), { stage: options.stage }) as MiddlewareContext,
        ),
      (changed) => step(index + 1, changed ?? request),
    )
  }
  return step(0, options.request)
}

/** Whether a chain has anything in it. */
export const hasMiddleware = (chain: readonly AnyMiddleware[] | undefined): boolean =>
  (chain?.length ?? 0) > 0

/** The request's cookies, read-only, as 206's `cookies()` gives them. */
export function requestCookies(request: Request) {
  const all: Array<{ name: string; value: string }> = []
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    let value = part.slice(at + 1).trim()
    try {
      value = decodeURIComponent(value)
    } catch {}
    all.push({ name: part.slice(0, at).trim(), value })
  }
  const first = new Map<string, { name: string; value: string }>()
  for (const cookie of all) if (!first.has(cookie.name)) first.set(cookie.name, cookie)
  return Object.freeze({
    get: (name: string) => first.get(name),
    getAll: (name?: string) => (name === undefined ? [...all] : all.filter((c) => c.name === name)),
    has: (name: string) => first.has(name),
    size: first.size,
    [Symbol.iterator]: () => first.entries(),
  })
}

/**
 * Whether a path is one of the site's own, which a rewrite may go to: never the
 * back office, the APIs, crombolo's endpoints or `/media/`. Pure.
 */
export function isSitePath(pathname: string, backOfficePath: string): boolean {
  const lower = pathname.toLowerCase()
  if (['/sitemap.xml', '/robots.txt', '/health'].includes(lower)) return false
  return ![
    '/umbraco',
    '/crombolo',
    '/media',
    backOfficePath.toLowerCase().replace(/\/+$/, ''),
  ].some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))
}
